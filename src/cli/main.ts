#!/usr/bin/env node
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { compileText } from "../compiler/compile.js";
import { compileProject } from "../compiler/project.js";
import { formatDiagnostics } from "../core/diagnostics/format.js";
import { runCheckCommand } from "./check-command.js";
import { runDevCommand } from "./dev-command.js";
import { runKeywordsCommand } from "./keywords-command.js";
import { parseText } from "../core/parser/parser.js";
import { SourceFile } from "../core/source/source-file.js";
import { compileV02Text } from "../v02/compile.js";
import { isV02Source, parseModuleText } from "../v02/parser.js";
import {
  TARGET_IDS,
  isTargetId,
  type TargetId,
} from "../v02/target.js";
import { KADAM_VERSION, UI_LANGUAGE_VERSIONS } from "../version.js";

const args = process.argv.slice(2);
const first = args[0];

if (first === "--version" || first === "-v") {
  console.log(`kadam ${KADAM_VERSION} (language ${UI_LANGUAGE_VERSIONS.join(", ")})`);
  process.exit(0);
}

if (first === "--help" || first === "-h" || first === "help") {
  printHelp();
  process.exit(0);
}

if (args.length === 0) {
  printHelp();
  process.exit(2);
}

if (first === "parse") {
  const file = args[1];
  if (file === undefined) {
    console.error("kadam parse: expected a source file path");
    process.exit(2);
  }

  const text = readSource(file, "parse");
  if (isV02Source(text)) {
    const result = parseModuleText(file, text);
    console.log(JSON.stringify(result.module, null, 2));
    if (result.diagnostics.length > 0) {
      console.error(formatDiagnostics(result.diagnostics, [result.source]));
      process.exit(1);
    }
    process.exit(0);
  }
  const result = parseText(file, text);
  console.log(JSON.stringify(result.document, null, 2));
  if (result.diagnostics.length > 0) {
    for (const diagnostic of result.diagnostics) {
      const span = diagnostic.span;
      console.error(
        `error[${diagnostic.code}]: ${diagnostic.message} (${span.file}:${span.start.line}:${span.start.column})`,
      );
      if (diagnostic.hint !== undefined) console.error(`  hint: ${diagnostic.hint}`);
    }
    process.exit(1);
  }
  process.exit(0);
}

if (first === "check") {
  runCheckCommand(args.slice(1));
  process.exit(0);
}

if (first === "keywords") {
  process.exit(runKeywordsCommand(args.slice(1)));
}

if (first === "dev") {
  await runDevCommand(args.slice(1));
  process.exit(0);
}

