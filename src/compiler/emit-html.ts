import { InternalCompilerError } from "./internal-error.js";
import type { IrElement, IrFieldContent, IrPageMeta, IrSize, IrTextSegment, PageIR } from "./ir.js";
import { baseCssHref, pageCssHref } from "./routes.js";

export function emitHtml(page: PageIR): string {
  // kadam 0.3: a page-level header or footer is a landmark of the whole page,
  // so it is emitted outside <main>. Only leading headers and trailing
  // footers move; source order is otherwise preserved.
  const elements = [...page.elements];
  const before: IrElement[] = [];
  const after: IrElement[] = [];
  while (elements.length > 0 && elements[0]!.kind === "header") before.push(elements.shift()!);
  while (elements.length > 0 && elements[elements.length - 1]!.kind === "footer") after.unshift(elements.pop()!);

  const meta = page.meta;
  const lines: string[] = [
    "<!doctype html>",
    `<html lang="${escapeAttribute(meta?.language ?? "en")}">`,
    "<head>",
    '  <meta charset="utf-8">',
    '  <meta name="viewport" content="width=device-width, initial-scale=1">',
    `  <title>${escapeText(page.title)}</title>`,
    ...(meta === undefined ? [] : metaLines(page.title, meta)),
    // kadam 0.3 (D-38): native controls and scrollbars follow the system theme.
    ...(page.pageStyle.autoDark === true ? ['  <meta name="color-scheme" content="light dark">'] : []),
    `  <link rel="stylesheet" href="${escapeAttribute(baseCssHref(page.basePath))}">`,
    `  <link rel="stylesheet" href="${escapeAttribute(pageCssHref(page.routeSlug, page.basePath))}">`,
    ...runtimeHeadLines(page),
    "</head>",
    "<body>",
    ...before.map((element) => renderElement(asPageLandmark(element), 1)),
    '  <main class="kdm-page">',
    ...elements.map((element) => renderElement(element, 2)),
    "  </main>",
    ...after.map((element) => renderElement(asPageLandmark(element), 1)),
    "</body>",
    "</html>",
  ];
  return `${lines.join("\n")}\n`;
}

/** A header or footer outside <main> takes the page font and text color. */
function asPageLandmark(element: IrElement): IrElement {
  return { ...element, kindClass: `${element.kindClass} kdm-page-landmark` };
}

function metaLines(title: string, meta: IrPageMeta): string[] {
  const lines: string[] = [];
  if (meta.description !== null) {
    lines.push(`  <meta name="description" content="${escapeAttribute(meta.description)}">`);
  }
  if (meta.canonicalUrl !== null) {
    lines.push(`  <link rel="canonical" href="${escapeAttribute(meta.canonicalUrl)}">`);
  }
  if (meta.iconUrl !== null) {
    lines.push(`  <link rel="icon" href="${escapeAttribute(meta.iconUrl)}">`);
  }
  if (meta.description !== null || meta.shareImageUrl !== null || meta.canonicalUrl !== null) {
    lines.push(`  <meta property="og:title" content="${escapeAttribute(title)}">`);
    if (meta.description !== null) {
      lines.push(`  <meta property="og:description" content="${escapeAttribute(meta.description)}">`);
    }
    if (meta.canonicalUrl !== null) {
      lines.push(`  <meta property="og:url" content="${escapeAttribute(meta.canonicalUrl)}">`);
    }
    if (meta.shareImageUrl !== null) {
      lines.push(`  <meta property="og:image" content="${escapeAttribute(meta.shareImageUrl)}">`);
      lines.push('  <meta name="twitter:card" content="summary_large_image">');
    }
  }
  return lines;
}

function renderElement(element: IrElement, depth: number): string {
  let html = renderElementTag(element, depth);
  const marker = `data-kdm-id="${element.nodeId}"`;
  // kadam 0.3 (F4 step 2): runtime attributes (hidden state, aria-live).
  if (element.attributes !== undefined && element.attributes.length > 0) {
    const extra = element.attributes
      .map(([name, value]) => (value === "" ? ` ${name}` : ` ${name}="${escapeAttribute(value)}"`))
      .join("");
    html = html.replace(marker, `${marker}${extra}`);
  }
  // kadam 0.3 (F4): an in-page link target carries its id, whatever its kind.
  // Text kinds already write it; the first tag is checked so it is never doubled.
  if (element.htmlId !== undefined) {
    const firstTag = html.slice(0, html.indexOf(">") + 1);
    if (!firstTag.includes(` id="${element.htmlId}"`)) {
      html = html.replace(marker, `${marker} id="${escapeAttribute(element.htmlId)}"`);
    }
  }
  if (element.scrollable !== true) return html;
  // kadam 0.3: a scroll container is focusable so keyboard users can scroll it.
  return html.replace(marker, `${marker} tabindex="0"`);
}

