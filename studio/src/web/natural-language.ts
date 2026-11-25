import type {
  BackgroundValue,
  BorderValue,
  CornersValue,
  LayerKind,
  StyleSelector,
  StyleSide,
} from "../shared/protocol.js";

export type NaturalLanguageAction =
  | {
      readonly kind: "property";
      readonly property: "text" | "background" | "border" | "corners";
      readonly value: string | BackgroundValue | BorderValue | CornersValue;
      readonly summary: string;
    }
  | {
      readonly kind: "add";
      readonly layerKind: LayerKind;
      readonly text?: string;
      readonly summary: string;
    }
  | {
      readonly kind: "move";
      readonly direction: "up" | "down";
      readonly summary: string;
    }
  | {
      readonly kind: "delete";
      readonly summary: string;
    }
  | {
      readonly kind: "select";
      readonly name: string;
      readonly summary: string;
    }
  | {
      readonly kind: "style";
      readonly selector: StyleSelector;
      readonly statement: string | null;
      readonly summary: string;
    };

export type NaturalLanguageParseResult =
  | { readonly ok: true; readonly action: NaturalLanguageAction }
  | { readonly ok: false; readonly message: string };

export const NATURAL_LANGUAGE_EXAMPLES = [
  "make the text #2563EB",
  "add 16px padding on the left and right",
  "when hovered, lift it by 4px",
  "add a soft shadow",
] as const;

const ADDABLE_KINDS: Readonly<Record<string, LayerKind>> = {
  container: "container",
  box: "container",
  rectangle: "container",
  frame: "container",
  card: "card",
  heading: "heading",
  title: "heading",
  paragraph: "paragraph",
  text: "paragraph",
  button: "button",
};

// Every CSS named color, plus transparent. Kadam validates the same names.
const COMMON_COLORS = new Set(
  `
  aliceblue antiquewhite aqua aquamarine azure beige bisque black
  blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse
  chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan
  darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta
  darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen
  darkslateblue darkslategray darkslategrey darkturquoise darkviolet
  deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite
  forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green
  greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender
  lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan
  lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon
  lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue
  lightyellow lime limegreen linen magenta maroon mediumaquamarine
  mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue
  mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream
  mistyrose moccasin navajowhite navy oldlace olive olivedrab orange
  orangered orchid palegoldenrod palegreen paleturquoise palevioletred
  papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red
  rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell
  sienna silver skyblue slateblue slategray slategrey snow springgreen
  steelblue tan teal thistle tomato transparent turquoise violet wheat
  white whitesmoke yellow yellowgreen
  `
    .trim()
    .split(/\s+/),
);

