import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import type { ComponentNode, ComponentParameterNode } from "../core/ast/nodes.js";
import { DiagnosticBag, type Diagnostic } from "../core/diagnostics/diagnostic.js";
import { parseComponentText } from "../core/parser/component.js";
import type { SourceFile } from "../core/source/source-file.js";
import type { OutputFile } from "./compile.js";
import { baseCssUsage, emitBaseCss, emitPageCss } from "./emit-css.js";
import { emitElementsHtml } from "./emit-html.js";
import { scopeCss } from "./fragment.js";
import type { PageIR } from "./ir.js";
import { loadManifest } from "./manifest.js";
import { compileProject } from "./project.js";

/**
 * kadam 0.3 (F6, D-43): the Web Components target. Every component in the
 * catalog becomes a custom element (`ProductCard` -> `<kadam-product-card>`)
 * defined in one ES module, `kadam-elements.js`.
 *
 * Each component variant is built through the ordinary project pipeline as a
 * generated page holding one instance whose parameters are placeholders, so
 * every check (types, accessibility, contrast) still runs. The element clones
 * that markup into its shadow root and fills the placeholders from its
 * attributes with text nodes and checked attributes only, as runtime data
 * does (D-41).
 */

export interface WebComponentsOptions {
  readonly projectRoot: string;
  readonly outDir?: string | undefined;
  readonly basePath?: string | undefined;
  readonly sourceOverrides?: ReadonlyMap<string, string | Uint8Array> | undefined;
}

export interface WebComponentParameter {
  readonly name: string;
  readonly type: "text" | "url";
  readonly defaultValue: string | null;
}

export interface WebComponentElement {
  readonly tag: string;
  readonly component: string;
  readonly namespace: string | null;
  readonly parameters: readonly WebComponentParameter[];
  readonly variants: readonly string[];
  /** Event names the element dispatches (`tell the page "select"`). */
  readonly events: readonly string[];
  readonly slots: readonly (string | null)[];
}

export interface WebComponentsResult {
  readonly ok: boolean;
  readonly diagnostics: readonly Diagnostic[];
  readonly files: readonly OutputFile[];
  readonly sources: readonly SourceFile[];
  readonly outDir: string;
  readonly elements: readonly WebComponentElement[];
}

const SUPPORTED: ReadonlySet<string> = new Set(["text", "url"]);
const GENERATED_DIR = ".kadam/web-components";

interface Planned {
  readonly node: ComponentNode;
  readonly namespace: string | null;
  readonly tag: string;
  readonly parameters: readonly WebComponentParameter[];
  /** Variant name ("default" first) to generated page route. */
  readonly routes: ReadonlyMap<string, string>;
}