function renderElementTag(element: IrElement, depth: number): string {
  const indent = "  ".repeat(depth);
  const classAttribute = `${element.className} ${element.kindClass}`;

  switch (element.kind) {
    case "button": {
      const text = requireText(element);
      if (element.action === null) {
        const type = element.control?.submit === true ? "submit" : "button";
        const disabled = element.control?.disabled === true ? " disabled" : "";
        return `${indent}<button class="${classAttribute}" data-kdm-id="${element.nodeId}" type="${type}"${disabled}>${escapeText(text)}</button>`;
      }
      return `${indent}<a${linkAttributes(element)}>${escapeText(text)}</a>`;
    }
    case "link": {
      const text = requireText(element);
      if (element.action === null) {
        throw new InternalCompilerError(
          "a link reached emission without an action",
          element.nameSpan,
        );
      }
      return `${indent}<a${linkAttributes(element)}>${escapeText(text)}</a>`;
    }
    case "main heading":
      return textElement(element, "h1", indent, classAttribute);
    case "section heading":
      return textElement(element, "h2", indent, classAttribute);
    case "minor heading":
      return textElement(element, "h3", indent, classAttribute);
    case "paragraph":
      return textElement(element, "p", indent, classAttribute);
    // kadam 0.3 (F1)
    case "small heading":
      return textElement(element, "h4", indent, classAttribute);
    case "badge":
      return textElement(element, "span", indent, classAttribute);
    case "list item":
      return textElement(element, "li", indent, classAttribute);
    case "cell":
      return textElement(element, "td", indent, classAttribute);
    case "code block":
      // A code block scrolls sideways (overflow-x: auto), so keyboard users
      // must be able to focus it (WCAG 2.1.1, axe scrollable-region-focusable).
      return `${indent}<pre class="${classAttribute}" data-kdm-id="${element.nodeId}" tabindex="0"><code>${escapeText(requireText(element))}</code></pre>`;
    case "header":
      return renderContainer(element, "header", indent, classAttribute);
    case "footer":
      return renderContainer(element, "footer", indent, classAttribute);
    case "article":
      return renderContainer(element, "article", indent, classAttribute);
    case "sidebar":
      return renderContainer(element, "aside", indent, classAttribute);
    case "list":
      return renderContainer(element, "ul", indent, classAttribute);
    case "numbered list":
      return renderContainer(element, "ol", indent, classAttribute);
    case "section": {
      const content = element.content;
      const labelled = content?.type === "section" ? ` aria-labelledby="${escapeAttribute(content.labelledBy)}"` : "";
      return renderContainer(element, "section", indent, classAttribute, labelled);
    }
    case "dialog": {
      const content = element.content;
      const labelled = content?.type === "dialog" ? ` aria-labelledby="${escapeAttribute(content.labelledBy)}"` : "";
      return renderContainer(element, "dialog", indent, classAttribute, labelled);
    }
    case "form": {
      const content = element.content;
      const action = content?.type === "form" ? ` action="${escapeAttribute(content.action)}" method="post"` : "";
      return renderContainer(element, "form", indent, classAttribute, action);
    }
    case "table":
      return renderTable(element, indent, classAttribute);
    case "header row":
    case "row":
      return renderContainer(element, "tr", indent, classAttribute);
    case "video":
    case "audio clip":
      return renderMedia(element, indent, classAttribute);
    case "icon":
      return renderImage(element, indent, classAttribute);
    case "text area":
      return renderTextArea(element, indent, classAttribute);
    case "checkbox":
      return renderCheckbox(element, indent, classAttribute);
    case "dropdown":
      return renderDropdown(element, indent, classAttribute);
    case "radio group":
      return renderRadioGroup(element, indent, classAttribute);
    case "image":
      return renderImage(element, indent, classAttribute);
    case "text field":
      return renderField(element, indent, classAttribute);
    case "divider":
      return `${indent}<hr class="${classAttribute}" data-kdm-id="${element.nodeId}">`;
    case "navigation bar":
      return renderContainer(element, "nav", indent, classAttribute);
    case "card":
    case "container":
      // kadam 0.3 (F4): a clickable card or container is one link.
      if (element.action !== null) {
        return [
          `${indent}<a${linkAttributes(element)}>`,
          ...element.children.map((child) => renderElement(child, indent.length / 2 + 1)),
          `${indent}</a>`,
        ].join("\n");
      }
      return renderContainer(element, "div", indent, classAttribute);
    case "expandable section": {
      const content = element.content;
      const title = content?.type === "expandable" ? content.title : "";
      const open = content?.type === "expandable" && content.open ? " open" : "";
      return [
        `${indent}<details class="${classAttribute}" data-kdm-id="${element.nodeId}"${open}>`,
        `${indent}  <summary class="kdm-expandable-title">${escapeText(title)}</summary>`,
        `${indent}  <div class="kdm-expandable-body">`,
        ...element.children.map((child) => renderElement(child, indent.length / 2 + 2)),
        `${indent}  </div>`,
        `${indent}</details>`,
      ].join("\n");
    }
  }
}