export function parseNaturalLanguage(
  input: string,
): NaturalLanguageParseResult {
  const original = input.trim().replace(/\s+/g, " ");
  const text = original.replace(/[.!?]+$/g, "").trim();
  if (text.length === 0) {
    return fail("Type a change first, for example “make the background black”.");
  }

  const selection = text.match(
    /^(?:select|choose|pick)\s+(?:the\s+)?(.+?)(?:\s+layer)?$/i,
  );
  if (selection !== null) {
    const name = unwrap(selection[1] ?? "");
    if (name.length > 0) {
      return success({
        kind: "select",
        name,
        summary: `Select ${name}.`,
      });
    }
  }

  const move = text.match(
    /^(?:move|bring|send)\s+(?:this|it|the\s+selected(?:\s+layer)?|selected(?:\s+layer)?|layer)?\s*(up|down)$/i,
  );
  if (move !== null) {
    const direction = move[1]!.toLowerCase() as "up" | "down";
    return success({
      kind: "move",
      direction,
      summary: `Move the selected layer ${direction}.`,
    });
  }

  if (/^(?:delete|remove)\s+(?:this|it|the\s+selected(?:\s+layer)?|selected(?:\s+layer)?|layer|element)$/i.test(text)) {
    return success({
      kind: "delete",
      summary: "Delete the selected layer.",
    });
  }

  const add = text.match(
    /^(?:add|create|insert|make)\s+(?:a\s+|an\s+|a\s+new\s+|new\s+)?([a-z]+)(?:\s+(.*))?$/i,
  );
  if (add !== null) {
    const layerKind = ADDABLE_KINDS[add[1]!.toLowerCase()];
    if (layerKind !== undefined) {
      const rest = add[2] ?? "";
      const textMatch = rest.match(
        /(?:saying|that\s+says|with(?:\s+the)?\s+text|reading|containing)\s+(.+)$/i,
      );
      const label = textMatch === null ? undefined : unwrap(textMatch[1] ?? "");
      return success({
        kind: "add",
        layerKind,
        ...(label === undefined || label.length === 0 ? {} : { text: label }),
        summary:
          label === undefined
            ? `Add a ${layerKind}.`
            : `Add a ${layerKind} saying “${label}”.`,
      });
    }
  }

  if (
    /\bborder\b/i.test(text) &&
    /\b(?:dashed|dotted|double|groove|ridge|inset|outset)\b/i.test(text)
  ) {
    return fail(
      "Kadam borders are solid. Try “add a 2px blue border” instead.",
    );
  }

  const styleCommand = parseStyleCommand(text);
  if (styleCommand !== null) return success(styleCommand);

  if (/^(?:make|set|give)\s+(?:it|this)\s+(?:fully\s+)?rounded$/i.test(text)) {
    return success({
      kind: "property",
      property: "corners",
      value: { mode: "full" },
      summary: "Fully round the selected layer's corners.",
    });
  }

  if (/^(?:remove|delete|clear)\s+(?:the\s+)?background$/i.test(text)) {
    return success({
      kind: "property",
      property: "background",
      value: { mode: "none" },
      summary: "Remove the selected layer's background.",
    });
  }

  const background = text.match(
    /\b(?:background|bg|fill)\b(?:\s+(?:to|as|with|of|be))?\s+(.+)$/i,
  );
  if (background !== null) {
    const value = parseBackgroundValue(background[1] ?? "");
    if (value === null) {
      return fail(
        "I couldn’t read that background. Try “make the background black” or “set the background to #111827”.",
      );
    }
    return success({
      kind: "property",
      property: "background",
      value,
      summary: "Update the selected layer's background.",
    });
  }

  const shorthandColor = text.match(
    /^(?:make|turn)\s+(?:it|this)\s+(?:a\s+|an\s+|the\s+)?(.+)$/i,
  );
  if (shorthandColor !== null) {
    const value = parseBackgroundValue(shorthandColor[1] ?? "");
    if (value !== null) {
      return success({
        kind: "property",
        property: "background",
        value,
        summary: "Update the selected layer's background.",
      });
    }
  }

  if (/^(?:remove|delete|clear)\s+(?:the\s+)?border$/i.test(text) || /^no border$/i.test(text)) {
    return success({
      kind: "property",
      property: "border",
      value: { mode: "none" },
      summary: "Remove the selected layer's border.",
    });
  }

  if (/\bborder\b/i.test(text)) {
    const widthMatch = text.match(/\b(\d+(?:\.\d+)?)\s*(px|rem)\b/i);
    const width =
      widthMatch !== null
        ? `${widthMatch[1]}${widthMatch[2]}`
        : /\bthick\b/i.test(text)
          ? "3px"
          : "1px";
    const color = extractColor(text) ?? "#D4D4D4";
    const value: BorderValue = { mode: "solid", color, width };
    return success({
      kind: "property",
      property: "border",
      value,
      summary: `Set a ${width} ${color} border.`,
    });
  }

  if (
    /^(?:remove|delete|clear|reset)\s+(?:the\s+)?(?:rounded\s+)?corners?$/i.test(
      text,
    ) ||
    /^(?:make|set)\s+(?:the\s+)?corners?\s+(?:square|sharp)$/i.test(text)
  ) {
    return success({
      kind: "property",
      property: "corners",
      value: { mode: "default" },
      summary: "Reset the selected layer's corners.",
    });
  }

  const radius = text.match(
    /\b(?:corner\s+radius|border\s+radius|radius|corners?)\b(?:\s+(?:of|to|by))?\s+(\d+(?:\.\d+)?)\s*(px|rem)?$/i,
  );
  if (radius !== null) {
    const value: CornersValue = {
      mode: "custom",
      radius: `${radius[1]}${radius[2] ?? "px"}`,
    };
    return success({
      kind: "property",
      property: "corners",
      value,
      summary: `Set a ${value.radius} corner radius.`,
    });
  }

  if (
    /\b(?:round|rounded)\b.*\bcorners?\b/i.test(text) ||
    /\bcorners?\b.*\b(?:fully\s+rounded|rounded|round|pill)\b/i.test(text)
  ) {
    return success({
      kind: "property",
      property: "corners",
      value: { mode: "full" },
      summary: "Fully round the selected layer's corners.",
    });
  }

  const textCommand =
    text.match(
      /^(?:change|set|update)\s+(?:the\s+)?(?:text|copy|label|content)\s+(?:to|say|says|be)\s+(.+)$/i,
    ) ??
    text.match(/^(?:say|write)\s+(.+)$/i) ??
    text.match(/^(?:change|set|update)\s+(?:it|this)\s+to\s+(.+)$/i);
  if (textCommand !== null) {
    const value = unwrap(textCommand[1] ?? "");
    if (value.length > 0) {
      return success({
        kind: "property",
        property: "text",
        value,
        summary: "Update the selected layer's text.",
      });
    }
  }

  return fail(
    "I can edit text, color, typography, font, background, borders, corners, shadows, size, spacing, layout, hover effects, motion, and visibility, or add, move, delete, and select layers. Try “make the text #2563EB”, “add 16px padding”, or “when hovered, lift it by 4px”.",
  );
}

type StyleAction = Extract<NaturalLanguageAction, { kind: "style" }>;

function styleAction(
  selector: StyleSelector,
  statement: string | null,
  summary: string,
): StyleAction {
  return { kind: "style", selector, statement, summary };
}

