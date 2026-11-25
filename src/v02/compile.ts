import {
  DiagnosticBag,
  type Diagnostic,
} from "../core/diagnostics/diagnostic.js";
import type { SourceFile } from "../core/source/source-file.js";
import { analyzeModule } from "./analyze.js";
import { emitPython } from "./emit-python.js";
import { emitTypeScript } from "./emit-typescript.js";
import type { IrModule } from "./ir.js";
import { parseModuleText } from "./parser.js";
import {
  TARGET_CAPABILITIES,
  bindExternals,
  validateTargetEffects,
  type ExternalBinding,
  type OutputFile,
  type TargetId,
} from "./target.js";

export const TARGET_VERSION = "0.1.0";

export interface TargetAdapter {
  readonly id: TargetId;
  readonly version: string;
  readonly capabilities: ReadonlySet<string>;
  emit(
    program: IrModule,
    bindings: readonly ExternalBinding[],
  ): OutputFile;
}

const TYPESCRIPT_TARGET: TargetAdapter = {
  id: "typescript",
  version: TARGET_VERSION,
  capabilities: TARGET_CAPABILITIES,
  emit: emitTypeScript,
};

const PYTHON_TARGET: TargetAdapter = {
  id: "python",
  version: TARGET_VERSION,
  capabilities: TARGET_CAPABILITIES,
  emit: emitPython,
};

const TARGETS: ReadonlyMap<TargetId, TargetAdapter> = new Map([
  [TYPESCRIPT_TARGET.id, TYPESCRIPT_TARGET],
  [PYTHON_TARGET.id, PYTHON_TARGET],
]);

export function getTargetAdapter(target: TargetId): TargetAdapter {
  const adapter = TARGETS.get(target);
  if (adapter === undefined) throw new Error(`unknown target ${target}`);
  return adapter;
}

export interface CompileV02Options {
  readonly target?: TargetId;
}

export interface CompileV02Result {
  readonly ok: boolean;
  readonly source: SourceFile;
  readonly module: IrModule | null;
  readonly diagnostics: readonly Diagnostic[];
  readonly files: readonly OutputFile[];
}

/**
 * Parse, type-check, lower, validate against the selected target, and emit.
 * Target validation is intentionally a separate step before emission so a
 * module with an unsupported effect or missing provider cannot leave output.
 */
export function compileV02Text(
  path: string,
  text: string,
  options: CompileV02Options = {},
): CompileV02Result {
  const parsed = parseModuleText(path, text);
  const diagnostics = new DiagnosticBag();
  diagnostics.addAll(parsed.diagnostics);

  if (parsed.module === null) {
    return {
      ok: false,
      source: parsed.source,
      module: null,
      diagnostics: diagnostics.sorted(),
      files: [],
    };
  }

  const analyzed = analyzeModule(parsed.module);
  diagnostics.addAll(analyzed.diagnostics);
  if (analyzed.module === null) {
    return {
      ok: false,
      source: parsed.source,
      module: null,
      diagnostics: diagnostics.sorted(),
      files: [],
    };
  }

  if (diagnostics.hasErrors) {
    return {
      ok: false,
      source: parsed.source,
      module: analyzed.module,
      diagnostics: diagnostics.sorted(),
      files: [],
    };
  }

  if (options.target === undefined) {
    return {
      ok: true,
      source: parsed.source,
      module: analyzed.module,
      diagnostics: diagnostics.sorted(),
      files: [],
    };
  }

  const adapter = getTargetAdapter(options.target);
  const bindings = bindExternals(analyzed.module, adapter.id, diagnostics);
  validateTargetEffects(
    analyzed.module,
    adapter.id,
    adapter.capabilities,
    diagnostics,
  );

  if (diagnostics.hasErrors) {
    return {
      ok: false,
      source: parsed.source,
      module: analyzed.module,
      diagnostics: diagnostics.sorted(),
      files: [],
    };
  }

  return {
    ok: true,
    source: parsed.source,
    module: analyzed.module,
    diagnostics: diagnostics.sorted(),
    files: [adapter.emit(analyzed.module, bindings)],
  };
}