function renderContainer(
  element: IrElement,
  tag: string,
  indent: string,
  classAttribute: string,
  extra: string = "",
): string {
  if (element.children.length === 0) {
    return `${indent}<${tag} class="${classAttribute}" data-kdm-id="${element.nodeId}"${extra}></${tag}>`;
  }
  return [
    `${indent}<${tag} class="${classAttribute}" data-kdm-id="${element.nodeId}"${extra}>`,
    ...element.children.map((child) => renderElement(child, indent.length / 2 + 1)),
    `${indent}</${tag}>`,
  ].join("\n");
}

function renderImage(
  element: IrElement,
  indent: string,
  classAttribute: string,
): string {
  const image = element.image;
  if (image === null) {
    throw new InternalCompilerError(
      "an image reached emission without content",
      element.nameSpan,
    );
  }

  const attributes = [
    `class="${classAttribute}"`,
    `data-kdm-id="${element.nodeId}"`,
    `src="${escapeAttribute(image.url)}"`,
    `alt="${escapeAttribute(image.decorative ? "" : image.alt ?? "")}"`,
  ];
  const width = htmlDimension(element.authored.width);
  const height = htmlDimension(element.authored.height);
  if (width !== null) attributes.push(`width="${width}"`);
  if (height !== null) attributes.push(`height="${height}"`);
  if (image.loading === "lazy") attributes.push(`loading="lazy"`);
  return `${indent}<img ${attributes.join(" ")}>`;
}

function renderField(
  element: IrElement,
  indent: string,
  classAttribute: string,
): string {
  const field = element.field;
  if (field === null) {
    throw new InternalCompilerError(
      "a text field reached emission without content",
      element.nameSpan,
    );
  }

  const inputAttributes = [
    'class="kdm-field-input"',
    `id="${field.inputId}"`,
    `type="${field.inputType}"`,
  ];
  if (field.placeholder !== null) {
    inputAttributes.push(`placeholder="${escapeAttribute(field.placeholder)}"`);
  }
  if (field.required) inputAttributes.push("required");
  inputAttributes.push(...fieldExtraAttributes(field));

  return [
    `${indent}<div class="${classAttribute}" data-kdm-id="${element.nodeId}">`,
    `${indent}  <label class="kdm-field-label" for="${field.labelFor}">${escapeText(field.label)}</label>`,
    `${indent}  <input ${inputAttributes.join(" ")}>`,
    ...errorLines(indent, field),
    `${indent}</div>`,
  ].join("\n");
}

/** A text element, with an optional `id` and inline runs (kadam 0.3). */
function textElement(element: IrElement, tag: string, indent: string, classAttribute: string): string {
  const id = element.htmlId === undefined ? "" : ` id="${escapeAttribute(element.htmlId)}"`;
  return `${indent}<${tag} class="${classAttribute}" data-kdm-id="${element.nodeId}"${id}>${renderText(element)}</${tag}>`;
}

function renderText(element: IrElement): string {
  const segments = element.text?.segments;
  if (segments === undefined) return escapeText(requireText(element));
  return segments.map(renderSegment).join("");
}

function renderSegment(segment: IrTextSegment): string {
  switch (segment.type) {
    case "text":
      return escapeText(segment.text);
    case "break":
      return "<br>";
    case "bold":
      return `<strong>${escapeText(segment.text)}</strong>`;
    case "italic":
      return `<em>${escapeText(segment.text)}</em>`;
    case "code":
      return `<code class="kdm-inline-code">${escapeText(segment.text)}</code>`;
    case "link": {
      const external = segment.external ? ' target="_blank" rel="noopener noreferrer"' : "";
      return `<a class="kdm-inline-link" href="${escapeAttribute(segment.href)}"${external}>${escapeText(segment.text)}</a>`;
    }
  }
}

