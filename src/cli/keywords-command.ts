import { KEYWORDS, NAMED_COLORS } from "../core/lexer/lexicon.js";
import { CORE_KEYWORDS } from "../v02/lexer.js";
import { PROPERTIES } from "../core/parser/properties.js";

type Group = "ui" | "colors" | "core" | "properties";

const GROUP_FLAGS: Readonly<Record<string, Group>> = {
  "--ui": "ui",
  "--colors": "colors",
  "--core": "core",
  "--properties": "properties",
};

/**
 * `kadam keywords`: print the frozen reserved vocabulary, generated from the
 * lexicon itself so it can never drift from what the compiler rejects.
 *
 *   kadam keywords             UI grammar words (reserved as element names)
 *   kadam keywords --colors    CSS named colors (also reserved as names)
 *   kadam keywords --core      kadam 0.2 module keywords
 *   kadam keywords --properties  names accepted by `the <property> is <value>`
 *   kadam keywords --all       every group, labelled
 *   ... --json                 machine-readable output
 */
export function runKeywordsCommand(args: readonly string[]): number {
  const groups: Group[] = [];
  let json = false;
  for (const arg of args) {
    if (arg === "--json") json = true;
    else if (arg === "--all") groups.push("ui", "colors", "core", "properties");
    else if (GROUP_FLAGS[arg] !== undefined) groups.push(GROUP_FLAGS[arg]!);
    else {
      console.error(
        `kadam keywords: unknown option ${JSON.stringify(arg)}\n` +
          "usage: kadam keywords [--ui | --colors | --core | --properties | --all] [--json]",
      );
      return 2;
    }
  }
  const selected = [...new Set(groups.length === 0 ? ["ui" as Group] : groups)];

  const words = (group: Group): string[] => {
    switch (group) {
      case "ui":
        return [...KEYWORDS].sort();
      case "colors":
        return [...NAMED_COLORS].sort();
      case "core":
        return [...CORE_KEYWORDS].sort();
      case "properties":
        return PROPERTIES.map((property) => property.name).sort();
    }
  };

  if (json) {
    const out: Record<string, string[]> = {};
    for (const group of selected) out[group] = words(group);
    console.log(JSON.stringify(out, null, 2));
    return 0;
  }
  if (selected.length === 1) {
    console.log(words(selected[0]!).join("\n"));
    return 0;
  }
  const titles: Record<Group, string> = {
    ui: "UI grammar words",
    colors: "Named colors",
    core: "kadam 0.2 core keywords",
    properties: "Property names (kadam 0.3)",
  };
  console.log(
    selected
      .map((group) => `# ${titles[group]} (${words(group).length})\n${words(group).join("\n")}`)
      .join("\n\n"),
  );
  return 0;
}
