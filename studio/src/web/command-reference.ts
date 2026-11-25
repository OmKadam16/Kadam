export type CommandCategory =
  | "Text & layers"
  | "Typography"
  | "Backgrounds & gradients"
  | "Borders & corners"
  | "Shadows"
  | "Size"
  | "Spacing"
  | "Layout"
  | "Hover"
  | "Motion"
  | "Visibility";

export interface CommandReferenceEntry {
  readonly category: CommandCategory;
  readonly title: string;
  readonly description: string;
  readonly examples: readonly string[];
  readonly keywords?: readonly string[];
}

export interface CommandReferenceGroup {
  readonly category: CommandCategory;
  readonly entries: readonly CommandReferenceEntry[];
}

const CATEGORY_ORDER: readonly CommandCategory[] = [
  "Text & layers",
  "Typography",
  "Backgrounds & gradients",
  "Borders & corners",
  "Shadows",
  "Size",
  "Spacing",
  "Layout",
  "Hover",
  "Motion",
  "Visibility",
];

export const COMMAND_REFERENCE: readonly CommandReferenceEntry[] = [
  {
    category: "Text & layers",
    title: "Edit text",
    description: "Replace the copy inside the selected text layer.",
    examples: [
      "change the text to Welcome",
      "set the text to Start building",
      "say Hello from Kadam",
    ],
    keywords: ["copy", "label", "content", "write"],
  },
  {
    category: "Text & layers",
    title: "Add a layer",
    description:
      "Create a heading, paragraph, button, card, or container near the selection.",
    examples: [
      "add a heading saying Welcome",
      "add a paragraph",
      "create a button saying Save",
      "add a card",
      "add a container",
    ],
    keywords: ["new", "insert", "create", "container"],
  },
  {
    category: "Text & layers",
    title: "Move a layer",
    description: "Move the selected layer up or down among its siblings.",
    examples: ["move this up", "bring it down"],
    keywords: ["reorder", "order", "sibling"],
  },
  {
    category: "Text & layers",
    title: "Delete a layer",
    description: "Remove the selected layer after Studio confirms the edit.",
    examples: ["delete this"],
    keywords: ["remove", "erase"],
  },
  {
    category: "Text & layers",
    title: "Select a layer",
    description: "Select a layer by its name or humanized label.",
    examples: ["select hero", "pick the header layer"],
    keywords: ["choose", "focus"],
  },
  {
    category: "Typography",
    title: "Text color",
    description: "Use any CSS color name or hex value.",
    examples: [
      "make the text #2563EB",
      "change the text color to rebeccapurple",
      "make the heading text white",
    ],
    keywords: ["colour", "font color", "foreground"],
  },
  {
    category: "Typography",
    title: "Font size",
    description: "Set the selected text layer's size in px or rem.",
    examples: ["set the text size to 40px", "set the font size to 1.5rem"],
    keywords: ["type size", "text size"],
  },
  {
    category: "Typography",
    title: "Font weight",
    description: "Use light, regular, medium, semibold, or bold.",
    examples: [
      "make it bold",
      "set the text weight to semibold",
      "make the text light",
    ],
    keywords: ["thickness", "type weight"],
  },
  {
    category: "Typography",
    title: "Italic text",
    description: "Set the selected text to italic.",
    examples: ["make it italic", "italicize the text"],
    keywords: ["slant", "style"],
  },
  {
    category: "Typography",
    title: "Text alignment",
    description: "Align text to the left, center, or right.",
    examples: [
      "center the heading text",
      "align it right",
      "make the text left aligned",
    ],
    keywords: ["centre", "justify", "align text"],
  },
  {
    category: "Typography",
    title: "Font family",
    description: "Choose between the sans-serif, serif, and monospace presets.",
    examples: [
      "set the font to sans-serif",
      "use a serif font",
      "use monospace",
    ],
    keywords: ["typeface", "font"],
  },
  {
    category: "Backgrounds & gradients",
    title: "Background color",
    description: "Set a solid background by color name or hex value.",
    examples: [
      "make the background black",
      "set the background to #111827",
      "make it blue",
    ],
    keywords: ["colour", "fill", "surface"],
  },
  {
    category: "Backgrounds & gradients",
    title: "Remove background",
    description: "Clear the selected layer's solid or gradient background.",
    examples: ["remove the background"],
    keywords: ["transparent", "none", "fill"],
  },
  {
    category: "Backgrounds & gradients",
    title: "Two-color gradient",
    description: "Create a linear gradient from one color to another.",
    examples: [
      "make the background a linear gradient from #FDE68A to #F472B6",
      "make the background a gradient from black to blue",
    ],
    keywords: ["fill", "blend", "linear"],
  },
  {
    category: "Backgrounds & gradients",
    title: "Gradient direction",
    description: "Point an existing horizontal or vertical gradient.",
    examples: [
      "make the gradient go from left to right",
      "set the gradient from top to bottom",
    ],
    keywords: ["angle", "direction", "backdrop"],
  },
  {
    category: "Borders & corners",
    title: "Border",
    description: "Add a solid border with an optional width and color.",
    examples: [
      "add a border",
      "add a 2px solid blue border",
      "add a thick border",
    ],
    keywords: ["outline", "stroke", "colour"],
  },
  {
    category: "Borders & corners",
    title: "Remove border",
    description: "Remove the selected layer's border.",
    examples: ["remove the border"],
    keywords: ["no border", "outline", "stroke"],
  },
  {
    category: "Borders & corners",
    title: "Corner radius",
    description: "Set a custom corner radius in px or rem.",
    examples: [
      "make the corners 12px",
      "set the corner radius to 8px",
    ],
    keywords: ["rounded", "border radius", "radius"],
  },
  {
    category: "Borders & corners",
    title: "Fully rounded corners",
    description: "Turn the selected layer into a pill or fully round it.",
    examples: ["round the corners", "make it fully rounded"],
    keywords: ["pill", "capsule", "border radius"],
  },
  {
    category: "Borders & corners",
    title: "Reset corners",
    description: "Return the selected layer to square corners.",
    examples: ["reset the corners"],
    keywords: ["square", "sharp", "remove radius"],
  },
  {
    category: "Shadows",
    title: "Shadow levels",
    description: "Apply a soft, medium, or strong preset.",
    examples: [
      "add a soft shadow",
      "add a medium shadow",
      "make the shadow stronger",
    ],
    keywords: ["drop shadow", "elevation", "depth"],
  },
  {
    category: "Shadows",
    title: "Remove shadow",
    description: "Remove the selected layer's shadow.",
    examples: ["remove the shadow"],
    keywords: ["no shadow", "elevation", "depth"],
  },
  {
    category: "Size",
    title: "Width and height",
    description: "Set one dimension or both at once.",
    examples: [
      "make it 320px wide",
      "make it 180px tall",
      "make it 320px by 180px",
      "set the width to 240px",
    ],
    keywords: ["dimensions", "resize", "measurement"],
  },
  {
    category: "Size",
    title: "Full width or height",
    description: "Stretch the selected layer to fill its container.",
    examples: ["make it full width", "make it full height"],
    keywords: ["100%", "fill", "stretch"],
  },
  {
    category: "Size",
    title: "Reset size",
    description: "Remove the selected layer's explicit dimensions.",
    examples: ["make it auto-sized", "remove the height"],
    keywords: ["auto", "intrinsic", "clear dimensions"],
  },
  {
    category: "Spacing",
    title: "Padding",
    description: "Set inner spacing on any supported side, or clear every side.",
    examples: [
      "add 24px padding",
      "add some padding",
      "set padding to 20px",
      "add 16px padding on the left and right",
      "set the top padding to 8px",
      "remove all padding",
    ],
    keywords: ["inner space", "inset", "spacing"],
  },
  {
    category: "Spacing",
    title: "Margin",
    description: "Set outer spacing on all sides, a pair, or one side.",
    examples: [
      "add 12px margin",
      "add 12px margin on top and bottom",
      "remove all margin",
    ],
    keywords: ["outer space", "offset", "spacing"],
  },
  {
    category: "Spacing",
    title: "Child gap",
    description: "Control the space between a container's children.",
    examples: [
      "add 16px gap between children",
      "add some space between children",
      "space children 12px apart",
    ],
    keywords: ["spacing", "distribute", "children"],
  },
  {
    category: "Layout",
    title: "Row or column",
    description: "Arrange the selected container's children in a row or column.",
    examples: [
      "arrange children in a row",
      "stack children",
      "put children side by side",
      "make children vertical",
    ],
    keywords: ["horizontal", "vertical", "direction", "flex"],
  },
  {
    category: "Layout",
    title: "Center children",
    description: "Center child elements on one axis or both axes.",
    examples: [
      "align children center",
      "center children horizontally",
      "center children vertically",
      "center everything",
    ],
    keywords: ["alignment", "middle", "justify"],
  },
  {
    category: "Hover",
    title: "Hover color",
    description: "Change the background, text, or border color on hover.",
    examples: [
      "when hovered, make the background black",
      "on hover, change the text color to white",
      "when hovered, turn the border blue",
    ],
    keywords: ["hover state", "colour", "interaction"],
  },
  {
    category: "Hover",
    title: "Hover lift",
    description: "Move the layer upward while the pointer is over it.",
    examples: [
      "when hovered, lift it by 4px",
      "when hovered, raise it by 8px",
    ],
    keywords: ["raise", "float", "translate", "interaction"],
  },
  {
    category: "Hover",
    title: "Hover scale",
    description: "Grow the layer on hover by a preset or custom percentage.",
    examples: ["when hovered, make it bigger", "when hovered, scale to 105%"],
    keywords: ["grow", "zoom", "enlarge", "interaction"],
  },
  {
    category: "Hover",
    title: "Hover duration",
    description: "Set how long a hover transition takes in ms or seconds.",
    examples: [
      "when hovered, make the background black over 200ms",
      "when hovered, lift it by 4px over 150ms",
    ],
    keywords: ["transition", "timing", "speed"],
  },
  {
    category: "Hover",
    title: "Remove hover",
    description: "Delete every hover effect from the selected layer.",
    examples: ["remove the hover effect"],
    keywords: ["clear", "interaction", "hover state"],
  },
  {
    category: "Motion",
    title: "Fade in",
    description: "Fade the selected layer in when the page loads.",
    examples: ["fade it in", "fade it in over 300ms"],
    keywords: ["animation", "entrance", "appear", "opacity"],
  },
  {
    category: "Motion",
    title: "Slide in",
    description: "Slide the selected layer in from any edge.",
    examples: [
      "slide it in from the left",
      "slide it in from the right over 500ms",
      "slide it in from the bottom",
    ],
    keywords: ["animation", "entrance", "move", "direction"],
  },
  {
    category: "Motion",
    title: "Default animation",
    description: "Use the fade-in shorthand with an optional duration.",
    examples: ["animate it over 0.5 seconds"],
    keywords: ["animation", "fade", "timing"],
  },
  {
    category: "Motion",
    title: "Remove animation",
    description: "Remove the selected layer's entrance animation.",
    examples: ["remove all animations"],
    keywords: ["motion", "entrance", "clear"],
  },
  {
    category: "Visibility",
    title: "Hide or show",
    description: "Toggle the selected layer's visibility in the layout.",
    examples: ["hide it", "show it"],
    keywords: ["visible", "hidden", "display"],
  },
];

export function groupCommandReference(
  query: string,
): CommandReferenceGroup[] {
  const terms = query
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const matches =
    terms.length === 0
      ? COMMAND_REFERENCE
      : COMMAND_REFERENCE.filter((entry) => {
          const haystack = [
            entry.category,
            entry.title,
            entry.description,
            ...(entry.keywords ?? []),
            ...entry.examples,
          ]
            .join("\n")
            .toLowerCase();
          return terms.every((term) => haystack.includes(term));
        });

  const groups: CommandReferenceGroup[] = [];
  for (const category of CATEGORY_ORDER) {
    const entries = matches.filter((entry) => entry.category === category);
    if (entries.length > 0) groups.push({ category, entries });
  }
  return groups;
}
