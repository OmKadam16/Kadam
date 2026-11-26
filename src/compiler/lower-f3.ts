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
          d("filter", `blur(${length(statement.amount)})`);
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
