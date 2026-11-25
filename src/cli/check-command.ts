import { readFileSync, statSync } from "node:fs";
import { compileText } from "../compiler/compile.js";
import { compileProject } from "../compiler/project.js";
import { formatDiagnostics } from "../core/diagnostics/format.js";
import { SourceFile } from "../core/source/source-file.js";
import type { Diagnostic } from "../core/diagnostics/diagnostic.js";
import { compileV02Text, type CompileV02Result } from "../v02/compile.js";
import { isV02Source } from "../v02/parser.js";
import {
  TARGET_IDS,
  isTargetId,
  type TargetId,
} from "../v02/target.js";

interface CheckArguments {
  readonly source: string | undefined;
  readonly target: TargetId | undefined;
  readonly projectDir: string | undefined;
  readonly basePath: string | undefined;
}

/**
 * Validate a project or a single page without writing output, starting a
 * server, or modifying source. Everything is delegated to the same compiler
 * entry points that `build` uses.
 */
export function runCheckCommand(rawArgs: readonly string[]): void {
  const parsed = parseCheckArguments(rawArgs);
  if (parsed === null) process.exit(2);

  const sourcePath = parsed.projectDir ?? parsed.source;
  if (sourcePath === undefined) {
    console.error(
      "kadam check: expected a source file (.kdm) or project directory",
    );
    process.exit(2);
  }

  if (parsed.projectDir !== undefined || isDirectory(sourcePath)) {
    if (parsed.target !== undefined) {
      console.error(
        "kadam check: --target is supported for single kadam 0.2 module files, not projects",
      );
      process.exit(2);
    }
    const result = compileProject({
      projectRoot: sourcePath,
      basePath: parsed.basePath,
    });
    report(
      result.diagnostics,
      result.sources,
      result.manifest?.pages.length ?? result.pages.length,
      sourcePath,
    );
    return;
  }

  if (!sourcePath.endsWith(".kdm")) {
    console.error("kadam check: source files must use the .kdm extension");
    process.exit(2);
  }

  let text: string;
  try {
    text = readFileSync(sourcePath, "utf8");
  } catch (error) {
    console.error(
      `kadam check: cannot read ${sourcePath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    process.exit(1);
  }

  if (isV02Source(text)) {
    const result = compileV02Text(
      sourcePath,
      text,
      parsed.target === undefined ? {} : { target: parsed.target },
    );
    reportV02(result, sourcePath, parsed.target);
    return;
  }

  if (parsed.target !== undefined) {
    console.error(
      "kadam check: --target is supported only for kadam 0.2 module files",
    );
    process.exit(2);
  }

  const result = compileText(sourcePath, text, {
    basePath: parsed.basePath,
  });
  const source = new SourceFile(sourcePath, text);
  report(result.diagnostics, [source], result.page === null ? 0 : 1, sourcePath);
}

function report(
  diagnostics: readonly Diagnostic[],
  sources: readonly SourceFile[],
  pages: number,
  target: string,
): void {
  if (diagnostics.length > 0) {
    console.error(formatDiagnostics(diagnostics, sources));
  }

  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    console.error(
      `\nkadam check: ${diagnostics.length} diagnostic${
        diagnostics.length === 1 ? "" : "s"
      } in ${target}. No files were written.`,
    );
    process.exit(1);
  }

  if (diagnostics.length > 0) console.error("");
  console.log(
    `kadam check: ${target} is valid (${pages} page${
      pages === 1 ? "" : "s"
    }). No files were written.`,
  );
}

function reportV02(
  result: CompileV02Result,
  target: string,
  targetId: TargetId | undefined,
): void {
  if (result.diagnostics.length > 0) {
    console.error(formatDiagnostics(result.diagnostics, [result.source]));
  }

  if (result.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    console.error(
      `\nkadam check: ${result.diagnostics.length} diagnostic${
        result.diagnostics.length === 1 ? "" : "s"
      } in ${target}. No files were written.`,
    );
    process.exit(1);
  }

  const moduleName = result.module?.name ?? "module";
  const targetText = targetId === undefined ? "" : ` for target ${targetId}`;
  console.log(
    `kadam check: ${target} is valid (module ${moduleName}${targetText}). No files were written.`,
  );
}

function parseCheckArguments(
  rawArgs: readonly string[],
): CheckArguments | null {
  let source: string | undefined;
  let target: TargetId | undefined;
  let projectDir: string | undefined;
  let basePath: string | undefined;

  for (let index = 0; index < rawArgs.length; index += 1) {
    const argument = rawArgs[index]!;
    if (argument === "--target") {
      const value = rawArgs[index + 1];
      if (value === undefined || value === "") {
        console.error(
          `kadam check: --target requires ${TARGET_IDS.join(" or ")}`,
        );
        return null;
      }
      if (!isTargetId(value)) {
        console.error(
          `kadam check: unknown target ${JSON.stringify(value)}; expected ${TARGET_IDS.join(
            " or ",
          )}`,
        );
        return null;
      }
      target = value;
      index += 1;
      continue;
    }
    if (argument.startsWith("--target=")) {
      const value = argument.slice("--target=".length);
      if (!isTargetId(value)) {
        console.error(
          `kadam check: unknown target ${JSON.stringify(value)}; expected ${TARGET_IDS.join(
            " or ",
          )}`,
        );
        return null;
      }
      target = value;
      continue;
    }
    if (argument === "--project" || argument === "-p") {
      const value = rawArgs[index + 1];
      if (value === undefined || value === "") {
        console.error("kadam check: --project requires a directory path");
        return null;
      }
      projectDir = value;
      index += 1;
      continue;
    }
    if (argument.startsWith("--project=")) {
      const value = argument.slice("--project=".length);
      if (value === "") {
        console.error("kadam check: --project requires a directory path");
        return null;
      }
      projectDir = value;
      continue;
    }
    if (argument === "--base-path" || argument === "-b") {
      const value = rawArgs[index + 1];
      if (value === undefined || value === "") {
        console.error("kadam check: --base-path requires a path string");
        return null;
      }
      basePath = value;
      index += 1;
      continue;
    }
    if (argument.startsWith("--base-path=")) {
      const value = argument.slice("--base-path=".length);
      if (value === "") {
        console.error("kadam check: --base-path requires a path string");
        return null;
      }
      basePath = value;
      continue;
    }
    if (argument.startsWith("-")) {
      console.error(
        `kadam check: unexpected argument ${JSON.stringify(argument)}`,
      );
      return null;
    }
    if (source !== undefined) {
      console.error(
        `kadam check: unexpected argument ${JSON.stringify(argument)}`,
      );
      return null;
    }
    source = argument;
  }

  return { source, target, projectDir, basePath };
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