function fieldExtraAttributes(field: IrFieldContent): string[] {
  const attributes: string[] = [];
  if (field.name !== undefined) attributes.push(`name="${escapeAttribute(field.name)}"`);
  if (field.minLength !== undefined) attributes.push(`minlength="${field.minLength}"`);
  if (field.maxLength !== undefined) attributes.push(`maxlength="${field.maxLength}"`);
  if (field.disabled === true) attributes.push("disabled");
  if (field.error !== undefined) attributes.push(`aria-describedby="${field.inputId}-error"`);
  return attributes;
}

/** kadam 0.3 (F4): the error text, shown by CSS once the field is invalid. */
function errorLines(indent: string, field: IrFieldContent): string[] {
  if (field.error === undefined) return [];
  return [`${indent}  <p class="kdm-field-error" id="${field.inputId}-error">${escapeText(field.error)}</p>`];
}

function requireField(element: IrElement): IrFieldContent {
  if (element.field === null) {
    throw new InternalCompilerError(`${element.kind} reached emission without field content`, element.nameSpan);
  }
  return element.field;
}

function renderTable(element: IrElement, indent: string, classAttribute: string): string {
  const caption = element.content?.type === "table" ? element.content.caption : "";
  const rows = element.children;
  const head = rows.filter((row) => row.kind === "header row");
  const body = rows.filter((row) => row.kind !== "header row");
  const renderRow = (row: IrElement, depth: string, header: boolean): string[] => [
    `${depth}<tr class="${row.className} ${row.kindClass}" data-kdm-id="${row.nodeId}">`,
    ...row.children.map((cell) => {
      const tag = header ? "th" : "td";
      const scope = header ? ' scope="col"' : "";
      return `${depth}  <${tag} class="${cell.className} ${cell.kindClass}" data-kdm-id="${cell.nodeId}"${scope}>${renderText(cell)}</${tag}>`;
    }),
    `${depth}</tr>`,
  ];
  return [
    `${indent}<table class="${classAttribute}" data-kdm-id="${element.nodeId}">`,
    `${indent}  <caption>${escapeText(caption)}</caption>`,
    ...(head.length === 0 ? [] : [`${indent}  <thead>`, ...head.flatMap((row) => renderRow(row, `${indent}    `, true)), `${indent}  </thead>`]),
    `${indent}  <tbody>`,
    ...body.flatMap((row) => renderRow(row, `${indent}    `, false)),
    `${indent}  </tbody>`,
    `${indent}</table>`,
  ].join("\n");
}

function renderMedia(element: IrElement, indent: string, classAttribute: string): string {
  const content = element.content;
  if (content?.type !== "media") {
    throw new InternalCompilerError(`${element.kind} reached emission without a source`, element.nameSpan);
  }
  const tag = content.media === "video" ? "video" : "audio";
  const attributes = [
    `class="${classAttribute}"`,
    `data-kdm-id="${element.nodeId}"`,
    `src="${escapeAttribute(content.url)}"`,
    "controls",
    'preload="metadata"',
  ];
  if (content.posterUrl !== null) attributes.push(`poster="${escapeAttribute(content.posterUrl)}"`);
  const width = htmlDimension(element.authored.width);
  const height = htmlDimension(element.authored.height);
  if (width !== null) attributes.push(`width="${width}"`);
  if (height !== null) attributes.push(`height="${height}"`);
  if (content.captionsUrl === null) {
    return `${indent}<${tag} ${attributes.join(" ")}></${tag}>`;
  }
  return [
    `${indent}<${tag} ${attributes.join(" ")}>`,
    `${indent}  <track kind="captions" src="${escapeAttribute(content.captionsUrl)}" srclang="${escapeAttribute(content.language)}" label="Captions" default>`,
    `${indent}</${tag}>`,
  ].join("\n");
}

function labelLine(indent: string, field: IrFieldContent): string {
  return `${indent}  <label class="kdm-field-label" for="${field.labelFor}">${escapeText(field.label)}</label>`;
}

function renderTextArea(element: IrElement, indent: string, classAttribute: string): string {
  const field = requireField(element);
  const attributes = ['class="kdm-field-input"', `id="${field.inputId}"`, 'rows="4"'];
  if (field.placeholder !== null) attributes.push(`placeholder="${escapeAttribute(field.placeholder)}"`);
  if (field.required) attributes.push("required");
  attributes.push(...fieldExtraAttributes(field));
  return [
    `${indent}<div class="${classAttribute}" data-kdm-id="${element.nodeId}">`,
    labelLine(indent, field),
    `${indent}  <textarea ${attributes.join(" ")}></textarea>`,
    ...errorLines(indent, field),
    `${indent}</div>`,
  ].join("\n");
}