function parseStyleCommand(text: string): StyleAction | null {
  if (
    /^(?:remove|delete|clear|stop|disable|turn off)\s+(?:all\s+)?(?:the\s+)?(?:animations?|motion|entrance(?:\s+animations?)?)$/i.test(
      text,
    ) ||
    /^no (?:animations?|motion)$/i.test(text)
  ) {
    return styleAction({ family: "motion" }, null, "Remove the entrance animation.");
  }

  if (
    /^(?:remove|delete|clear|stop|disable|turn off)\s+(?:all\s+)?(?:the\s+)?(?:hover|hover effects?|hover states?)$/i.test(
      text,
    )
  ) {
    return styleAction({ family: "hover" }, null, "Remove all hover effects.");
  }

  if (
    /^(?:remove|delete|clear)\s+(?:the\s+)?(?:drop\s+)?shadow$/i.test(text) ||
    /^no (?:drop\s+)?shadow$/i.test(text)
  ) {
    return styleAction({ family: "shadow" }, "has no shadow", "Remove the shadow.");
  }

  if (
    /^(?:add|use|give)\s+(?:it\s+|this\s+)?(?:a\s+)?(?:drop\s+)?shadow(?:\s+to\s+(?:it|this))?$/i.test(
      text,
    ) ||
    /^(?:make|set)\s+(?:it|this)\s+(?:have\s+)?(?:a\s+)?(?:drop\s+)?shadow$/i.test(
      text,
    )
  ) {
    return styleAction(
      { family: "shadow" },
      "has a soft shadow",
      "Add a soft shadow.",
    );
  }

  const shadow =
    text.match(
      /^(?:add|use|give|set|make)\s+(?:it\s+|this\s+|the\s+selected\s+layer\s+)?(?:a\s+)?(soft|subtle|light|medium|moderate|strong|heavy|large)\s+shadow$/i,
    ) ??
    text.match(
      /^(?:set|change|make)\s+(?:the\s+)?shadow\s+(?:to\s+)?(soft|subtle|light|medium|moderate|strong|heavy|large|none)$/i,
    ) ??
    text.match(
      /^(?:make|set)\s+(?:the\s+)?shadow\s+(softer|stronger|heavier|lighter)$/i,
    );
  if (shadow !== null) {
    const raw = shadow[1]!.toLowerCase();
    const preset =
      raw === "none"
        ? "none"
        : raw === "soft" ||
            raw === "subtle" ||
            raw === "light" ||
            raw === "softer" ||
            raw === "lighter"
          ? "soft"
          : raw === "medium" || raw === "moderate"
            ? "medium"
            : "strong";
    return styleAction(
      { family: "shadow" },
      preset === "none" ? "has no shadow" : `has a ${preset} shadow`,
      preset === "none" ? "Remove the shadow." : `Set a ${preset} shadow.`,
    );
  }

  const font =
    text.match(
      /^(?:set|change|make|use)\s+(?:the\s+)?(?:font|font family)(?:\s+(?:to|as))?\s+(sans(?:[\s-]*serif)?|serif|mono(?:space)?)$/i,
    ) ??
    text.match(
      /^(?:use|choose)\s+(?:a\s+)?(sans(?:[\s-]*serif)?|serif|mono(?:space)?)(?:\s+font)?$/i,
    );
  if (font !== null) {
    const family = font[1]!.toLowerCase().replace(/[\s-]+/g, " ");
    const normalized =
      family === "sans" || family === "sans serif"
        ? "sans serif"
        : family === "mono" || family === "monospace"
          ? "monospace"
          : "serif";
    return styleAction(
      { family: "font-family" },
      `the font is ${normalized}`,
      `Set the font to ${normalized}.`,
    );
  }

  if (
    /^(?:hide|conceal)\s+(?:it|this|the\s+(?:layer|element))$/i.test(text) ||
    /^(?:make|set)\s+(?:it|this|the\s+(?:layer|element))\s+hidden$/i.test(text)
  ) {
    return styleAction(
      { family: "visibility" },
      "it is hidden",
      "Hide the selected layer.",
    );
  }
  if (
    /^(?:show|reveal|unhide)\s+(?:it|this|the\s+(?:layer|element))$/i.test(text) ||
    /^(?:make|set)\s+(?:it|this|the\s+(?:layer|element))\s+visible$/i.test(text)
  ) {
    return styleAction(
      { family: "visibility" },
      null,
      "Show the selected layer.",
    );
  }

  const textColor =
    text.match(
      /^(?:change|set|make|turn|update|color|colour|paint)\s+(?:the\s+)?(?:text|font|copy)(?:\s+(?:color|colour))?\s*(?::|to|into)?\s*(.+)$/i,
    ) ??
    text.match(
      /^(?:change|set|make|turn|update|color|colour|paint)\s+(?:the\s+)?(?:heading|title|paragraph|button|link|label)\s+text(?:\s+(?:color|colour))?\s*(?::|to|into)?\s*(.+)$/i,
    ) ??
    text.match(
      /^(?:the\s+)?(?:text|font)\s+(?:color|colour)\s*:?\s*(?:to\s+)?(.+)$/i,
    );
  if (textColor !== null) {
    const color = normalizeColor(textColor[1] ?? "");
    if (color !== null) {
      return styleAction(
        { family: "typography", key: "color" },
        `the text is ${color}`,
        `Set the text color to ${color}.`,
      );
    }
  }

  const textSize =
    text.match(
      /^(?:set|change|make|update)\s+(?:the\s+)?(?:text|font)\s+(?:size\s+)?(?:to\s+)?(\d+(?:\.\d+)?(?:\s*(?:px|rem))?)$/i,
    ) ??
    text.match(
      /^(?:set|change)\s+(?:the\s+)?(?:font|text)\s+size\s+(?:to\s+)?(\d+(?:\.\d+)?(?:\s*(?:px|rem))?)$/i,
    );
  if (textSize !== null) {
    const size = normalizeLength(textSize[1] ?? "");
    if (size !== null) {
      return styleAction(
        { family: "typography", key: "size" },
        `the text is ${size}`,
        `Set the text size to ${size}.`,
      );
    }
  }

  const weight =
    text.match(
      /^(?:make|set|change)\s+(?:the\s+)?(?:text|font)(?:\s+weight)?\s+(?:to\s+)?([a-z-]+)$/i,
    ) ??
    text.match(
      /^(?:make|set|turn)\s+(?:it|this|the\s+(?:text|heading|title|paragraph|button|link))\s+([a-z-]+)$/i,
    ) ??
    text.match(
      /^(thin|light|normal|regular|medium|semibold|semi-bold|bold|bolder|lighter)\s+(?:the\s+)?(?:text|it|this)$/i,
    ) ??
    text.match(/^(bold|italicize)\s+(?:it|this|the\s+text)$/i);
  if (weight !== null) {
    const normalized = normalizeWeight(weight[1] ?? "");
    if (normalized !== null) {
      return styleAction(
        { family: "typography", key: "weight" },
        `the text is ${normalized}`,
        `Set the text weight to ${normalized}.`,
      );
    }
  }

  if (
    /^(?:make|set|put)\s+(?:the\s+)?(?:text|font)\s+italic$/i.test(text) ||
    /^(?:make|set|turn)\s+(?:it|this|the\s+(?:text|heading|title|paragraph|button|link))\s+italic$/i.test(
      text,
    ) ||
    /^italicize\s+(?:it|this|the\s+text)$/i.test(text) ||
    /^(?:set|change)\s+(?:the\s+)?font\s+style\s+(?:to\s+)?italic$/i.test(
      text,
    )
  ) {
    return styleAction(
      { family: "typography", key: "style" },
      "the text is italic",
      "Make the text italic.",
    );
  }

  const alignment = parseTextAlignment(text);
  if (alignment !== null) {
    const statement =
      alignment === "center"
        ? "the text is centered"
        : `the text is ${alignment} aligned`;
    return styleAction(
      { family: "typography", key: "align" },
      statement,
      `Set the text alignment to ${alignment}.`,
    );
  }

  const fullSize = text.match(
    /^(?:make|set|resize)\s+(?:it|this|the\s+layer)\s+(full width|full height|fill\s+(?:the\s+)?width|fill\s+(?:the\s+)?height|100%\s*wide|100%\s*tall)$/i,
  );
  if (fullSize !== null) {
    const raw = fullSize[1]!.toLowerCase();
    const mode = raw.includes("height") || raw.includes("tall")
      ? "full height"
      : "full width";
    return styleAction(
      { family: "size" },
      `it is ${mode}`,
      `Set the layer to ${mode}.`,
    );
  }

  const bothSize = text.match(
    /^(?:make|set|resize)\s+(?:it|this|the\s+layer)\s+(\d+(?:\.\d+)?(?:\s*(?:px|rem))?)\s+by\s+(\d+(?:\.\d+)?(?:\s*(?:px|rem))?)$/i,
  );
  if (bothSize !== null) {
    const width = normalizeLength(bothSize[1] ?? "");
    const height = normalizeLength(bothSize[2] ?? "");
    if (width !== null && height !== null) {
      return styleAction(
        { family: "size" },
        `it is ${width} by ${height}`,
        `Set the layer to ${width} by ${height}.`,
      );
    }
  }

  const width = text.match(
    /^(?:make|set|resize)\s+(?:it|this|the\s+layer)\s+(\d+(?:\.\d+)?(?:\s*(?:px|rem))?)\s+wide$/i,
  ) ??
    text.match(
      /^(?:set|change)\s+(?:the\s+)?width\s+(?:to\s+)?(\d+(?:\.\d+)?(?:\s*(?:px|rem))?)$/i,
    );
  if (width !== null) {
    const value = normalizeLength(width[1] ?? "");
    if (value !== null) {
      return styleAction(
        { family: "size" },
        `it is ${value} wide`,
        `Set the width to ${value}.`,
      );
    }
  }

  const height = text.match(
    /^(?:make|set|resize)\s+(?:it|this|the\s+layer)\s+(\d+(?:\.\d+)?(?:\s*(?:px|rem))?)\s+(?:tall|high)$/i,
  ) ??
    text.match(
      /^(?:set|change)\s+(?:the\s+)?height\s+(?:to\s+)?(\d+(?:\.\d+)?(?:\s*(?:px|rem))?)$/i,
    );
  if (height !== null) {
    const value = normalizeLength(height[1] ?? "");
    if (value !== null) {
      return styleAction(
        { family: "size" },
        `it is ${value} tall`,
        `Set the height to ${value}.`,
      );
    }
  }

  if (
    /^(?:remove|delete|clear)\s+(?:the\s+)?(?:width|height|size)$/i.test(text) ||
    /^make\s+(?:it|this)\s+auto(?:-sized)?$/i.test(text)
  ) {
    return styleAction({ family: "size" }, null, "Reset the layer size.");
  }

  if (
    /^(?:remove|delete|clear)\s+(?:all\s+)?(?:the\s+)?(padding|margin)(?:\s+on\s+all\s+sides)?$/i.test(
      text,
    ) ||
    /^no (padding|margin)$/i.test(text)
  ) {
    const property = (text.match(/\b(padding|margin)\b/i)?.[1] ?? "padding") as
      | "padding"
      | "margin";
    return styleAction(
      { family: "spacing", key: property, sides: ["top", "right", "bottom", "left"] },
      null,
      `Remove all ${property}.`,
    );
  }

  const bareSpacing = text.match(
    /^(?:add|give|set)\s+(?:it\s+|this\s+)?(?:some\s+)?(padding|margin)(?:\s+(?:around|inside)(?:\s+it)?)?$/i,
  );
  if (bareSpacing !== null) {
    const property = bareSpacing[1]!.toLowerCase() as "padding" | "margin";
    return styleAction(
      { family: "spacing", key: property, sides: ["top", "right", "bottom", "left"] },
      `it has 16px ${property}`,
      `Set ${property} to 16px on all sides.`,
    );
  }

  const defaultSpacingSides = text.match(
    /^(?:add|give|set)\s+(?:it\s+|this\s+)?(?:some\s+)?(padding|margin)\s+on\s+(.+)$/i,
  );
  if (defaultSpacingSides !== null) {
    const property = defaultSpacingSides[1]!.toLowerCase() as
      | "padding"
      | "margin";
    const sides = parseSidesPhrase(defaultSpacingSides[2]);
    if (sides !== null) {
      return styleAction(
        { family: "spacing", key: property, sides },
        `it has 16px ${property}${formatSides(sides)}`,
        `Set ${property}${formatSides(sides)} to 16px.`,
      );
    }
  }

  const pad = text.match(
    /^pad\s+(?:it|this|the\s+layer)(?:\s+(?:by|with))?\s+(\d+(?:\.\d+)?(?:\s*(?:px|rem))?)$/i,
  );
  if (pad !== null) {
    const length = normalizeLength(pad[1] ?? "");
    if (length !== null) {
      return styleAction(
        { family: "spacing", key: "padding", sides: ["top", "right", "bottom", "left"] },
        `it has ${length} padding`,
        `Set padding to ${length} on all sides.`,
      );
    }
  }

  const spacingOf = text.match(
    /^(?:add|give|set)\s+(?:it\s+|this\s+)?(?:some\s+)?(padding|margin)\s+of\s+(\d+(?:\.\d+)?(?:\s*(?:px|rem))?)$/i,
  );
  if (spacingOf !== null) {
    const property = spacingOf[1]!.toLowerCase() as "padding" | "margin";
    const length = normalizeLength(spacingOf[2] ?? "");
    if (length !== null) {
      return styleAction(
        { family: "spacing", key: property, sides: ["top", "right", "bottom", "left"] },
        `it has ${length} ${property}`,
        `Set ${property} to ${length} on all sides.`,
      );
    }
  }

  const spacingValueFirst = text.match(
    /^(?:add|set|give|make)\s+(?:it\s+|this\s+|the\s+selected\s+layer\s+)?(?:have\s+)?(\d+(?:\.\d+)?(?:\s*(?:px|rem))?)\s+(padding|margin)(?:\s+(?:on\s+)?(.+))?$/i,
  );
  const spacingSet = text.match(
    /^(?:set|change)\s+(?:the\s+)?(padding|margin)\s+(?:to|of)\s+(\d+(?:\.\d+)?(?:\s*(?:px|rem))?)$/i,
  );
  const spacingSetSides = text.match(
    /^(?:set|change)\s+(?:the\s+)?(padding|margin)\s+on\s+(.+?)\s+(?:to|of)\s+(\d+(?:\.\d+)?(?:\s*(?:px|rem))?)$/i,
  );
  const spacingSideFirst = text.match(
    /^(?:set|change|add|give)\s+(?:the\s+)?(top|right|bottom|left)\s+(padding|margin)\s+(?:to\s+)?(\d+(?:\.\d+)?(?:\s*(?:px|rem))?)$/i,
  );
  if (
    spacingValueFirst !== null ||
    spacingSet !== null ||
    spacingSetSides !== null ||
    spacingSideFirst !== null
  ) {
    let property: "padding" | "margin";
    let rawSides: string | undefined;
    let rawLength: string;
    if (spacingValueFirst !== null) {
      rawLength = spacingValueFirst[1] ?? "";
      property = spacingValueFirst[2]!.toLowerCase() as "padding" | "margin";
      rawSides = spacingValueFirst[3];
    } else if (spacingSet !== null) {
      property = spacingSet[1]!.toLowerCase() as "padding" | "margin";
      rawLength = spacingSet[2] ?? "";
    } else if (spacingSetSides !== null) {
      property = spacingSetSides[1]!.toLowerCase() as "padding" | "margin";
      rawSides = spacingSetSides[2];
      rawLength = spacingSetSides[3] ?? "";
    } else {
      rawSides = spacingSideFirst![1];
      property = spacingSideFirst![2]!.toLowerCase() as "padding" | "margin";
      rawLength = spacingSideFirst![3] ?? "";
    }
    const length = normalizeLength(rawLength);
    const sides = parseSidesPhrase(rawSides);
    if (length !== null && sides !== null) {
      return styleAction(
        { family: "spacing", key: property, sides },
        `it has ${length} ${property}${formatSides(sides)}`,
        `Set ${property}${formatSides(sides)} to ${length}.`,
      );
    }
  }

  const direction = text.match(
    /^(?:arrange|lay\s*out|put|place|stack)\s+(?:its\s+|the\s+)?children\s+(?:in\s+(?:a\s+)?)?(row|column|vertically|horizontally|side\s+by\s+side)$/i,
  ) ??
    text.match(
      /^(?:make|set)\s+(?:it|this|the\s+layout)\s+(?:a\s+)?(row|column|horizontal|vertical)$/i,
    ) ??
    text.match(
      /^(?:make|set)\s+(?:the\s+)?children\s+(horizontal|vertical|row|column|side\s+by\s+side)$/i,
    );
  if (direction !== null) {
    const raw = direction[1]!.toLowerCase();
    const value =
      raw === "row" ||
      raw === "horizontally" ||
      raw === "horizontal" ||
      raw === "side by side"
        ? "row"
        : "column";
    return styleAction(
      { family: "layout", key: "direction" },
      `it arranges its children in a ${value}`,
      `Arrange children in a ${value}.`,
    );
  }
  if (/^stack\s+(?:its\s+|the\s+)?children$/i.test(text)) {
    return styleAction(
      { family: "layout", key: "direction" },
      "it arranges its children in a column",
      "Arrange children in a column.",
    );
  }

  if (
    /^(?:add|set|give)\s+(?:some\s+)?(?:space|gap)\s+between\s+(?:the\s+)?children$/i.test(
      text,
    )
  ) {
    return styleAction(
      { family: "layout", key: "gap" },
      "it has 16px gap between children",
      "Set the child gap to 16px.",
    );
  }

  const spacedChildren = text.match(
    /^(?:space|separate)\s+(?:the\s+)?children\s+(\d+(?:\.\d+)?(?:\s*(?:px|rem))?)\s+apart$/i,
  );
  if (spacedChildren !== null) {
    const value = normalizeLength(spacedChildren[1] ?? "");
    if (value !== null) {
      return styleAction(
        { family: "layout", key: "gap" },
        `it has ${value} gap between children`,
        `Set the child gap to ${value}.`,
      );
    }
  }

  const gap =
    text.match(
      /^(?:add|set|give|make)\s+(?:it\s+|this\s+)?(?:a\s+)?(\d+(?:\.\d+)?(?:\s*(?:px|rem))?)\s*(?:px|rem)?\s+gap(?:\s+between\s+children)?$/i,
    ) ??
    text.match(
      /^(?:set|change)\s+(?:the\s+)?gap\s+(?:to\s+)?(\d+(?:\.\d+)?(?:\s*(?:px|rem))?)$/i,
    );
  if (gap !== null) {
    const value = normalizeLength(gap[1] ?? "");
    if (value !== null) {
      return styleAction(
        { family: "layout", key: "gap" },
        `it has ${value} gap between children`,
        `Set the child gap to ${value}.`,
      );
    }
  }

  const childAlignment =
    text.match(
      /^(?:center|centre)\s+(?:its\s+|the\s+)?children(?:\s+(horizontally|vertically|both ways))?$/i,
    ) ??
    text.match(
      /^(?:make|set)\s+(?:the\s+)?children\s+(?:centered|center)(?:\s+(horizontally|vertically))?$/i,
    ) ??
    text.match(
      /^(?:align|set)\s+(?:the\s+)?children\s+(?:to\s+)?(?:the\s+)?(?:center|centered)$/i,
    ) ??
    (/^(?:center|centre)\s+(?:everything|all\s+(?:the\s+)?children)$/i.test(
      text,
    )
      ? [text]
      : null);
  if (childAlignment !== null) {
    const raw = (childAlignment[1] ?? "").toLowerCase();
    const axis = raw === "horizontally" || raw === "horizontally only"
      ? "horizontal"
      : raw === "vertically"
        ? "vertical"
        : "both";
    const direction = axis === "horizontal" ? "horizontally" : "vertically";
    return styleAction(
      { family: "layout", key: "align", axis },
      axis === "both"
        ? "it centers its children"
        : `it centers its children ${direction}`,
      axis === "both"
        ? "Center the children."
        : `Center the children ${direction}.`,
    );
  }

  const hoverPrefix =
    text.match(
      /^(?:when|on|while)\s+(?:it\s+is\s+)?hover(?:ed)?\s*,?\s+(.+)$/i,
    ) ?? text.match(/^hover(?:ed)?\s*,?\s+(.+)$/i);
  if (hoverPrefix !== null) {
    let rest = hoverPrefix[1]!.trim();
    let duration: string | null = null;
    const durationMatch = rest.match(
      /\s+over\s+(\d+(?:\.\d+)?)\s*(ms|s|seconds?|milliseconds?)?$/i,
    );
    if (durationMatch !== null) {
      duration = normalizeDuration(
        durationMatch[1] ?? "",
        durationMatch[2],
      );
      if (duration === null) return null;
      rest = rest.slice(0, durationMatch.index).trim();
    }
    const durationSuffix = duration === null ? "" : ` over ${duration}`;

    const colorEffect = rest.match(
      /^(?:make\s+|turn\s+|set\s+|change\s+)?(?:the\s+)?(background|text|border)(?:\s+(?:color|colour))?\s*(?:turns?|to|becomes?|be)?\s*(.+)$/i,
    );
    if (colorEffect !== null) {
      const color = normalizeColor(colorEffect[2] ?? "");
      if (color !== null) {
        const effect = colorEffect[1]!.toLowerCase() as
          | "background"
          | "text"
          | "border";
        return styleAction(
          { family: "hover", key: effect },
          `when hovered, the ${effect} turns ${color}${durationSuffix}`,
          `On hover, turn the ${effect} ${color}.`,
        );
      }
    }

    const lift = rest.match(
      /^(?:make\s+)?(?:it\s+)?(?:go\s+up|move\s+up|lift|raise|rise)(?:\s+(?:it|this))?(?:\s+(?:by|up))?\s*(\d+(?:\.\d+)?(?:\s*(?:px|rem))?)$/i,
    );
    if (lift !== null) {
      const value = normalizeLength(lift[1] ?? "");
      if (value !== null) {
        return styleAction(
          { family: "hover", key: "lift" },
          `when hovered, it lifts by ${value}${durationSuffix}`,
          `Lift the layer by ${value} on hover.`,
        );
      }
    }

    if (
      /^(?:make\s+)?(?:it\s+|this\s+)?(?:lift|raise|rise)(?:\s+(?:it|this))?$/i.test(
        rest,
      )
    ) {
      return styleAction(
        { family: "hover", key: "lift" },
        `when hovered, it lifts by 4px${durationSuffix}`,
        "Lift the layer by 4px on hover.",
      );
    }

    const scale = rest.match(
      /^(?:make\s+)?(?:it\s+)?(?:scale|zoom|grow)(?:\s+(?:it|this))?(?:\s+(?:to|up\s+to))?\s*(\d+(?:\.\d+)?)\s*%$/i,
    );
    if (scale !== null) {
      return styleAction(
        { family: "hover", key: "scale" },
        `when hovered, it scales to ${scale[1]}%${durationSuffix}`,
        `Scale the layer to ${scale[1]}% on hover.`,
      );
    }

    if (
      /^(?:make\s+)?(?:it\s+|this\s+)?(?:scale|zoom|grow|get\s+bigger)$/i.test(
        rest,
      ) ||
      /^(?:make\s+)?(?:it|this)\s+(?:a\s+bit\s+)?(?:bigger|larger)$/i.test(rest)
    ) {
      return styleAction(
        { family: "hover", key: "scale" },
        `when hovered, it scales to 105%${durationSuffix}`,
        "Scale the layer to 105% on hover.",
      );
    }

    const shorthand = rest.match(
      /^(?:make|turn|set)\s+(?:it|this)\s+(?:a\s+|an\s+|the\s+)?(.+)$/i,
    );
    if (shorthand !== null) {
      const color = normalizeColor(shorthand[1] ?? "");
      if (color !== null) {
        return styleAction(
          { family: "hover", key: "background" },
          `when hovered, the background turns ${color}${durationSuffix}`,
          `On hover, turn the background ${color}.`,
        );
      }
    }
  }

  const motionDuration = text.match(
    /\s+over\s+(\d+(?:\.\d+)?)\s*(ms|s|seconds?|milliseconds?)?\b/i,
  );
  const motionDurationValue =
    motionDuration === null
      ? null
      : normalizeDuration(motionDuration[1] ?? "", motionDuration[2]);
  const fadeMotion =
    /^(?:make\s+)?(?:it\s+|this\s+)?fade\s+(?:it\s+|this\s+)?in\b/i.test(text) ||
    /^(?:add|use)\s+(?:a\s+)?fade(?:\s+in)?\b/i.test(text) ||
    /^(?:animate\s+(?:it|this)\s+with\s+(?:a\s+)?)fade\b/i.test(text);
  if (fadeMotion) {
    return styleAction(
      { family: "motion" },
      `it fades in${motionDurationValue === null ? "" : ` over ${motionDurationValue}`} when the page loads`,
      "Fade the layer in when the page loads.",
    );
  }

  const sideSlide = text.match(
    /^(?:make\s+)?(?:it\s+|this\s+)?slide(?:\s+(?:it|this))?(?:\s+in)?(?:\s+from\s+the\s+(left|right|top|bottom))?/i,
  ) ??
    text.match(
      /^(?:add|use|animate)\s+(?:it\s+|this\s+)?(?:with\s+)?(?:a\s+)?slide(?:\s+in)?(?:\s+from\s+the\s+(left|right|top|bottom))?/i,
    );
  if (sideSlide !== null) {
    const direction = (sideSlide[1] ?? "bottom").toLowerCase();
    return styleAction(
      { family: "motion" },
      `it slides in from the ${direction}${motionDurationValue === null ? "" : ` over ${motionDurationValue}`} when the page loads`,
      `Slide the layer in from the ${direction}.`,
    );
  }

  if (/^animate\s+(?:it|this)\b/i.test(text)) {
    return styleAction(
      { family: "motion" },
      `it fades in${motionDurationValue === null ? "" : ` over ${motionDurationValue}`} when the page loads`,
      "Fade the layer in when the page loads.",
    );
  }

  const gradientDirection = text.match(
    /^(?:make|set|change)\s+(?:the\s+)?gradient\s+(?:go\s+)?(?:from\s+)?(left|right|top|bottom)\s+to\s+(left|right|top|bottom)$/i,
  );
  if (gradientDirection !== null) {
    const from = gradientDirection[1]!.toLowerCase();
    const to = gradientDirection[2]!.toLowerCase();
    const valid =
      (from === "left" && to === "right") ||
      (from === "right" && to === "left") ||
      (from === "top" && to === "bottom") ||
      (from === "bottom" && to === "top");
    if (valid) {
      return styleAction(
        { family: "gradient-direction" },
        `the gradient goes from ${from} to ${to}`,
        `Point the gradient from ${from} to ${to}.`,
      );
    }
  }

  return null;
}

