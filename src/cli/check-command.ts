import { readFileSync, statSync } from "node:fs";
import { compileText } from "../compiler/compile.js";
import { compileProject } from "../compiler/project.js";
import { formatDiagnostics } from "../core/diagnostics/format.js";
import { SourceFile } from "../core/source/source-file.js";
import type { Diagnostic } from "../core/diagnostics/diagnostic.js";

interface CheckArguments {
  readonly target: string | undefined;
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

  const target = parsed.projectDir ?? parsed.target;
  if (target === undefined) {
    console.error(
      "kadam check: expected a source file (.kdm) or project directory",
    );
    process.exit(2);
  }

  if (parsed.projectDir !== undefined || isDirectory(target)) {
    const result = compileProject({
      projectRoot: target,
      basePath: parsed.basePath,
    });
    report(
      result.diagnostics,
      result.sources,
      result.manifest?.pages.length ?? result.pages.length,
      target,
    );
    return;
  }

  if (!target.endsWith(".kdm")) {
    console.error("kadam check: source files must use the .kdm extension");
    process.exit(2);
  }

  let text: string;
  try {
    text = readFileSync(target, "utf8");
  } catch (error) {
    console.error(
      `kadam check: cannot read ${target}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    process.exit(1);
  }

  const result = compileText(target, text, {
    basePath: parsed.basePath,
  });
  const source = new SourceFile(target, text);
  report(result.diagnostics, [source], result.page === null ? 0 : 1, target);
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

  console.log(
    `kadam check: ${target} is valid (${pages} page${
      pages === 1 ? "" : "s"
    }). No files were written.`,
  );
}

function parseCheckArguments(
  rawArgs: readonly string[],
): CheckArguments | null {
  let target: string | undefined;
  let projectDir: string | undefined;
  let basePath: string | undefined;

  for (let index = 0; index < rawArgs.length; index += 1) {
    const argument = rawArgs[index]!;
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
    if (target !== undefined) {
      console.error(
        `kadam check: unexpected argument ${JSON.stringify(argument)}`,
      );
      return null;
    }
    target = argument;
  }

  return { target, projectDir, basePath };
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
