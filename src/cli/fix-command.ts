import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

import { compileText } from "../compiler/compile.js";
import { compileProject } from "../compiler/project.js";
import type { Diagnostic, DiagnosticFix } from "../core/diagnostics/diagnostic.js";
import { formatDiagnostic } from "../core/diagnostics/format.js";
import { SourceFile } from "../core/source/source-file.js";

/**
 * D-50: `kadam fix [path] [--first]`. The compiler never guesses what a
 * sentence means; it offers fixes, and this command applies the one you
 * choose. In a terminal it asks for each problem; `--first` takes fix 1 for
 * every problem and prints what it changed.
 */
export async function runFixCommand(args: readonly string[]): Promise<number> {
  const first = args.includes("--first");
  const paths = args.filter((arg) => !arg.startsWith("-"));
  const unknown = args.find((arg) => arg.startsWith("-") && arg !== "--first");
  if (unknown !== undefined || paths.length > 1) {
    console.error("kadam fix: usage: kadam fix [project or file] [--first]");
    return 2;
  }
  const target = resolve(paths[0] ?? ".");
  const interactive = !first && process.stdin.isTTY === true;
  const ask = interactive ? createInterface({ input: process.stdin, output: process.stdout }) : null;
  let changedAny = false;
  try {
    for (let pass = 0; pass < 5; pass += 1) {
      const { diagnostics, root } = compile(target);
      const fixable = diagnostics.filter((diagnostic) => (diagnostic.fixes?.length ?? 0) > 0);
      const errors = diagnostics.filter((diagnostic) => diagnostic.severity === "error");
      if (fixable.length === 0) {
        if (errors.length === 0) console.log(changedAny ? "kadam fix: everything is fixed." : "kadam fix: nothing to fix.");
        else console.log(`kadam fix: ${errors.length} ${errors.length === 1 ? "problem has" : "problems have"} no fix to offer; run kadam check to see ${errors.length === 1 ? "it" : "them"}.`);
        return errors.length === 0 ? 0 : 1;
      }
      if (!first && !interactive) {
        for (const diagnostic of fixable) console.log(`${describe(diagnostic, root)}\n`);
        console.log("kadam fix: run it in a terminal to choose a fix, or use --first to take fix 1 for each problem.");
        return 1;
      }
      // Choose one fix per problem, then apply them per file from the end backwards.
      const chosen = new Map<string, { fix: DiagnosticFix; diagnostic: Diagnostic }[]>();
      for (const diagnostic of fixable) {
        let fix: DiagnosticFix | undefined = diagnostic.fixes![0];
        if (ask !== null) {
          console.log(`\n${describe(diagnostic, root)}`);
          const answer = (await ask.question(`Choose a fix (1-${diagnostic.fixes!.length}), or press Enter to skip: `)).trim();
          const number = Number(answer);
          fix = answer === "" || !Number.isInteger(number) ? undefined : diagnostic.fixes![number - 1];
          if (answer !== "" && fix === undefined) console.log("  skipped: that is not one of the fixes");
        }
        if (fix === undefined) continue;
        const file = absolute(fix.span.file, root);
        chosen.set(file, [...(chosen.get(file) ?? []), { fix, diagnostic }]);
      }
      if (chosen.size === 0) {
        console.log("kadam fix: nothing was changed.");
        return 1;
      }
      for (const [file, edits] of chosen) {
        const source = new SourceFile(file, readFileSync(file, "utf8"));
        let text = source.text;
        let limit = Number.POSITIVE_INFINITY;
        for (const { fix } of [...edits].sort((a, b) => b.fix.span.start.offset - a.fix.span.start.offset)) {
          // Two fixes for one place: keep the later-starting one only.
          if (fix.span.end.offset > limit) continue;
          text = `${text.slice(0, fix.span.start.offset)}${fix.text}${text.slice(fix.span.end.offset)}`;
          limit = fix.span.start.offset;
          console.log(`  ${root === "" ? relative(process.cwd(), file) : relative(root, file)}:${fix.span.start.line}: ${fix.label}`);
        }
        writeFileSync(file, text);
        changedAny = true;
      }
      // Interactive runs check once more and stop; --first keeps going while fixes appear.
      if (!first) {
        const after = compile(target).diagnostics.filter((diagnostic) => diagnostic.severity === "error");
        console.log(after.length === 0 ? "kadam fix: everything is fixed." : `kadam fix: ${after.length} ${after.length === 1 ? "problem is" : "problems are"} left; run kadam fix again or kadam check.`);
        return after.length === 0 ? 0 : 1;
      }
    }
    return 1;
  } finally {
    ask?.close();
  }
}

function compile(target: string): { diagnostics: readonly Diagnostic[]; root: string } {
  if (existsSync(target) && statSync(target).isDirectory()) {
    return { diagnostics: compileProject({ projectRoot: target }).diagnostics, root: target };
  }
  const result = compileText(target, readFileSync(target, "utf8"));
  return { diagnostics: result.diagnostics, root: "" };
}

function absolute(path: string, root: string): string {
  return isAbsolute(path) || root === "" ? path : join(root, path);
}

function describe(diagnostic: Diagnostic, root: string): string {
  const file = absolute(diagnostic.span.file, root);
  try {
    const shown = new SourceFile(relative(process.cwd(), file), readFileSync(file, "utf8"));
    return formatDiagnostic(diagnostic, shown);
  } catch {
    return `${diagnostic.code}: ${diagnostic.message}`;
  }
}
