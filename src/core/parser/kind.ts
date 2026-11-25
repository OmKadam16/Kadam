import type {
  BuiltinKindName,
  KindCategory,
  KindNode,
  KindReference,
  LengthValue,
  VariantSelection,
} from "../ast/nodes.js";
import type { DiagnosticSpec } from "../diagnostics/diagnostic.js";
import type { Token } from "../lexer/token.js";
import { closestMatches } from "./suggest.js";
import {
  describeTokens,
  isAnyWord,
  isKeyword,
  lengthDiagnostic,
  readLength,
  spanFromTokens,
} from "./values.js";

export interface BuiltinKindInfo {
  readonly name: BuiltinKindName;
  readonly category: KindCategory;
}

export const BUILTIN_KIND_INFO: Readonly<Record<BuiltinKindName, BuiltinKindInfo>> = {
  button: { name: "button", category: "leaf" },
  link: { name: "link", category: "leaf" },
  "main heading": { name: "main heading", category: "leaf" },
  "section heading": { name: "section heading", category: "leaf" },
  "minor heading": { name: "minor heading", category: "leaf" },
  paragraph: { name: "paragraph", category: "leaf" },
  "text field": { name: "text field", category: "leaf" },
  image: { name: "image", category: "leaf" },
  card: { name: "card", category: "container" },
  container: { name: "container", category: "container" },
  "navigation bar": { name: "navigation bar", category: "container" },
  divider: { name: "divider", category: "leaf" },
};

export const BUILTIN_KIND_NAMES: readonly BuiltinKindName[] = Object.keys(
  BUILTIN_KIND_INFO,
) as BuiltinKindName[];

const KIND_PHRASES: readonly (readonly string[])[] = [
  ["navigation", "bar"],
  ["text", "field"],
  ["main", "heading"],
  ["section", "heading"],
  ["minor", "heading"],
  ["button"],
  ["link"],
  ["paragraph"],
  ["image"],
  ["card"],
  ["container"],
  ["divider"],
];

export interface KindParseResult {
  readonly kind: KindNode | null;
  readonly diagnostics: readonly DiagnosticSpec[];
}

export function matchKindStatement(tokens: readonly Token[]): KindParseResult | null {
  const first = tokens[0];
  if (!isKeyword(first, "a") && !isKeyword(first, "an")) return null;

  const article = first!.text.toLowerCase() as "a" | "an";
  const diagnostics: DiagnosticSpec[] = [];
  const thatIndex = tokens.findIndex((token) => isKeyword(token, "that"));
  const prefix = tokens.slice(1, thatIndex === -1 ? tokens.length : thatIndex);
  const inIndex = prefix.findIndex((token) => isAnyWord(token, "in"));
  const kindTokens = inIndex === -1 ? prefix : prefix.slice(0, inIndex);
  let variant: VariantSelection | undefined;
  const span = spanFromTokens(tokens);

  if (inIndex !== -1) {
    const variantTokens = prefix.slice(inIndex);
    const parsedVariant = parseVariantSelection(variantTokens);
    if (parsedVariant === null) {
      diagnostics.push({
        code: "KDM2002",
        message: "malformed component variant selection",
        span: spanFromTokens(variantTokens),
        hint: "use: a <ComponentName> in the <variantName> variant",
      });
    } else {
      variant = parsedVariant;
    }
  }

  let reference: KindReference;
  if (kindTokens.length === 0) {
    diagnostics.push({
      code: "KDM2002",
      message: "expected an element kind after the article",
      span,
      hint: `use one of: ${BUILTIN_KIND_NAMES.join(", ")}`,
    });
    reference = { type: "unknown-kind", name: "", span };
  } else {
    const kindText = kindTokens.map((token) => token.text.toLowerCase()).join(" ");
    // Built-in kinds are lowercase; a single PascalCase word is a component
    // even when its lower-case spelling is also a keyword (Button, Card).
    const qualified = parseQualifiedComponent(kindTokens);
    if (isComponentName(kindTokens)) {
      const name = kindTokens[0]!.text;
      reference = {
        type: "component-kind",
        name,
        namespace: null,
        namespaceSpan: null,
        span: spanFromTokens(kindTokens),
      };
    } else if (qualified !== null) {
      if (qualified.namespace === null) {
        diagnostics.push({
          code: "KDM2002",
          message: "malformed component namespace",
          span: spanFromTokens(kindTokens),
          hint: "use: a <ComponentName> from <lowerCamelNamespace>",
        });
        reference = {
          type: "unknown-kind",
          name: kindText,
          span: spanFromTokens(kindTokens),
        };
      } else {
        reference = {
          type: "component-kind",
          name: qualified.name,
          namespace: qualified.namespace,
          namespaceSpan: qualified.namespaceSpan,
          span: spanFromTokens(kindTokens),
        };
      }
    } else if (isSlotKind(kindTokens)) {
      const name = slotKindName(kindTokens);
      reference = {
        type: "slot-kind",
        name,
        nameSpan: name === null ? null : kindTokens[0]!.span,
        span: spanFromTokens(kindTokens),
      };
    } else {
      const builtin = findBuiltinKind(kindTokens);
      if (builtin !== null) {
        reference = {
          type: "builtin-kind",
          name: builtin,
          category: BUILTIN_KIND_INFO[builtin].category,
          span: spanFromTokens(kindTokens),
        };
      } else {
        const replacements = closestMatches(kindText, BUILTIN_KIND_NAMES, 3);
        diagnostics.push({
          code: "KDM3001",
          message: `unknown element kind ${JSON.stringify(kindText)}`,
          span: spanFromTokens(kindTokens),
          ...(replacements.length > 0
            ? { hint: `did you mean: ${replacements.join(", ")}?` }
            : {}),
        });
        reference = { type: "unknown-kind", name: kindText, span: spanFromTokens(kindTokens) };
      }
    }
  }

  if (variant !== undefined && reference.type !== "component-kind") {
    diagnostics.push({
      code: "KDM2002",
      message: "variant selection requires a component kind",
      span: variant.span,
      hint: "use a Button in the outline variant, where Button is a component",
    });
  }

  let width: LengthValue | undefined;
  let height: LengthValue | undefined;
  if (thatIndex !== -1) {
    const clause = tokens.slice(thatIndex);
    // that is <length> by <length>
    if (
      clause.length !== 5 ||
      !isKeyword(clause[0], "that") ||
      !isKeyword(clause[1], "is") ||
      !isKeyword(clause[3], "by")
    ) {
      diagnostics.push({
        code: "KDM2002",
        message: "malformed size clause in kind sentence",
        span: spanFromTokens(clause),
        hint: "use: a <kind> that is <length> by <length>",
      });
    } else {
      const widthToken = clause[2]!;
      const heightToken = clause[4]!;
      const parsedWidth = readLength(widthToken);
      const parsedHeight = readLength(heightToken);
      if (parsedWidth === null) diagnostics.push(lengthDiagnostic(widthToken));
      else width = parsedWidth;
      if (parsedHeight === null) diagnostics.push(lengthDiagnostic(heightToken));
      else height = parsedHeight;
    }
  }

  const kind: KindNode = {
    type: "kind",
    article,
    reference,
    ...(variant === undefined ? {} : { variant }),
    ...(width === undefined ? {} : { width }),
    ...(height === undefined ? {} : { height }),
    span,
  };
  return { kind, diagnostics };
}

