import type {
  BuiltinKindName,
  ColorValue,
  ElementNode,
  GradientDirection,
  InteractionState,
  LengthValue,
  StateEffect,
  StatementNode,
} from "../core/ast/nodes.js";
import { FONT_STACKS, GLOBAL_TOKENS } from "./defaults.js";
import type { IrDeclaration, IrRule, IrStateStyle, IrTransition } from "./ir.js";
import { assetUrl } from "./routes.js";

/**
 * Lowering for kadam 0.3 (F3) styling statements. Like F2, each statement
 * becomes CSS declarations in source order; an element with no F3 statements
 * keeps its exact 0.1 IR.
 */

export interface F3Context {
  readonly kind: BuiltinKindName;
  readonly className: string;
  readonly basePath: string;
  /** Custom fonts from kadam.json: family name to fallback stack. */
  readonly fonts: ReadonlyMap<string, string>;
}

/** Looping animations and their keyframes, emitted only on pages that use them. */
export const LOOP_KEYFRAMES: Readonly<Record<string, { readonly timing: string; readonly duration: string; readonly frames: readonly (readonly [string, readonly (readonly [string, string])[]])[] }>> = {
  spin: { timing: "linear", duration: "1s", frames: [["from", [["rotate", "0deg"]]], ["to", [["rotate", "360deg"]]]] },
  pulse: { timing: "ease-in-out", duration: "2s", frames: [["0%,\n  100%", [["opacity", "1"]]], ["50%", [["opacity", "0.5"]]]] },
  bounce: { timing: "ease-in-out", duration: "1s", frames: [["0%,\n  100%", [["translate", "0 0"]]], ["50%", [["translate", "0 -8px"]]]] },
  float: { timing: "ease-in-out", duration: "3s", frames: [["0%,\n  100%", [["translate", "0 0"]]], ["50%", [["translate", "0 -6px"]]]] },
  // F8: a slow pan and zoom (Ken Burns).
  zoom: { timing: "ease-in-out", duration: "24s", frames: [["0%,\n  100%", [["scale", "1"], ["translate", "0 0"]]], ["50%", [["scale", "1.08"], ["translate", "-1.5% -1%"]]]] },
};

/** F8 scroll-driven keyframes, emitted only on pages that use them. */
export const SCROLL_KEYFRAMES: Readonly<Record<string, readonly (readonly [string, readonly (readonly [string, string])[]])[]>> = {
  "kdm-parallax": [["from", [["translate", "0 -40px"]]], ["to", [["translate", "0 40px"]]]],
  "kdm-scroll-progress": [["from", [["scale", "0 1"]]], ["to", [["scale", "1 1"]]]],
  // F8: the aurora background drifts slowly; it is not scroll-driven, but is emitted the same way.
  "kdm-aurora": [["from", [["background-position", "0% 0%"]]], ["to", [["background-position", "100% 100%"]]]],
};

/** F8: a grayscale noise tile, inlined so it needs no file and no request. */
const GRAIN = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.18'/%3E%3C/svg%3E")`;
const MESH_SPOTS = ["15% 20%", "85% 25%", "50% 90%"];

/** F8 shapes: clip paths, or rounded corners for the soft shapes. */
const SHAPES: Readonly<Record<string, readonly [string, string]>> = {
  circle: ["clip-path", "circle(50%)"],
  ellipse: ["clip-path", "ellipse(50% 50%)"],
  hexagon: ["clip-path", "polygon(25% 0, 75% 0, 100% 50%, 75% 100%, 25% 100%, 0 50%)"],
  diamond: ["clip-path", "polygon(50% 0, 100% 50%, 50% 100%, 0 50%)"],
  triangle: ["clip-path", "polygon(50% 0, 100% 100%, 0 100%)"],
  blob: ["border-radius", "42% 58% 70% 30% / 45% 45% 55% 55%"],
  arch: ["border-radius", "9999px 9999px 0 0"],
};

const FIELD_KINDS: ReadonlySet<BuiltinKindName> = new Set(["text field", "text area", "dropdown"]);

function length(value: LengthValue): string {
  const number = Number.isInteger(value.value) ? String(value.value) : String(Number(value.value.toFixed(4)));
  return value.value === 0 && value.unit === null ? "0" : `${number}${value.unit ?? ""}`;
}

/** The CSS custom property that carries a theme color (D-38). */
export function tokenVar(name: string): string {
  return `var(--kdm-color-${name})`;
}

