import type { ColorValue } from "../ast/nodes.js";
import type { Diagnostic } from "../diagnostics/diagnostic.js";
import { DiagnosticBag } from "../diagnostics/diagnostic.js";
import { lex } from "../lexer/index.js";
import type { SourceFile, Span } from "../source/source-file.js";
import { splitLogicalLines } from "./parser.js";
import { matchLine } from "./registry.js";
import { isAnyWord, isKeyword } from "./values.js";

/**
 * A project theme file (D-38), named by `"theme"` in kadam.json:
 *
 *     kadam 0.3
 *     theme {
 *         the brand color is #FF0066
 *         in dark mode, the brand color is #FF4D8D
 *     }
 *
 * It holds only theme colors. No file-system access happens here.
 */

export interface ThemeColor {
  readonly name: string;
  readonly light: ColorValue;
  readonly dark: ColorValue | null;
  readonly span: Span;
}

export interface ThemeParseResult {
  readonly colors: readonly ThemeColor[];
  readonly diagnostics: readonly Diagnostic[];
}

export function parseThemeSource(source: SourceFile): ThemeParseResult {
  const lexed = lex(source);
  const diagnostics = new DiagnosticBag();
  diagnostics.addAll(lexed.diagnostics);
  const lines = splitLogicalLines(lexed.tokens, source);
  const light = new Map<string, { color: ColorValue; span: Span }>();
  const dark = new Map<string, { color: ColorValue; span: Span }>();
  let state: "start" | "body" | "done" = "start";
  let sawDirective = false;

  for (const line of lines) {
    const tokens = line.tokens;
    const first = tokens[0]!;
    if (state === "start" && !sawDirective && isKeyword(first, "kadam")) {
      sawDirective = true;
      if (tokens.length !== 2 || tokens[1]!.text !== "0.3") {
        diagnostics.error("KDM4004", "a theme file is kadam 0.3", line.span, "write kadam 0.3 on the first line, or leave it out");
      }
      continue;
    }
    if (state === "start") {
      if (tokens.length === 2 && isAnyWord(first, "theme") && tokens[1]!.kind === "lbrace") {
        state = "body";
      } else {
        diagnostics.error("KDM2006", "a theme file contains one theme { ... } block", line.span, "start the file with: theme {");
        state = "done";
      }
      continue;
    }
    if (state === "done") {
      diagnostics.error("KDM2006", "content after the theme block", line.span, "a theme file contains one theme { ... } block");
      continue;
    }
    if (tokens.length === 1 && first.kind === "rbrace") {
      state = "done";
      continue;
    }
    const match = matchLine(tokens, { allowResponsive: true, languageVersion: "0.3" });
    for (const diagnostic of match.diagnostics) diagnostics.addSpec(diagnostic);
    const node = match.selected?.body.statement ?? null;
    if (node === null) continue;
    if (node.type !== "page-setting" || node.property !== "color token") {
      diagnostics.error(
        "KDM3003",
        "a theme contains only theme colors",
        line.span,
        "write: the brand color is #FF0066, or in dark mode, the brand color is #FF4D8D",
      );
      continue;
    }
    const target = node.dark === true ? dark : light;
    const previous = target.get(node.name);
    if (previous !== undefined) {
      diagnostics.error("KDM3004", `duplicate ${node.name} color${node.dark === true ? " in dark mode" : ""}`, node.span,
        "declare each theme color once", [{ span: previous.span, message: "first declared here" }]);
      continue;
    }
    target.set(node.name, { color: node.value, span: node.span });
  }
  if (state === "body") {
    diagnostics.error("KDM2005", "the theme block is missing its closing brace", lines.at(-1)?.span ?? source.span(0, 0),
      "add } on its own line at the end");
  }
  for (const [name, entry] of dark) {
    if (!light.has(name)) {
      diagnostics.error("KDM3005", `${name} has a dark mode color but no color`, entry.span,
        `add: the ${name} color is <color>`);
    }
  }

  const colors = [...light].map(([name, entry]) => ({
    name,
    light: entry.color,
    dark: dark.get(name)?.color ?? null,
    span: entry.span,
  }));
  return { colors, diagnostics: diagnostics.sorted() };
}