export function compileWebComponents(options: WebComponentsOptions): WebComponentsResult {
  const projectRoot = resolve(options.projectRoot);
  const diagnostics = new DiagnosticBag();
  const outDir = resolve(options.outDir ?? join(projectRoot, "dist"));
  const fail = (sources: readonly SourceFile[] = []): WebComponentsResult => ({
    ok: false, diagnostics: diagnostics.sorted(), files: [], sources, outDir, elements: [],
  });

  const manifestText = readText(projectRoot, "kadam.json", options.sourceOverrides);
  const loaded = loadManifest(projectRoot, manifestText ?? undefined);
  diagnostics.addAll(loaded.diagnostics);
  const manifest = loaded.manifest;
  if (manifest === null || manifestText === null) return fail(loaded.manifestSource === null ? [] : [loaded.manifestSource]);
  if (manifest.kadam !== "0.3") {
    diagnostics.error("KDM4001", "the web-components target requires \"kadam\": \"0.3\"", rootSpan(loaded.manifestPath), 'set "kadam": "0.3" in kadam.json');
    return fail();
  }

  // Plan one generated page per component variant.
  const planned: Planned[] = [];
  const pages: { source: string; route: string; title: string }[] = [];
  const overrides = new Map(options.sourceOverrides ?? []);
  const tags = new Map<string, string>();
  for (const entry of manifest.components) {
    const text = readText(projectRoot, entry.source, options.sourceOverrides);
    if (text === null) continue; // the project build reports it
    const node = parseComponentText(entry.source, text).document.component;
    if (node === null) continue;
    let supported = true;
    for (const parameter of node.parameters) {
      if (!SUPPORTED.has(parameter.valueType)) {
        supported = false;
        diagnostics.error("KDM3054", `${node.name} takes ${parameter.name} as ${parameter.valueType}; web components support text and url parameters`,
          parameter.typeSpan, "change the parameter to text or url, or leave this component out of the web-components build");
      }
    }
    const tag = tagName(node.name, entry.namespace);
    const previous = tags.get(tag);
    if (previous !== undefined) {
      diagnostics.error("KDM3054", `${node.name} and ${previous} both become <${tag}>`, node.nameSpan, "rename one of the components");
      supported = false;
    }
    tags.set(tag, node.name);
    if (!supported) continue;

    const routes = new Map<string, string>();
    for (const variant of ["default", ...node.variants.map((v) => v.name)]) {
      const index = pages.length;
      const source = `${GENERATED_DIR}/${index}-${node.name}-${variant}.kdm`;
      const route = `/kadam-web-component-${index}/`;
      overrides.set(source, instancePage(node, entry.namespace, variant, `Kadam element ${index}`));
      pages.push({ source, route, title: `Kadam element ${index}` });
      routes.set(variant, route);
    }
    planned.push({
      node,
      namespace: entry.namespace,
      tag,
      parameters: node.parameters.map((p) => ({ name: p.name, type: p.valueType as "text" | "url", defaultValue: p.defaultValue })),
      routes,
    });
  }
  if (diagnostics.hasErrors) return fail();
  if (planned.length === 0) {
    diagnostics.error("KDM3054", "the project has no components to build as web components", rootSpan(loaded.manifestPath),
      'list component files in kadam.json, for example "components": ["components/ProductCard.kdm"]');
    return fail();
  }

  const raw = JSON.parse(manifestText) as Record<string, unknown>;
  const project = compileProject({
    projectRoot,
    outDir: options.outDir,
    basePath: options.basePath,
    manifestText: JSON.stringify({ ...raw, pages }),
    sourceOverrides: overrides,
    slotOutlets: true,
  });
  diagnostics.addAll(project.diagnostics);
  if (!project.ok) return fail(project.sources);

  const byRoute = new Map(project.pages.map((page) => [page.route, page]));
  const elements: WebComponentElement[] = [];
  const definitions: string[] = [];
  for (const plan of planned) {
    const variants: Record<string, [string, string, (readonly [string, string, readonly string[]])[]]> = {};
    const events = new Set<string>();
    const slots: (string | null)[] = [];
    for (const [variant, route] of plan.routes) {
      const page = byRoute.get(route)!;
      const handlers = elementEvents(page, plan.node, diagnostics);
      for (const [, , names] of handlers) for (const name of names) events.add(name);
      const html = withSlots(emitElementsHtml(page), slots);
      variants[variant] = [html, hostCss(emitPageCss(page)), handlers];
    }
    if (diagnostics.hasErrors) continue;
    elements.push({
      tag: plan.tag,
      component: plan.node.name,
      namespace: plan.namespace,
      parameters: plan.parameters,
      variants: [...plan.routes.keys()],
      events: [...events].sort(),
      slots,
    });
    const parameters = plan.parameters.map((p) => [p.name, p.defaultValue ?? ""]);
    definitions.push(`define(${json(plan.tag)}, ${json(parameters)}, ${json(variants)});`);
  }
  if (diagnostics.hasErrors) return fail(project.sources);

  const base = hostCss(emitBaseCss(baseCssUsage(project.pages)));
  const files: OutputFile[] = [
    { path: "kadam-elements.js", contents: elementsModule(base, definitions), kind: "js" },
    ...project.files.filter((file) => file.kind === "asset"),
  ];
  return { ok: true, diagnostics: diagnostics.sorted(), files, sources: project.sources, outDir: project.outDir, elements };
}