if (first === "build") {
  const parsedArgs = parseBuildArguments(args.slice(1));
  if (parsedArgs === null) process.exit(2);

  const hasProjectFlag = parsedArgs.projectDir !== undefined;
  let isProject = hasProjectFlag;
  let targetPath = parsedArgs.projectDir ?? parsedArgs.source;

  if (!hasProjectFlag && targetPath !== undefined) {
    if (existsSync(targetPath)) {
      try {
        if (statSync(targetPath).isDirectory()) {
          isProject = true;
        }
      } catch {
        // ignore
      }
    }
  }

  if (isProject) {
    if (parsedArgs.target !== undefined) {
      console.error(
        "kadam build: --target is supported for single kadam 0.2 module files, not projects",
      );
      process.exit(2);
    }
    const projectDir = targetPath ?? ".";
    const result = compileProject({
      projectRoot: projectDir,
      outDir: parsedArgs.outDir,
      basePath: parsedArgs.basePath,
    });

    if (!result.ok) {
      console.error(formatDiagnostics(result.diagnostics, result.sources));
      console.error(
        `\nkadam build: ${result.diagnostics.length} diagnostic${
          result.diagnostics.length === 1 ? "" : "s"
        }; no files were written.`,
      );
      process.exit(1);
    }

    try {
      writeOutputFiles(projectDir, result.outDir, result.files);
    } catch (error) {
      console.error(
        `kadam build: cannot write ${result.outDir}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      process.exit(1);
    }

    console.log(`Built project ${projectDir} -> ${result.outDir}`);
    for (const file of result.files) {
      console.log(`  ${join(result.outDir, file.path)}`);
    }
    process.exit(0);
  }

  // Single-file build
  const file = targetPath;
  if (file === undefined) {
    console.error("kadam build: expected a source file path (.kdm) or project directory (--project <dir>)");
    process.exit(2);
  }
  if (!file.endsWith(".kdm")) {
    console.error("kadam build: source files must use the .kdm extension");
    process.exit(2);
  }

  const outDir = parsedArgs.outDir ?? "dist";
  const text = readSource(file, "build");
  if (isV02Source(text)) {
    const target = parsedArgs.target ?? "typescript";
    const result = compileV02Text(file, text, { target });
    if (!result.ok) {
      console.error(formatDiagnostics(result.diagnostics, [result.source]));
      console.error(
        `\nkadam build: ${result.diagnostics.length} diagnostic${
          result.diagnostics.length === 1 ? "" : "s"
        }; no files were written.`,
      );
      process.exit(1);
    }

    try {
      writeOutputFiles(file, outDir, result.files);
    } catch (error) {
      console.error(
        `kadam build: cannot write ${outDir}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      process.exit(1);
    }

    console.log(`Built ${file} -> ${outDir} (target ${target})`);
    for (const output of result.files) {
      console.log(`  ${join(outDir, output.path)}`);
    }
    process.exit(0);
  }

  if (parsedArgs.target !== undefined) {
    console.error(
      "kadam build: --target is supported only for kadam 0.2 module files",
    );
    process.exit(2);
  }

  const result = compileText(file, text, { basePath: parsedArgs.basePath });

  if (!result.ok) {
    const source = new SourceFile(file, text);
    console.error(formatDiagnostics(result.diagnostics, [source]));
    console.error(
      `\nkadam build: ${result.diagnostics.length} diagnostic${
        result.diagnostics.length === 1 ? "" : "s"
      }; no files were written.`,
    );
    process.exit(1);
  }

  try {
    writeOutputFiles(file, outDir, result.files);
  } catch (error) {
    console.error(
      `kadam build: cannot write ${outDir}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    process.exit(1);
  }

  console.log(`Built ${file} -> ${outDir}`);
  for (const file of result.files) {
    console.log(`  ${join(outDir, file.path)}`);
  }
  process.exit(0);
}

console.error(
  `kadam: '${args.join(" ")}' is not available.\n` +
    "The CLI provides build, check, dev, keywords, and parse. Run kadam --help for usage.\n" +
    "See docs/roadmap.md for the implementation plan.",
);
process.exit(1);

function readSource(file: string, command: string): string {
  try {
    return readFileSync(file, "utf8");
  } catch (error) {
    console.error(
      `kadam ${command}: cannot read ${file}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    process.exit(1);
  }
}

interface BuildArguments {
  readonly source: string | undefined;
  readonly target: TargetId | undefined;
  readonly projectDir: string | undefined;
  readonly outDir: string | undefined;
  readonly basePath: string | undefined;
}

function parseBuildArguments(rawArgs: readonly string[]): BuildArguments | null {
  let source: string | undefined;
  let target: TargetId | undefined;
  let projectDir: string | undefined;
  let outDir: string | undefined;
  let basePath: string | undefined;

  for (let index = 0; index < rawArgs.length; index += 1) {
    const argument = rawArgs[index]!;
    if (argument === "--target") {
      const value = rawArgs[index + 1];
      if (value === undefined || value === "") {
        console.error(
          `kadam build: --target requires ${TARGET_IDS.join(" or ")}`,
        );
        return null;
      }
      if (!isTargetId(value)) {
        console.error(
          `kadam build: unknown target ${JSON.stringify(value)}; expected ${TARGET_IDS.join(
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
          `kadam build: unknown target ${JSON.stringify(value)}; expected ${TARGET_IDS.join(
            " or ",
          )}`,
        );
        return null;
      }
      target = value;
      continue;
    }
    if (argument === "--out" || argument === "-o") {
      const value = rawArgs[index + 1];
      if (value === undefined || value === "") {
        console.error("kadam build: --out requires a directory path");
        return null;
      }
      outDir = value;
      index += 1;
      continue;
    }
    if (argument.startsWith("--out=")) {
      const value = argument.slice("--out=".length);
      if (value === "") {
        console.error("kadam build: --out requires a directory path");
        return null;
      }
      outDir = value;
      continue;
    }
    if (argument === "--project" || argument === "-p") {
      const value = rawArgs[index + 1];
      if (value === undefined || value === "") {
        console.error("kadam build: --project requires a directory path");
        return null;
      }
      projectDir = value;
      index += 1;
      continue;
    }
    if (argument.startsWith("--project=")) {
      const value = argument.slice("--project=".length);
      if (value === "") {
        console.error("kadam build: --project requires a directory path");
        return null;
      }
      projectDir = value;
      continue;
    }
    if (argument === "--base-path" || argument === "-b") {
      const value = rawArgs[index + 1];
      if (value === undefined || value === "") {
        console.error("kadam build: --base-path requires a path string");
        return null;
      }
      basePath = value;
      index += 1;
      continue;
    }
    if (argument.startsWith("--base-path=")) {
      const value = argument.slice("--base-path=".length);
      if (value === "") {
        console.error("kadam build: --base-path requires a path string");
        return null;
      }
      basePath = value;
      continue;
    }
    if (argument.startsWith("-")) {
      console.error(`kadam build: unexpected argument ${JSON.stringify(argument)}`);
      return null;
    }

    if (source === undefined) {
      source = argument;
    } else {
      console.error(`kadam build: unexpected argument ${JSON.stringify(argument)}`);
      return null;
    }
  }

  return { source, target, projectDir, outDir, basePath };
}

/**
 * Writes a complete output tree atomically.
 *
 * Files are staged in a sibling directory and the finished tree is swapped in
 * with renames, so a failure leaves the previous output untouched and never
 * produces a half-written site. The output directory is replaced wholesale,
 * which also removes stale pages from earlier builds; directories containing
 * Kadam sources are refused instead of being deleted.
 */
function writeOutputFiles(
  sourcePathOrDir: string,
  outDir: string,
  files: readonly { readonly path: string; readonly contents: string | Uint8Array }[],
): void {
  const sourcePath = resolve(sourcePathOrDir);
  const projectRoot = isDirectory(sourcePath) ? sourcePath : dirname(sourcePath);
  const root = resolve(outDir);

  if (root === projectRoot) {
    throw new Error("the output directory cannot be the project root");
  }
  if (root === sourcePath) {
    throw new Error("the output directory cannot be the source directory or file");
  }
  if (sourcePath.startsWith(root + sep)) {
    throw new Error("the output directory cannot contain the project source");
  }

  if (existsSync(root)) {
    if (!isDirectory(root)) {
      throw new Error(`${outDir} exists and is not a directory`);
    }
    assertReplaceableOutputDirectory(root);
  }

  const parent = dirname(root);
  mkdirSync(parent, { recursive: true });
  const stage = join(
    parent,
    `.${basename(root)}.kadam-stage-${process.pid}`,
  );
  const backup = join(
    parent,
    `.${basename(root)}.kadam-previous-${process.pid}`,
  );

  rmSync(stage, { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });

  try {
    for (const file of files) {
      const target = resolve(stage, file.path);
      const relation = relative(stage, target);
      if (relation.startsWith("..") || isAbsolute(relation)) {
        throw new Error(`refusing to write outside the output directory: ${file.path}`);
      }
      if (target.endsWith(".kdm")) {
        throw new Error(`refusing to overwrite a Kadam source file: ${target}`);
      }

      mkdirSync(dirname(target), { recursive: true });
      if (typeof file.contents === "string") {
        writeFileSync(target, file.contents, "utf8");
      } else {
        writeFileSync(target, file.contents);
      }
    }
  } catch (error) {
    rmSync(stage, { recursive: true, force: true });
    throw error;
  }

  const previousExists = existsSync(root);
  try {
    if (previousExists) {
      rmSync(backup, { recursive: true, force: true });
      renameSync(root, backup);
    }
    renameSync(stage, root);
  } catch (error) {
    rmSync(stage, { recursive: true, force: true });
    if (previousExists && !existsSync(root) && existsSync(backup)) {
      try {
        renameSync(backup, root);
      } catch {
        // The original output is left at the backup path if the restore fails.
      }
    }
    throw error;
  }

  if (previousExists) rmSync(backup, { recursive: true, force: true });
}

/** Refuses to replace a directory that holds sources or metadata. */
function assertReplaceableOutputDirectory(root: string): void {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(
        `refusing to replace an output directory containing a symbolic link: ${path}`,
      );
    }
    if (entry.isDirectory()) {
      assertReplaceableOutputDirectory(path);
      continue;
    }
    if (entry.name === "kadam.json" || entry.name.endsWith(".kdm")) {
      throw new Error(
        `refusing to replace an output directory containing Kadam sources: ${path}`,
      );
    }
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function printHelp(): void {
  console.log(`Kadam — a deterministic natural-language language

Usage:
  kadam <command> [options]

Commands:
  parse <file>                        Parse one .kdm file and print its AST as JSON
  build [path] [options]              Compile a .kdm page, project, or v0.2 module
  check [path] [options]              Validate a page, project, or v0.2 module
  dev [project] [options]             Start the development server with live reload
  keywords [--colors|--core|          Print reserved words or property names
           --properties|--all]        (add --json for JSON)

Build and check options:
  -p, --project <dir>                 Project directory containing kadam.json
  -o, --out <dir>                     Output directory (default: dist; build only)
  -b, --base-path <path>              Deployment base path (e.g. /subpath)
      --target <id>                   Target for a kadam 0.2 module: typescript or python
                                       (build defaults to typescript; check is core-only
                                       unless a target is supplied)

Dev options:
      --port <n>                      Port to listen on (default: 3000; 0 picks any)
      --host <host>                   Interface to bind (default: 127.0.0.1)
      --no-open                       Do not open a browser
      --poll                          Force polling file watching

Options:
  -v, --version                       Print the implementation and language versions
  -h, --help                          Print this help

Status:
  CLI-only distribution. The v0.1 UI compiler emits static web HTML/CSS. The
  v0.2 core compiler emits TypeScript or Python for one module file.

Documentation:
  README.md
  docs/language-spec.md
  docs/language-v0.2.md
  docs/multi-target.md
  docs/architecture.md
  docs/roadmap.md
  docs/decisions.md`);
}
