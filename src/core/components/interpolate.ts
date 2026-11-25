import type { Span } from "../source/source-file.js";

export interface InterpolationBinding {
  readonly value: string;
  readonly span: Span;
}

export type InterpolationBindings = ReadonlyMap<string, InterpolationBinding>;

export interface InterpolationResult {
  readonly value: string;
  /** The first binding span when a substitution changed the value. */
  readonly span: Span;
  readonly missing: readonly string[];
}

const PLACEHOLDER = /\{\$([a-z][A-Za-z0-9]{0,63})\}/g;

/** True when text contains a `{$...}` sequence that is not a valid placeholder. */
export function hasMalformedInterpolation(value: string): boolean {
  return value.replace(PLACEHOLDER, "").includes("{$");
}

/** One-pass `{$name}` substitution. Inserted text is never scanned again. */
export function interpolateValue(
  value: string,
  span: Span,
  bindings: InterpolationBindings,
): InterpolationResult {
  let replaced = false;
  let replacementSpan: Span | null = null;
  const missing: string[] = [];

  const result = value.replace(PLACEHOLDER, (placeholder, name: string) => {
    const binding = bindings.get(name);
    if (binding === undefined) {
      missing.push(name);
      return placeholder;
    }
    if (!replaced) {
      replaced = true;
      replacementSpan = binding.span;
    }
    return binding.value;
  });

  return {
    value: result,
    span: replacementSpan ?? span,
    missing,
  };
}