/** `ProductCard` -> `kadam-product-card`; a library component adds its namespace. */
export function tagName(component: string, namespace: string | null): string {
  const kebab = component.replace(/([a-z0-9])([A-Z])/g, "$1-$2").replace(/([A-Z])([A-Z][a-z])/g, "$1-$2").toLowerCase();
  return namespace === null ? `kadam-${kebab}` : `kadam-${namespace.toLowerCase()}-${kebab}`;
}

function instancePage(node: ComponentNode, namespace: string | null, variant: string, title: string): string {
  const kind = [`a ${node.name}`, namespace === null ? "" : ` from ${namespace}`, variant === "default" ? "" : ` in the ${variant} variant`].join("");
  return [
    "kadam 0.3",
    "",
    `page ${JSON.stringify(title)} {`,
    "    kadamHost {",
    `        ${kind}`,
    ...node.parameters.map((parameter) => `        with a ${parameter.name} of ${JSON.stringify(placeholder(parameter))}`),
    "    }",
    "}",
    "",
  ].join("\n");
}

function placeholder(parameter: ComponentParameterNode): string {
  return `https://kadam.invalid/field/${parameter.valueType}/${parameter.name}`;
}

/** Events the element dispatches, as [node id, trigger, event names]; any other runtime use is an error for now. */
function elementEvents(page: PageIR, node: ComponentNode, diagnostics: DiagnosticBag): (readonly [string, string, readonly string[]])[] {
  const runtime = page.runtime;
  if (runtime === undefined) return [];
  const other =
    runtime.states.length > 0 || runtime.textBindings.length > 0 || runtime.visibilityBindings.length > 0 ||
    runtime.loaders.length > 0 || runtime.controllers.length > 0 ||
    runtime.handlers.some((handler) => handler.effects.some((effect) => effect.type !== "tell"));
  if (other) {
    diagnostics.error("KDM3055", `${node.name} uses state or events; web components support only tell the page for now`, node.nameSpan,
      'use when clicked, tell the page "select", and keep state in the host page');
    return [];
  }
  return runtime.handlers.map((handler) => [
    handler.nodeId,
    handler.trigger === "click" ? "click" : handler.key ?? "Enter",
    handler.effects.flatMap((effect) => (effect.type === "tell" ? [effect.event] : [])),
  ] as const);
}