function color(value: ColorValue): string {
  return value.kind === "token" ? tokenVar(value.value) : value.value;
}

function number(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(4)));
}

const DIRECTIONS: Readonly<Record<GradientDirection, string>> = {
  "left to right": "to right",
  "right to left": "to left",
  "top to bottom": "to bottom",
  "bottom to top": "to top",
};

const SHADOW_GEOMETRY: Readonly<Record<"soft" | "medium" | "strong", string>> = {
  soft: "0 1px 3px",
  medium: "0 4px 6px -1px",
  strong: "0 10px 15px -3px",
};

function fontStack(name: string, context: F3Context): string {
  return `"${name.replaceAll('"', "")}", ${context.fonts.get(name) ?? FONT_STACKS["sans serif"]}`;
}

/** CSS declarations for one scope's F3 statements. */
export function f3ScopeDeclarations(statements: readonly StatementNode[], context: F3Context): IrDeclaration[] {
  const out: IrDeclaration[] = [];
  const d = (property: string, value: string): void => {
    out.push({ property, value });
  };
  // F8: every filter function shares one `filter` declaration, where the first one was written.
  let filterAt = -1;
  const filters: string[] = [];
  const addFilter = (fn: string): void => {
    if (filterAt === -1) {
      filterAt = out.length;
      out.push({ property: "filter", value: "" });
    }
    filters.push(fn);
  };
  let overlay: string | null = null;
  // F8: generated background layers, top first, each with its size.
  const layers: { image: string; size: string; order: number }[] = [];
  const has = <T extends StatementNode["type"]>(type: T): Extract<StatementNode, { type: T }> | undefined =>
    statements.find((statement) => statement.type === type) as Extract<StatementNode, { type: T }> | undefined;
  let transformBox = false;

  for (const statement of statements) {
    switch (statement.type) {
      case "raw-css":
        // F6 (D-42): url() paths become the copied asset's address.
        d(
          statement.property,
          statement.value.replace(/url\(\s*([^)]*)\)/gi, (_, path: string) =>
            `url("${assetUrl(path.trim().replace(/^'(.*)'$/, "$1"), context.basePath)}")`),
        );
        break;
      case "border":
        if (statement.mode === "solid" && statement.line !== undefined) d("border-style", statement.line);
        break;
      case "side-border":
        for (const side of statement.sides) {
          d(`border-${side}`, `${length(statement.width)} ${statement.line} ${color(statement.color)}`);
        }
        break;
      case "corner-radius":
        for (const corner of statement.corners) {
          d(`border-${corner}-radius`, statement.radius === null ? `${GLOBAL_TOKENS.pillRadius}px` : length(statement.radius));
        }
        break;
      case "outline":
        d("outline", `${length(statement.width)} solid ${color(statement.color)}`);
        d("outline-offset", "2px");
        break;
      case "gradient": {
        const colors = statement.colors.map(color).join(", ");
        d("background-color", "transparent");
        if (statement.shape === "radial") {
          d("background-image", `radial-gradient(circle, ${colors})`);
        } else {
          const angle = has("gradient-angle");
          const direction = has("gradient-direction");
          const lead = angle !== undefined ? `${number(angle.degrees)}deg` : direction !== undefined ? DIRECTIONS[direction.direction] : "to bottom";
          d("background-image", `linear-gradient(${lead}, ${colors})`);
        }
        break;
      }
      case "background-image": {
        const fit = has("background-fit");
        const focus = has("background-focus");
        d("background-image", `url("${assetUrl(statement.value, context.basePath)}")`);
        d("background-size", fit === undefined || fit.fit === "repeat" ? (fit?.fit === "repeat" ? "auto" : "cover") : fit.fit);
        d("background-position", focus === undefined ? "center" : spot(focus.horizontal, focus.vertical));
        d("background-repeat", fit?.fit === "repeat" ? "repeat" : "no-repeat");
        break;
      }
      case "background-fit":
        if (has("background-image") === undefined) {
          d("background-size", statement.fit === "repeat" ? "auto" : statement.fit);
          d("background-repeat", statement.fit === "repeat" ? "repeat" : "no-repeat");
        }
        break;
      case "background-focus":
        if (has("background-image") === undefined) d("background-position", spot(statement.horizontal, statement.vertical));
        break;
      case "text-decoration":
        d("text-decoration-line", statement.value);
        break;
      case "text-case":
        d("text-transform", statement.value);
        break;
      case "text-measure":
        d("max-width", `${statement.characters}ch`);
        break;
      case "line-clamp":
        if (statement.lines === 1) {
          d("overflow", "hidden");
          d("text-overflow", "ellipsis");
          d("white-space", "nowrap");
        } else {
          d("display", "-webkit-box");
          d("-webkit-box-orient", "vertical");
          d("-webkit-line-clamp", String(statement.lines));
          d("line-clamp", String(statement.lines));
          d("overflow", "hidden");
        }
        break;
      case "custom-font":
        d("font-family", fontStack(statement.name, context));
        break;
      case "custom-shadow": {
        const inset = statement.inner ? "inset " : "";
        let geometry: string;
        if (statement.blur !== null) {
          geometry = `${statement.x === null ? "0" : length(statement.x)} ${statement.y === null ? "0" : length(statement.y)} ${length(statement.blur)}`;
        } else {
          geometry = statement.preset !== null ? SHADOW_GEOMETRY[statement.preset] : "0 2px 4px";
        }
        d("box-shadow", `${inset}${geometry} ${statement.color === null ? "#0000001f" : color(statement.color)}`);
        break;
      }
      case "filter":
        if (statement.mode === "blur") {
          addFilter(`blur(${length(statement.amount)})`);
        } else {
          // Safari 16.4 to 17 needs the prefix (D-35).
          d("-webkit-backdrop-filter", `blur(${length(statement.amount)})`);
          d("backdrop-filter", `blur(${length(statement.amount)})`);
        }
        break;
      case "rotate":
        d("rotate", `${number(statement.degrees)}deg`);
        transformBox = true;
        break;
      case "move":
        d("translate", `${statement.x === null ? "0" : length(statement.x)} ${statement.y === null ? "0" : length(statement.y)}`);
        transformBox = true;
        break;
      case "scale":
        d("scale", number(statement.percentage / 100));
        transformBox = true;
        break;
      case "image-filter":
        addFilter(`${statement.fn}(${number(statement.percent)}%)`);
        break;
      case "generative-background": {
        // F8: soft colour spots over the first colour; an aurora is larger and drifts.
        const [first, ...rest] = statement.colors;
        d("background-color", color(first!));
        const aurora = statement.style === "aurora";
        rest.forEach((value, index) => layers.push({ image: `radial-gradient(at ${MESH_SPOTS[index]}, ${color(value)} 0px, transparent ${aurora ? 50 : 55}%)`, size: aurora ? "200% 200%" : "auto", order: 2 }));
        break;
      }
      case "pattern": {
        const ink = statement.color === null ? "color-mix(in srgb, currentColor 24%, transparent)" : color(statement.color);
        if (statement.pattern === "dotted") layers.push({ image: `radial-gradient(${ink} 1px, transparent 1.5px)`, size: "16px 16px", order: 1 });
        else if (statement.pattern === "lined") layers.push({ image: `linear-gradient(${ink} 1px, transparent 1px)`, size: "100% 24px", order: 1 });
        else {
          layers.push({ image: `linear-gradient(${ink} 1px, transparent 1px)`, size: "24px 24px", order: 1 });
          layers.push({ image: `linear-gradient(90deg, ${ink} 1px, transparent 1px)`, size: "24px 24px", order: 1 });
        }
        break;
      }
      case "grain":
        layers.push({ image: GRAIN, size: "160px 160px", order: 0 });
        break;
      case "embed":
        // F8: an embed keeps a video shape unless the author gives one.
        if (!statements.some((other) => other.type === "aspect-ratio")) d("aspect-ratio", "16 / 9");
        break;
      case "typography":
        // F8: a built-in icon strokes in currentColor, so its colour is the text colour.
        if (context.kind === "icon" && statement.property === "color") d("color", color(statement.value));
        break;
      case "overlay":
        overlay = `color-mix(in srgb, ${color(statement.color)} ${number(statement.percent)}%, transparent)`;
        break;
      case "masonry":
        // F8: columns that items flow down, with no gaps under short items.
        d("display", "block");
        d("column-count", String(statement.columns));
        break;
      case "snap": {
        const row = statements.some((s) => s.type === "layout" && s.property === "direction" && s.value === "row");
        d("scroll-snap-type", `${row ? "x" : "y"} mandatory`);
        break;
      }
      case "scroll-effect":
        // F8: the bar grows from the left as the page scrolls (see lowerExtraRules).
        if (statement.effect === "progress") {
          d("transform-origin", "left center");
          d("scale", "0 1");
        }
        break;
      case "shape": {
        const [property, value] = SHAPES[statement.shape]!;
        d(property, value);
        break;
      }
      case "loop": {
        const loop = LOOP_KEYFRAMES[statement.effect]!;
        const duration = statement.duration === null ? loop.duration : `${number(statement.duration.value)}${statement.duration.unit}`;
        d("animation", `kdm-loop-${statement.effect} ${duration} ${loop.timing} infinite`);
        transformBox = true;
        break;
      }
      default:
        break;
    }
  }
  if (filterAt !== -1) out[filterAt] = { property: "filter", value: filters.join(" ") };
  // F8: grain over a pattern over a mesh; sizes are listed per layer.
  if (layers.length > 0) {
    const ordered = [...layers].sort((a, b) => a.order - b.order);
    out.push({ property: "background-image", value: ordered.map((layer) => layer.image).join(", ") });
    if (ordered.some((layer) => layer.size !== "auto")) out.push({ property: "background-size", value: ordered.map((layer) => layer.size).join(", ") });
  }
  // F8: an overlay is the top background layer, over any image or gradient.
  if (overlay !== null) {
    const layer = `linear-gradient(${overlay}, ${overlay})`;
    const image = out.findIndex((declaration) => declaration.property === "background-image");
    if (image === -1) out.push({ property: "background-image", value: layer });
    else out[image] = { property: "background-image", value: `${layer}, ${out[image]!.value}` };
    const size = layers.length === 0 ? -1 : out.findIndex((declaration) => declaration.property === "background-size");
    if (size !== -1) out[size] = { property: "background-size", value: `auto, ${out[size]!.value}` };
  }
  // Inline links cannot be transformed; give them a transformable box.
  if (transformBox && context.kind === "link") d("display", "inline-block");
  return out;
}