function normalizeLength(value: string): string | null {
  const compact = value.trim().toLowerCase().replace(/\s+/g, "");
  if (compact === "0") return "0";
  const match = /^(\d+(?:\.\d+)?)(px|rem)?$/.exec(compact);
  if (match === null) return null;
  return `${match[1]}${match[2] ?? "px"}`;
}

function normalizeWeight(value: string): string | null {
  const word = value.trim().toLowerCase().replace(/[\s-]+/g, "");
  if (word === "thin" || word === "light" || word === "lighter") return "light";
  if (word === "normal" || word === "regular") return "regular";
  if (word === "medium") return "medium";
  if (word === "semibold") return "semibold";
  if (word === "bold" || word === "bolder") return "bold";
  return null;
}

function parseTextAlignment(
  text: string,
): "left" | "center" | "right" | null {
  if (
    /^(?:center|centre)\s+(?:the\s+)?(?:(?:heading|title|paragraph|button|link|label)\s+text|text|heading|title|content|it|this)$/i.test(
      text,
    ) ||
    /^(?:center|centre)[-\s]align\s+(?:the\s+)?(?:(?:heading|title|paragraph|button|link|label)\s+text|text|heading|title|content|it|this)$/i.test(
      text,
    ) ||
    /^(?:make|set)\s+(?:the\s+)?(?:(?:heading|title|paragraph|button|link|label)\s+text|text|heading|title|content|it|this)\s+(?:centered|center)$/i.test(
      text,
    )
  ) {
    return "center";
  }

  const side = text.match(
    /^(?:make|set)\s+(?:it|this|the\s+(?:text|content))\s+(left|right)\s+aligned$/i,
  );
  if (side !== null) return side[1]!.toLowerCase() as "left" | "right";

  const aligned = text.match(
    /^(?:align|set)\s+(?:the\s+)?(?:(?:heading|title|paragraph|button|link|label)\s+text|text|heading|title|content|it|this)(?:\s+alignment)?\s+(?:to\s+)?(left|right|center|centered)$/i,
  );
  if (aligned !== null) return normalizeAlignment(aligned[1]!);

  const bare = text.match(/^align\s+(left|right|center|centered)$/i);
  if (bare !== null) return normalizeAlignment(bare[1]!);

  const verbFirst = text.match(
    /^(left|right)[-\s]align\s+(?:the\s+)?(?:(?:heading|title|paragraph|button|link|label)\s+text|text|heading|title|content|it|this)$/i,
  );
  if (verbFirst !== null) {
    return verbFirst[1]!.toLowerCase() as "left" | "right";
  }
  return null;
}