function renderCheckbox(element: IrElement, indent: string, classAttribute: string): string {
  const field = requireField(element);
  const attributes = ['class="kdm-checkbox-input"', `id="${field.inputId}"`, 'type="checkbox"'];
  if (field.checked === true) attributes.push("checked");
  if (field.required) attributes.push("required");
  attributes.push(...fieldExtraAttributes(field));
  return [
    `${indent}<div class="${classAttribute}" data-kdm-id="${element.nodeId}">`,
    `${indent}  <input ${attributes.join(" ")}>`,
    labelLine(indent, field),
    `${indent}</div>`,
  ].join("\n");
}

function renderDropdown(element: IrElement, indent: string, classAttribute: string): string {
  const field = requireField(element);
  const attributes = ['class="kdm-field-input"', `id="${field.inputId}"`];
  if (field.required) attributes.push("required");
  attributes.push(...fieldExtraAttributes(field));
  const options = [
    ...(field.placeholder === null ? [] : [`${indent}    <option value="" disabled selected>${escapeText(field.placeholder)}</option>`]),
    ...(field.options ?? []).map((option) => `${indent}    <option value="${escapeAttribute(option)}">${escapeText(option)}</option>`),
  ];
  return [
    `${indent}<div class="${classAttribute}" data-kdm-id="${element.nodeId}">`,
    labelLine(indent, field),
    `${indent}  <select ${attributes.join(" ")}>`,
    ...options,
    `${indent}  </select>`,
    ...errorLines(indent, field),
    `${indent}</div>`,
  ].join("\n");
}

function renderRadioGroup(element: IrElement, indent: string, classAttribute: string): string {
  const field = requireField(element);
  const disabled = field.disabled === true ? " disabled" : "";
  const options = (field.options ?? []).flatMap((option, index) => {
    const id = `${element.nodeId}-${index + 1}`;
    const required = field.required && index === 0 ? " required" : "";
    return [
      `${indent}  <div class="kdm-radio-option">`,
      `${indent}    <input class="kdm-radio-input" id="${id}" type="radio" name="${escapeAttribute(field.name ?? element.nodeId)}" value="${escapeAttribute(option)}"${required}>`,
      `${indent}    <label for="${id}">${escapeText(option)}</label>`,
      `${indent}  </div>`,
    ];
  });
  return [
    `${indent}<fieldset class="${classAttribute}" data-kdm-id="${element.nodeId}"${disabled}>`,
    `${indent}  <legend class="kdm-field-label">${escapeText(field.label)}</legend>`,
    ...options,
    `${indent}</fieldset>`,
  ].join("\n");
}

function linkAttributes(element: IrElement): string {
  if (element.action === null) {
    throw new InternalCompilerError(
      "an anchor reached emission without an action",
      element.nameSpan,
    );
  }

  const attributes = [
    ` class="${element.className} ${element.kindClass}"`,
    ` data-kdm-id="${element.nodeId}"`,
    ` href="${escapeAttribute(
      element.action.kind === "navigate"
        ? element.action.route
        : element.action.kind === "href"
          ? element.action.href
          : element.action.url,
    )}"`,
  ];
  if (element.action.kind === "external") {
    attributes.push(' target="_blank"', ' rel="noopener noreferrer"');
  }
  if (element.action.kind === "href" && element.action.download) {
    attributes.push(" download");
  }
  return attributes.join("");
}

function requireText(element: IrElement): string {
  if (element.text === null) {
    throw new InternalCompilerError(
      `${element.kind} reached emission without text`,
      element.nameSpan,
    );
  }
  return element.text.text;
}

function htmlDimension(size: IrSize | undefined): string | null {
  if (
    size === undefined ||
    size.kind !== "length" ||
    size.value.unit !== "px" ||
    !Number.isInteger(size.value.value) ||
    size.value.value < 0
  ) {
    return null;
  }
  return String(size.value.value);
}

export function escapeText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function escapeAttribute(value: string): string {
  return escapeText(value)
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** kadam 0.3 (D-36): the page runtime module and its JavaScript-off stylesheet. */
function runtimeHeadLines(page: PageIR): string[] {
  if (page.runtime === undefined) return [];
  const href = (path: string): string => `${page.basePath ?? ""}/${path}`;
  const noscript = page.runtime.script.replace(/\.js$/, ".noscript.css");
  return [
    `  <script type="module" src="${escapeAttribute(href(page.runtime.script))}"></script>`,
    `  <noscript><link rel="stylesheet" href="${escapeAttribute(href(noscript))}"></noscript>`,
  ];
}