function spot(horizontal: "left" | "center" | "right", vertical: "top" | "center" | "bottom"): string {
  return horizontal === "center" && vertical === "center" ? "center" : `${horizontal} ${vertical}`;
}

function stateSelector(state: InteractionState, context: F3Context): string {
  const base = `.${context.className}`;
  const field = FIELD_KINDS.has(context.kind);
  switch (state) {
    case "hovered":
      return field ? `${base}:hover .kdm-field-input` : `${base}:hover`;
    case "focused":
      if (field) return `${base} .kdm-field-input:focus-visible`;
      if (context.kind === "checkbox" || context.kind === "radio group") return `${base}:has(:focus-visible)`;
      return `${base}:focus-visible`;
    case "pressed":
      return `${base}:active`;
    case "disabled":
      if (field) return `${base} .kdm-field-input:disabled`;
      if (context.kind === "checkbox") return `${base}:has(:disabled)`;
      return `${base}:disabled`;
    case "checked":
      return `${base}:has(.kdm-checkbox-input:checked)`;
    case "invalid":
      return `${base} .kdm-field-input:user-invalid`;
  }
}

function effectDeclarations(effect: StateEffect): IrDeclaration[] {
  switch (effect.type) {
    case "background":
      return [{ property: "background-color", value: color(effect.color) }];
    case "text":
      return [{ property: "color", value: color(effect.color) }];
    case "border":
      return [{ property: "border-color", value: color(effect.color) }];
    case "lift":
      return [{ property: "translate", value: `0 ${length({ ...effect.distance, value: -effect.distance.value })}` }];
    case "scale":
      return [{ property: "scale", value: number(effect.percentage.value / 100) }];
    case "rotate":
      return [{ property: "rotate", value: `${number(effect.degrees)}deg` }];
    case "in-color":
      return [{ property: "filter", value: "none" }];
    case "tilt":
      return [{ property: "transform", value: `perspective(800px) rotateX(${number(effect.degrees / 2)}deg) rotateY(${number(-effect.degrees)}deg)` }];
  }
}