function normalizeAlignment(
  value: string,
): "left" | "center" | "right" {
  const normalized = value.toLowerCase();
  return normalized === "centered"
    ? "center"
    : (normalized as "left" | "center" | "right");
}

function parseSidesPhrase(value: string | undefined): StyleSide[] | null {
  if (value === undefined || value.trim().length === 0) {
    return ["top", "right", "bottom", "left"];
  }
  const normalized = value
    .toLowerCase()
    .replace(/\b(?:the|on|side|sides)\b/g, " ")
    .replace(/,/g, " and ")
    .replace(/\s+/g, " ")
    .trim();
  const cleaned = normalized
    .replace(/\b(?:around|inside|it|everywhere)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const effective = cleaned.length === 0 ? "all" : cleaned;
  if (effective === "all" || effective === "both") {
    return ["top", "right", "bottom", "left"];
  }
  if (effective === "horizontal" || effective === "horizontally") {
    return ["left", "right"];
  }
  if (effective === "vertical" || effective === "vertically") {
    return ["top", "bottom"];
  }
  const parts = effective.split(/\s+and\s+/).filter(Boolean);
  const single = parts[0];
  if (parts.length === 1 && single !== undefined && isStyleSide(single)) {
    return [single];
  }
  if (parts.length === 2) {
    const [first, second] = parts;
    if (first === undefined || second === undefined) return null;
    if (!isStyleSide(first) || !isStyleSide(second)) return null;
    const set = new Set([first, second]);
    if (set.size !== 2) return null;
    if (set.has("left") && set.has("right")) return ["left", "right"];
    if (set.has("top") && set.has("bottom")) return ["top", "bottom"];
  }
  return null;
}

function isStyleSide(value: string): value is StyleSide {
  return value === "top" || value === "right" || value === "bottom" || value === "left";
}

function formatSides(sides: readonly StyleSide[]): string {
  if (sides.length === 4) return "";
  if (sides.length === 1) return ` on the ${sides[0]}`;
  if (sides.includes("left") && sides.includes("right")) {
    return " on the left and right";
  }
  if (sides.includes("top") && sides.includes("bottom")) {
    return " on the top and bottom";
  }
  return ` on the ${sides.join(" and ")}`;
}

function normalizeDuration(value: string, unit: string | undefined): string | null {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const normalized = unit?.toLowerCase() ?? "ms";
  return normalized === "s" || normalized === "second" || normalized === "seconds"
    ? `${Math.round(amount * 1000)}ms`
    : `${amount}ms`;
}

function success(action: NaturalLanguageAction): NaturalLanguageParseResult {
  return { ok: true, action };
}

function fail(message: string): NaturalLanguageParseResult {
  return { ok: false, message };
}

function unwrap(value: string): string {
  return value
    .trim()
    .replace(/^["'“”‘’]/, "")
    .replace(/["'“”‘’]$/, "")
    .trim();
}

function parseBackgroundValue(value: string): BackgroundValue | null {
  const normalized = unwrap(value)
    .replace(/\s+please$/i, "")
    .replace(/^(?:a|an|the)\s+/i, "")
    .trim();
  if (/^(?:none|transparent|no background)$/i.test(normalized)) {
    return { mode: "none" };
  }

  const gradient =
    normalized.match(
      /^(?:a\s+)?(?:linear\s+)?gradient\s+(?:from\s+)?(.+?)\s+(?:to|and)\s+(.+)$/i,
    ) ??
    normalized.match(
      /^(?:from\s+)?(.+?)\s+(?:to|and)\s+(.+?)\s+(?:linear\s+)?gradient$/i,
    );
  if (gradient !== null) {
    const from = normalizeColor(gradient[1] ?? "");
    const to = normalizeColor(gradient[2] ?? "");
    if (from !== null && to !== null) {
      return { mode: "gradient", from, to, conjunction: "and" };
    }
    return null;
  }

  const color = normalizeColor(normalized);
  return color === null ? null : { mode: "solid", color };
}

function normalizeColor(value: string): string | null {
  const normalized = unwrap(value)
    .replace(/\b(?:color|colour)$/i, "")
    .trim();
  if (/^#[0-9a-f]{3,8}$/i.test(normalized)) return normalized;

  const compact = normalized.toLowerCase().split(/\s+/).join("");
  return COMMON_COLORS.has(compact) ? compact : null;
}

function extractColor(text: string): string | null {
  const hex = text.match(/#[0-9a-f]{3,8}\b/i);
  if (hex !== null) return hex[0];
  const words = text.toLowerCase().match(/\b[a-z]+\b/g) ?? [];
  for (const word of words) {
    if (COMMON_COLORS.has(word) && word !== "transparent") return word;
  }
  return null;
}
