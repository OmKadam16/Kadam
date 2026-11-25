import { DiagnosticBag } from "../core/diagnostics/diagnostic.js";
import type { IrExternal, IrModule, IrProvider } from "./ir.js";

export type TargetId = "typescript" | "python";

export const TARGET_IDS: readonly TargetId[] = ["typescript", "python"];

export function isTargetId(value: string): value is TargetId {
  return value === "typescript" || value === "python";
}

export interface OutputFile {
  readonly path: string;
  readonly contents: string;
}

export interface ExternalBinding {
  readonly external: IrExternal;
  readonly provider: IrProvider;
  readonly index: number;
  readonly alias: string;
}

export const TARGET_CAPABILITIES: ReadonlySet<string> = new Set([
  "io.output",
  "io.file.read",
  "io.file.write",
  "env.read",
  "env.write",
]);

export function bindExternals(
  program: IrModule,
  target: TargetId,
  diagnostics: DiagnosticBag,
): readonly ExternalBinding[] {
  const bindings: ExternalBinding[] = [];
  for (const external of program.externals) {
    const provider = external.providers.find((item) => item.target === target);
    if (provider === undefined) {
      diagnostics.error(
        "KDM5008",
        `target ${JSON.stringify(target)} has no provider for external function ${JSON.stringify(
          external.name,
        )}`,
        external.nameSpan,
        `add provided by ${JSON.stringify(target)} as "module#symbol"`,
      );
      continue;
    }

    const symbolError = validateProvider(target, provider);
    if (symbolError !== null) {
      diagnostics.error(
        "KDM5014",
        symbolError,
        provider.symbolSpan,
        'provider symbols use the form "module#symbol"',
      );
      continue;
    }

    bindings.push({
      external,
      provider,
      index: bindings.length,
      alias: `kadam_external_${bindings.length}`,
    });
  }
  return bindings;
}

export function validateTargetEffects(
  program: IrModule,
  target: TargetId,
  capabilities: ReadonlySet<string>,
  diagnostics: DiagnosticBag,
): void {
  for (const fn of program.functions) {
    for (const effect of fn.effects) {
      if (capabilities.has(effect)) continue;
      diagnostics.error(
        "KDM5009",
        `target ${JSON.stringify(target)} does not support effect ${JSON.stringify(
          effect,
        )} required by function ${JSON.stringify(fn.name)}`,
        fn.nameSpan,
        "remove the effect, or choose a target that declares the capability",
      );
    }
  }
  for (const external of program.externals) {
    for (const effect of external.effects) {
      if (capabilities.has(effect)) continue;
      diagnostics.error(
        "KDM5009",
        `target ${JSON.stringify(target)} does not support effect ${JSON.stringify(
          effect,
        )} required by external function ${JSON.stringify(external.name)}`,
        external.nameSpan,
        "remove the effect, or choose a target that declares the capability",
      );
    }
  }
}

function validateProvider(target: TargetId, provider: IrProvider): string | null {
  const symbol = provider.symbol;
  const hash = symbol.indexOf("#");
  if (hash <= 0 || hash === symbol.length - 1 || symbol.indexOf("#", hash + 1) !== -1) {
    return `target ${JSON.stringify(target)} provider ${JSON.stringify(symbol)} must use module#symbol`;
  }
  const moduleName = symbol.slice(0, hash);
  const nativeName = symbol.slice(hash + 1);

  if (target === "python") {
    if (!/^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(moduleName)) {
      return `target "python" provider module ${JSON.stringify(moduleName)} must be a dotted Python module name`;
    }
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(nativeName)) {
      return `target "python" provider symbol ${JSON.stringify(nativeName)} must be a Python identifier`;
    }
    return null;
  }

  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(nativeName)) {
    return `target "typescript" provider symbol ${JSON.stringify(nativeName)} must be a JavaScript identifier`;
  }
  return null;
}

/** Canonical binary64 text shared by literal emission and the TypeScript runtime. */
export function formatCoreNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new RangeError("cannot emit a non-finite number literal");
  }
  if (Object.is(value, -0) || value === 0) return "0";
  let text = value.toString();
  if (text.includes("e")) {
    text = text.replace("e+", "e");
    text = text.replace(/e(-?)0+(\d+)/, "e$1$2");
  }
  return text;
}

export function pythonNumberLiteral(value: number): string {
  const text = formatCoreNumber(value);
  if (text.includes(".") || text.includes("e")) return text;
  return `${text}.0`;
}

export function typescriptString(value: string): string {
  return JSON.stringify(value);
}

export function pythonString(value: string): string {
  let text = '"';
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    if (character === "\\") text += "\\\\";
    else if (character === '"') text += '\\"';
    else if (character === "\n") text += "\\n";
    else if (character === "\r") text += "\\r";
    else if (character === "\t") text += "\\t";
    else if (character === "\b") text += "\\b";
    else if (character === "\f") text += "\\f";
    else if (codePoint < 0x20 || codePoint === 0x7f) {
      text += `\\x${codePoint.toString(16).padStart(2, "0")}`;
    } else if (codePoint >= 0xd800 && codePoint <= 0xdfff) {
      text += `\\u${codePoint.toString(16).padStart(4, "0")}`;
    } else {
      text += character;
    }
  }
  return `${text}"`;
}