function findBuiltinKind(tokens: readonly Token[]): BuiltinKindName | null {
  for (const phrase of KIND_PHRASES) {
    if (tokens.length !== phrase.length) continue;
    let matched = true;
    for (let index = 0; index < phrase.length; index += 1) {
      if (tokens[index]!.text.toLowerCase() !== phrase[index]) {
        matched = false;
        break;
      }
    }
    if (matched) return phrase.join(" ") as BuiltinKindName;
  }
  return null;
}

// `a slot` is the unnamed slot; `a header slot` names one. The name is a
// lower-camel identifier, matching element and parameter names.
interface QualifiedComponent {
  readonly name: string;
  readonly namespace: string | null;
  readonly namespaceSpan: Token["span"] | null;
}

// `a Button from ui` qualifies a PascalCase component name with a lower-camel
// library namespace. A malformed qualifier is reported rather than treated as
// an unknown built-in kind.
function parseQualifiedComponent(
  tokens: readonly Token[],
): QualifiedComponent | null {
  if (tokens.length < 2) return null;
  if (tokens[1]!.text.toLowerCase() !== "from") return null;
  if (!isComponentName([tokens[0]!])) return null;

  const name = tokens[0]!.text;
  if (tokens.length !== 3) {
    return { name, namespace: null, namespaceSpan: null };
  }

  const namespaceToken = tokens[2]!;
  if (!/^[a-z][A-Za-z0-9]{0,63}$/.test(namespaceToken.text)) {
    return { name, namespace: null, namespaceSpan: null };
  }

  return {
    name,
    namespace: namespaceToken.text,
    namespaceSpan: namespaceToken.span,
  };
}

function isSlotKind(tokens: readonly Token[]): boolean {
  if (tokens.length === 1) return tokens[0]!.text.toLowerCase() === "slot";
  if (tokens.length !== 2) return false;
  return (
    tokens[1]!.text.toLowerCase() === "slot" &&
    /^[a-z][A-Za-z0-9]{0,63}$/.test(tokens[0]!.text)
  );
}

function slotKindName(tokens: readonly Token[]): string | null {
  return tokens.length === 2 ? tokens[0]!.text : null;
}

function isComponentName(tokens: readonly Token[]): boolean {
  const token = tokens[0];
  return (
    tokens.length === 1 &&
    (token?.kind === "word" || token?.kind === "keyword") &&
    /^[A-Z][A-Za-z0-9]{0,63}$/.test(token.text)
  );
}

function parseVariantSelection(tokens: readonly Token[]): VariantSelection | null {
  if (
    tokens.length !== 4 ||
    !isAnyWord(tokens[0], "in") ||
    !isKeyword(tokens[1], "the") ||
    (tokens[2]!.kind !== "identifier" && tokens[2]!.kind !== "keyword") ||
    !/^[a-z][A-Za-z0-9]{0,63}$/.test(tokens[2]!.text) ||
    !isAnyWord(tokens[3], "variant")
  ) {
    return null;
  }
  return {
    name: tokens[2]!.text,
    nameSpan: tokens[2]!.span,
    span: spanFromTokens(tokens),
  };
}

export function kindText(kind: KindNode | null): string {
  if (kind === null) return "unknown kind";
  if (kind.reference.type === "unknown-kind") {
    return kind.reference.name.length === 0
      ? "unknown kind"
      : kind.reference.name;
  }
  if (kind.reference.type === "slot-kind") {
    return kind.reference.name === null
      ? "slot"
      : `${kind.reference.name} slot`;
  }
  if (kind.reference.type === "component-kind" && kind.reference.namespace !== null) {
    return `${kind.reference.name} from ${kind.reference.namespace}`;
  }
  return kind.reference.name;
}

export function describeKindTokens(tokens: readonly Token[]): string {
  return describeTokens(tokens);
}