/** Replace the expander's slot markers with <slot> elements around their fallback. */
function withSlots(html: string, slots: (string | null)[]): string {
  return html
    .replace(/<p [^>]*>kdm-slot-start:([a-z][A-Za-z0-9]*)?<\/p>/g, (_, name: string | undefined) => {
      const slot = name ?? null;
      if (!slots.includes(slot)) slots.push(slot);
      return slot === null ? "<slot>" : `<slot name="${slot}">`;
    })
    .replace(/<p [^>]*>kdm-slot-end:([a-z][A-Za-z0-9]*)?<\/p>/g, "</slot>")
    .replace(/(<slot(?: name="[^"]*")?>)\s*<\/slot>/g, "$1</slot>");
}

/**
 * Page-wide rules apply to the element itself (`:host`). Everything else is
 * already scoped by the shadow root. A page background is left to the host.
 */
function hostCss(css: string): string {
  const scoped = scopeCss(css, (selector) => {
    const root = selector.match(/^(html|body|:root|\.kdm-page)(?=$|[\s.[:>])/);
    return root === null ? selector : `:host${selector.slice(root[1]!.length)}`;
  });
  return scoped.replace(/:host \{\n {2}background-color: [^;\n]+;\n\}\n*/g, "");
}

function elementsModule(base: string, definitions: readonly string[]): string {
  return [
    "// Generated by Kadam. Do not edit.",
    "// Custom elements for this project's components (kadam 0.3, D-43).",
    "const FIELD = /https:\\/\\/kadam\\.invalid\\/field\\/(?:text|url)\\/([a-z][A-Za-z0-9]{0,63})/g;",
    "const SAFE_URL = /^(?:https?:\\/\\/|mailto:|\\/(?!\\/)|#)/i;",
    "function sheet(css) {",
    "  const styles = new CSSStyleSheet();",
    "  styles.replaceSync(css);",
    "  return styles;",
    "}",
    `const base = sheet(${json(`:host {\n  display: block;\n}\n\n:host([hidden]) {\n  display: none;\n}\n\n${base}`)});`,
    "function fill(root, values) {",
    "  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);",
    "  for (let text = walker.nextNode(); text !== null; text = walker.nextNode()) {",
    "    text.data = text.data.replace(FIELD, (_, name) => values[name]);",
    "  }",
    "  for (const node of root.querySelectorAll(\"*\")) {",
    "    for (const attribute of [...node.attributes]) {",
    "      if (!attribute.value.includes(\"kadam.invalid\")) continue;",
    "      const isUrl = attribute.name === \"href\" || attribute.name === \"src\";",
    "      const value = attribute.value.replace(FIELD, (_, name, offset) => (isUrl && offset > 0 ? encodeURIComponent(values[name]) : values[name]));",
    "      if (isUrl && (!SAFE_URL.test(value) || /[\\u0000-\\u0020]/.test(value))) node.removeAttribute(attribute.name);",
    "      else node.setAttribute(attribute.name, value);",
    "    }",
    "  }",
    "}",
    "function define(tag, parameters, variants) {",
    "  const built = {};",
    "  for (const [name, [html, css, events]] of Object.entries(variants)) {",
    "    const template = document.createElement(\"template\");",
    "    template.innerHTML = html;",
    "    built[name] = [template, sheet(css), events];",
    "  }",
    "  customElements.define(tag, class extends HTMLElement {",
    "    static get observedAttributes() {",
    "      return [\"variant\", ...parameters.map(([name]) => name)];",
    "    }",
    "    connectedCallback() {",
    "      this.render();",
    "    }",
    "    attributeChangedCallback() {",
    "      if (this.shadowRoot !== null) this.render();",
    "    }",
    "    render() {",
    "      const root = this.shadowRoot ?? this.attachShadow({ mode: \"open\" });",
    "      const chosen = this.getAttribute(\"variant\");",
    "      const [template, styles, events] = built[chosen !== null && Object.hasOwn(built, chosen) ? chosen : \"default\"];",
    "      root.adoptedStyleSheets = [base, styles];",
    "      const values = {};",
    "      for (const [name, fallback] of parameters) values[name] = this.getAttribute(name) ?? fallback;",
    "      const content = template.content.cloneNode(true);",
    "      fill(content, values);",
    "      for (const [id, trigger, names] of events) {",
    "        const node = content.querySelector(`[data-kdm-id=\"${id}\"]`);",
    "        node.addEventListener(trigger === \"click\" ? \"click\" : \"keydown\", (event) => {",
    "          if (trigger !== \"click\" && event.key !== trigger) return;",
    "          for (const name of names) this.dispatchEvent(new CustomEvent(name, { bubbles: true, composed: true }));",
    "        });",
    "      }",
    "      root.replaceChildren(content);",
    "    }",
    "  });",
    "}",
    "",
    ...definitions,
    "",
  ].join("\n");
}

function json(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function readText(projectRoot: string, path: string, overrides: WebComponentsOptions["sourceOverrides"]): string | null {
  const override = overrides?.get(path) ?? overrides?.get(resolve(projectRoot, path));
  if (override !== undefined) return typeof override === "string" ? override : new TextDecoder().decode(override);
  const absolute = resolve(projectRoot, path);
  if (!existsSync(absolute)) return null;
  try {
    return readFileSync(absolute, "utf8");
  } catch {
    return null;
  }
}

function rootSpan(file: string): Diagnostic["span"] {
  return { file, start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 1, offset: 0 } };
}