/** Interaction states, grouped by state in first-written order. */
export function lowerStates(element: ElementNode, context: F3Context): {
  states: IrStateStyle[];
  transitions: IrTransition[];
} {
  const states: IrStateStyle[] = [];
  const transitions: IrTransition[] = [];
  for (const statement of element.statements) {
    if (statement.type !== "state") continue;
    const selector = stateSelector(statement.state, context);
    let entry = states.find((candidate) => candidate.selector === selector);
    if (entry === undefined) {
      entry = { state: statement.state, selector, declarations: [] };
      states.push(entry);
    }
    const declarations = effectDeclarations(statement.effect);
    (entry.declarations as IrDeclaration[]).push(...declarations);
    const duration = statement.duration === undefined
      ? `${GLOBAL_TOKENS.hoverDuration}ms`
      : `${number(statement.duration.value)}${statement.duration.unit}`;
    for (const declaration of declarations) {
      if (!transitions.some((transition) => transition.property === declaration.property)) {
        transitions.push({ property: declaration.property, duration });
      }
    }
  }
  return { states, transitions };
}

/** Extra rules: scroll entrances (behind @supports) and staggered children. */
export function lowerExtraRules(element: ElementNode, context: F3Context): IrRule[] {
  const rules: IrRule[] = [];
  const base = `.${context.className}`;
  for (const statement of element.statements) {
    if (statement.type === "scroll-entrance") {
      const name = statement.effect === "fade" ? "kdm-fade-in" : `kdm-slide-in-${statement.direction ?? "bottom"}`;
      // Scroll-driven animation is progressive: browsers without it show the
      // element immediately (D-35 matrix: Safari 16.4 and Firefox lack it).
      rules.push({
        at: "@supports (animation-timeline: view())",
        selector: base,
        declarations: [
          { property: "animation", value: `${name} linear both` },
          { property: "animation-timeline", value: "view()" },
          { property: "animation-range", value: "entry 0% entry 100%" },
        ],
        reducedMotion: true,
      });
    } else if (statement.type === "generative-background" && statement.style === "aurora") {
      rules.push({
        at: null,
        selector: base,
        declarations: [{ property: "animation", value: "kdm-aurora 20s ease-in-out infinite alternate" }],
        reducedMotion: true,
      });
    } else if (statement.type === "masonry") {
      const gap = element.statements.find((s) => s.type === "layout" && s.property === "gap");
      const space = gap?.type === "layout" && gap.property === "gap" ? length(gap.value) : "16px";
      rules.push({
        at: null,
        selector: `${base} > *`,
        declarations: [
          { property: "break-inside", value: "avoid" },
          { property: "margin-bottom", value: space },
          { property: "width", value: "100%" },
        ],
        reducedMotion: false,
      });
    } else if (statement.type === "snap") {
      rules.push({
        at: null,
        selector: `${base} > *`,
        declarations: [{ property: "scroll-snap-align", value: "start" }, { property: "flex-shrink", value: "0" }],
        reducedMotion: false,
      });
    } else if (statement.type === "scroll-effect") {
      // F8: scroll-driven, so it needs no script; older browsers show the element still.
      rules.push(statement.effect === "parallax"
        ? {
            at: "@supports (animation-timeline: view())",
            selector: base,
            declarations: [
              { property: "animation", value: "kdm-parallax linear both" },
              { property: "animation-timeline", value: "view()" },
              { property: "animation-range", value: "cover 0% cover 100%" },
            ],
            reducedMotion: true,
          }
        : {
            at: "@supports (animation-timeline: scroll())",
            selector: base,
            declarations: [
              { property: "animation", value: "kdm-scroll-progress linear both" },
              { property: "animation-timeline", value: "scroll(root)" },
            ],
            // Progress follows the reader's own scrolling, so it stays on.
            reducedMotion: false,
          });
    } else if (statement.type === "stagger") {
      const name = statement.effect === "fade" ? "kdm-fade-in" : `kdm-slide-in-${statement.direction ?? "bottom"}`;
      rules.push({
        at: null,
        selector: `${base} > *`,
        declarations: [{ property: "animation", value: `${name} ${GLOBAL_TOKENS.entranceDuration}ms ease-out both` }],
        reducedMotion: true,
      });
      element.children.forEach((_child, index) => {
        if (index === 0) return;
        rules.push({
          at: null,
          selector: `${base} > :nth-child(${index + 1})`,
          declarations: [{ property: "animation-delay", value: `${index * 100}ms` }],
          reducedMotion: false,
        });
      });
    }
  }
  return rules;
}

/** True when the element has a looping animation in any scope. */
export function hasLoop(statements: readonly StatementNode[]): boolean {
  return statements.some((statement) => statement.type === "loop");
}
