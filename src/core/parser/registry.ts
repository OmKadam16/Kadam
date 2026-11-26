import type {
  Breakpoint,
  PageSettingNode,
  ResponsiveStatement,
  ScopedStatement,
  StatementNode,
  StatementScope,
} from "../ast/nodes.js";
import type { DiagnosticSpec } from "../diagnostics/diagnostic.js";
import type { Token } from "../lexer/token.js";
import type { Span } from "../source/source-file.js";
import {
  matchBackground,
  matchBorder,
  matchCorners,
  matchFieldAccepts,
  matchFieldLabel,
  matchFieldPlaceholder,
  matchFont,
  matchGradientDirection,
  matchImageDescription,
  matchImageSource,
  matchDocumentSource,
  matchLayoutAlign,
  matchLayoutDirection,
  matchPageSetting,
  matchShadow,
  matchSizeState,
  matchSpacing,
  matchGap,
  matchText,
  matchTypography,
} from "./matchers-appearance.js";
import { MIN_SCALE_03, matchClick, matchHover, matchMotion } from "./matchers-interaction.js";
import { BUILTIN_KIND_INFO, matchKindStatement } from "./kind.js";
import { matchDataLoad, matchDataShape, matchDataState } from "./matchers-f5.js";
import {
  matchCaption,
  matchCaptions,
  matchF1FieldType,
  matchF1State,
  matchFormAction,
  matchMediaSource,
  matchNoSpeech,
  matchOptions,
  matchPageMetadata,
  matchPoster,
  matchSubmit,
  matchTextSpan,
} from "./matchers-f1.js";
import {
  matchAspectRatio,
  matchChildRule,
  matchColumnSpan,
  matchFlexRule,
  matchFluidText,
  matchGrid,
  matchImageFit,
  matchImageFocus,
  matchLoading,
  matchOverflow,
  matchPercentSize,
  matchPosition,
  matchSizeLimit,
  matchContentWidth,
  matchSelfCenter,
  matchSticky,
} from "./matchers-f2.js";
import {
  matchBackdropBlur,
  matchBackgroundImage,
  matchBackgroundImageRule,
  matchCustomFont,
  matchF3Border,
  matchF3Corners,
  matchF3Gradient,
  matchF3ItIs,
  matchF3Shadow,
  matchF3Text,
  matchGradientAngle,
  matchLineClamp,
  matchLoop,
  matchOutline,
  matchScrollEntrance,
  matchStagger,
  matchState,
  isColorTokenDeclaration,
  isDarkModeLine,
  matchAutoDark,
  matchColorToken,
} from "./matchers-f3.js";
import {
  matchClickEffects,
  matchF4Click,
  matchFieldError,
  matchKeyEvent,
  matchRemember,
  matchStartsHidden,
  matchStartsOpen,
  matchSummary,
  matchTextBinding,
  matchVisibilityBinding,
} from "./matchers-f4.js";
import { readStateLiteral, readStateReference } from "./matchers-f4.js";
import type { StateLiteral, StateReference } from "../ast/nodes.js";
import { PROPERTIES, matchPropertySentence, propertyNamed } from "./properties.js";
import { closestMatches } from "./suggest.js";
import type {
  StatementMatchBody,
  StatementTemplate,
  TemplateContext,
} from "./statement-types.js";
import { describeTokens, isAnyWord, isKeyword, readLength, spanFromTokens } from "./values.js";
import { matchExternal, matchFormState, matchRawCss, matchStylesheetClass } from "./matchers-f6.js";
import { matchAdjustment, matchBackgroundPlay, matchColorFilter, matchEmbed, matchGenerativeBackground, matchGrain, matchLightbox, matchPattern, matchMasonry, matchNamedIcon, matchOverlay, matchScrollEffect, matchShape, matchSnap } from "./matchers-f8.js";
import {
  LATEST_UI_LANGUAGE_VERSION,
  uiVersionAtLeast,
  type UiLanguageVersion,
} from "../../version.js";

export interface ResponsiveTemplate extends StatementTemplate {
  readonly id: "responsive";
}

const DEFAULT_CONTEXT: TemplateContext = { allowResponsive: true };

/**
 * The finite statement table. Each entry is one canonical family from the
 * language specification. A line must match exactly one entry; the parser
 * never picks a best candidate.
 */
/** kadam 0.3 (F1) templates. */
const F1_TEMPLATES: readonly StatementTemplate[] = [
  { id: "page-metadata", description: "Page metadata", since: "0.3",
    examples: ['the page description says "Plans and pricing"', 'the page language is "fr"',
      'the page icon is "assets/icon.png"', 'the page share image is "assets/share.png"',
      "the page direction is right to left"],
    match: (tokens) => matchPageMetadata(tokens) },
  { id: "caption", description: "Table caption", since: "0.3",
    examples: ['the caption says "Plans"'], match: (tokens) => matchCaption(tokens) },
  { id: "media-source", description: "Video or audio source", since: "0.3",
    examples: ['it plays "assets/intro.mp4"'], match: (tokens) => matchMediaSource(tokens) },
  { id: "captions", description: "Video captions file", since: "0.3",
    examples: ['the captions are "assets/intro.vtt"'], match: (tokens) => matchCaptions(tokens) },
  { id: "poster", description: "Video poster image", since: "0.3",
    examples: ['the poster is "assets/poster.jpg"'], match: (tokens) => matchPoster(tokens) },
  { id: "no-speech", description: "Video without speech", since: "0.3",
    examples: ["it has no speech"], match: (tokens) => matchNoSpeech(tokens) },
  { id: "options", description: "Choice options", since: "0.3",
    examples: ['the options are "Small", "Medium", "Large"'], match: (tokens) => matchOptions(tokens) },
  { id: "f1-state", description: "Checked, disabled, or length-limit state", since: "0.3",
    examples: ["it is checked", "it is disabled", "it is at least 8 characters", "it is at most 200 characters"],
    match: (tokens) => matchF1State(tokens) },
  { id: "form-action", description: "Form destination", since: "0.3",
    examples: ['it sends to "https://example.com/subscribe"'], match: (tokens) => matchFormAction(tokens) },
  { id: "submit", description: "Submit button", since: "0.3",
    examples: ["it submits the form"], match: (tokens) => matchSubmit(tokens) },
  { id: "text-span", description: "Inline text span", since: "0.3",
    examples: ['the words "docs" go to page "Docs"', 'the words "fast" are bold',
      'the word "now" is italic', 'the words "source" open "https://example.com" in a new tab'],
    match: (tokens) => matchTextSpan(tokens) },
  { id: "f1-field-type", description: "Field input type", since: "0.3",
    examples: ["it accepts phone numbers", "it accepts dates", "it accepts web addresses"],
    match: (tokens) => matchF1FieldType(tokens) },
];

/** kadam 0.3 (F2) layout and sizing templates. */
/** kadam 0.3 (F8) image and box effects. */
const F8_TEMPLATES: readonly StatementTemplate[] = [
  { id: "color-filter", description: "Grayscale or sepia", since: "0.3",
    examples: ["it is grayscale", "it is sepia"], match: (tokens) => matchColorFilter(tokens) },
  { id: "adjustment", description: "Brightness, contrast, or saturation", since: "0.3",
    examples: ["the brightness is 120%", "the contrast is 110%", "the saturation is 0%"], match: (tokens) => matchAdjustment(tokens) },
  { id: "overlay", description: "Color overlay", since: "0.3",
    examples: ["it has a dark overlay at 40%", "it has a light overlay at 20%", "it has a #0F766E overlay at 30%"], match: (tokens) => matchOverlay(tokens) },
  { id: "shape", description: "Shape", since: "0.3",
    examples: ["it is shaped like a circle", "it is shaped like a hexagon", "it is shaped like a blob"], match: (tokens) => matchShape(tokens) },
  { id: "background-play", description: "Background video", since: "0.3",
    examples: ["it plays in the background"], match: (tokens) => matchBackgroundPlay(tokens) },
  { id: "scroll-effect", description: "Parallax or scroll progress", since: "0.3",
    examples: ["it scrolls slower than the page", "it shows how far the page has scrolled"], match: (tokens) => matchScrollEffect(tokens) },
  { id: "masonry", description: "Masonry columns", since: "0.3",
    examples: ["it arranges its children in 3 masonry columns"], match: (tokens) => matchMasonry(tokens) },
  { id: "snap", description: "Children snap while scrolling (carousel)", since: "0.3",
    examples: ["its children snap into place"], match: (tokens) => matchSnap(tokens) },
  { id: "lightbox", description: "Image opens larger", since: "0.3",
    examples: ["it opens larger when clicked"], match: (tokens) => matchLightbox(tokens) },
  { id: "named-icon", description: "Built-in named icon", since: "0.3",
    examples: ['it shows the icon "arrow right"'], match: (tokens) => matchNamedIcon(tokens) },
  { id: "embed", description: "Embed that loads when clicked", since: "0.3",
    examples: ['it embeds "https://www.youtube-nocookie.com/embed/abc" titled "Product tour"'], match: (tokens) => matchEmbed(tokens) },
  { id: "generative-background", description: "Mesh or aurora background", since: "0.3",
    examples: ["it has a mesh background of teal, violet and pink", "it has an aurora background of #0F766E and #7C3AED"], match: (tokens) => matchGenerativeBackground(tokens) },
  { id: "pattern", description: "Background pattern", since: "0.3",
    examples: ["it has a dotted pattern", "it has a grid pattern in #CBD5E1", "it has a lined pattern"], match: (tokens) => matchPattern(tokens) },
  { id: "grain", description: "Grain texture", since: "0.3",
    examples: ["it has a grain texture"], match: (tokens) => matchGrain(tokens) },
];

/** kadam 0.3 (F6, D-42) escape hatches. */
const F6_TEMPLATES: readonly StatementTemplate[] = [
  { id: "raw-css", description: "Raw CSS declaration (escape hatch)", since: "0.3",
    examples: ['the css "mask-image" is "url(assets/fade.svg)"', 'the css "clip-path" is "circle(40%)"'],
    match: (tokens) => matchRawCss(tokens) },
  { id: "stylesheet-class", description: "Class from an existing stylesheet (escape hatch)", since: "0.3",
    examples: ['it also uses the class "legacy-hero" from "styles/legacy.css"'],
    match: (tokens) => matchStylesheetClass(tokens) },
  { id: "external", description: "External function (escape hatch)", since: "0.3",
    examples: ['external trackEvent from "analytics.js" takes text and returns nothing'],
    match: (tokens) => matchExternal(tokens) },
  { id: "form-state", description: "Form sent or failed state (D-44)", since: "0.3",
    examples: ["when it is sent, it shows thanksNote", "when sending fails, it shows sorryNote"],
    match: (tokens) => matchFormState(tokens) },
];

const F2_TEMPLATES: readonly StatementTemplate[] = [
  { id: "percent-size", description: "Percentage size", since: "0.3",
    examples: ["it is 50% wide", "it is 100% tall", "it is 50% by 300px"],
    match: (tokens) => matchPercentSize(tokens) },
  { id: "size-limit", description: "Size limit", since: "0.3",
    examples: ["it is at most 1200px wide", "it is at least 50vh tall"],
    match: (tokens) => matchSizeLimit(tokens) },
  { id: "content-width", description: "Width that hugs the content", since: "0.3",
    examples: ["it is as wide as its content"],
    match: (tokens) => matchContentWidth(tokens) },
  { id: "self-center", description: "Center the box in its parent", since: "0.3",
    examples: ["it is centered"],
    match: (tokens) => matchSelfCenter(tokens) },
  { id: "aspect-ratio", description: "Shape (aspect ratio)", since: "0.3",
    examples: ["it keeps a 16 by 9 shape", "it keeps a square shape"],
    match: (tokens) => matchAspectRatio(tokens) },
  { id: "fluid-text", description: "Fluid text size", since: "0.3",
    examples: ["the text is between 1rem and 2.5rem", "the text size is between 16px and 24px"],
    match: (tokens) => matchFluidText(tokens) },
  { id: "flex-rule", description: "Child wrapping and spacing", since: "0.3",
    examples: ["it wraps its children", "it spreads its children apart", "it spaces its children evenly", "it stretches its children"],
    match: (tokens) => matchFlexRule(tokens) },
  { id: "child-rule", description: "Rule for a child in a row or column", since: "0.3",
    examples: ["it grows to fill the space", "it does not shrink", "it sits at the end"],
    match: (tokens) => matchChildRule(tokens) },
  { id: "grid", description: "Grid columns", since: "0.3",
    examples: ["it arranges its children in 3 columns", "it arranges its children in columns at least 240px wide"],
    match: (tokens) => matchGrid(tokens) },
  { id: "column-span", description: "Grid column span", since: "0.3",
    examples: ["it spans 2 columns", "it spans all columns"],
    match: (tokens) => matchColumnSpan(tokens) },
  { id: "sticky", description: "Sticky position", since: "0.3",
    examples: ["it sticks to the top", "it sticks 16px from the top"],
    match: (tokens) => matchSticky(tokens) },
  { id: "position", description: "Pinned or placed position", since: "0.3",
    examples: ["it is pinned to the bottom right", "it is pinned 24px from the bottom right",
      "it is placed over its parent", "it is placed at the top right of its parent"],
    match: (tokens) => matchPosition(tokens) },
  { id: "overflow", description: "Overflow", since: "0.3",
    examples: ["it scrolls vertically", "it scrolls horizontally", "it hides overflow"],
    match: (tokens) => matchOverflow(tokens) },
  { id: "image-fit", description: "Image fit", since: "0.3",
    examples: ["it fills its box", "it fits inside its box"],
    match: (tokens) => matchImageFit(tokens) },
  { id: "image-focus", description: "Image focus point", since: "0.3",
    examples: ["it keeps the top in view", "it keeps the bottom right in view"],
    match: (tokens) => matchImageFocus(tokens) },
  { id: "loading", description: "Image loading", since: "0.3",
    examples: ["it loads lazily", "it loads right away"],
    match: (tokens) => matchLoading(tokens) },
];

/** kadam 0.3 (F3) styling, state, and motion templates. */
const F3_TEMPLATES: readonly StatementTemplate[] = [
  { id: "styled-border", description: "Dashed, dotted, or per-side border", since: "0.3",
    examples: ["has a 2px dashed red border", "has a 1px #E5E5E5 border on the bottom", "has a dotted blue border on the left and right"],
    match: (tokens) => matchF3Border(tokens) },
  { id: "corner-radius", description: "Per-corner rounding", since: "0.3",
    examples: ["has 12px rounded corners on the top", "has fully rounded corners on the left"],
    match: (tokens) => matchF3Corners(tokens) },
  { id: "outline", description: "Outline", since: "0.3",
    examples: ["has a 2px blue outline"],
    match: (tokens) => matchOutline(tokens) },
  { id: "gradient-stops", description: "Multi-color or radial gradient", since: "0.3",
    examples: ["has a blue and white and red gradient", "has a radial white and blue gradient"],
    match: (tokens) => matchF3Gradient(tokens) },
  { id: "gradient-angle", description: "Gradient angle", since: "0.3",
    examples: ["the gradient goes at 135deg"],
    match: (tokens) => matchGradientAngle(tokens) },
  { id: "background-image", description: "Background image", since: "0.3",
    examples: ['has a "assets/hero.jpg" background image'],
    match: (tokens) => matchBackgroundImage(tokens) },
  { id: "background-image-rule", description: "Background image fit and focus", since: "0.3",
    examples: ["the background image covers its box", "the background image fits inside its box",
      "the background image repeats", "the background image keeps the top in view"],
    match: (tokens) => matchBackgroundImageRule(tokens) },
  { id: "text-style", description: "Text decoration, case, and line length", since: "0.3",
    examples: ["the text is underlined", "the text is struck through", "the text is uppercase",
      "the text is at most 65 characters wide"],
    match: (tokens) => matchF3Text(tokens) },
  { id: "line-clamp", description: "Truncation", since: "0.3",
    examples: ["it shows at most 2 lines"],
    match: (tokens) => matchLineClamp(tokens) },
  { id: "custom-font", description: "Custom font", since: "0.3",
    examples: ['the font is "Inter"'],
    match: (tokens) => matchCustomFont(tokens) },
  { id: "custom-shadow", description: "Inner, colored, or custom shadow", since: "0.3",
    examples: ["has a soft blue shadow", "has an inner shadow", "has a #00000033 shadow that is 24px blurred and 8px down"],
    match: (tokens) => matchF3Shadow(tokens) },
  { id: "effect", description: "Blur, rotation, move, or scale", since: "0.3",
    examples: ["it is blurred by 4px", "it is rotated by 10deg", "it is moved 8px down", "it is scaled to 110%"],
    match: (tokens) => matchF3ItIs(tokens) },
  { id: "backdrop-blur", description: "Background blur behind an element", since: "0.3",
    examples: ["it blurs the background behind it by 12px"],
    match: (tokens) => matchBackdropBlur(tokens) },
  { id: "state", description: "Interaction state effect", since: "0.3",
    examples: ["when focused, the border turns blue", "when pressed, it scales to 102%",
      "when disabled, the background turns gray", "when checked, the text turns green",
      "when invalid, the border turns red", "when hovered, it rotates by 10deg"],
    match: (tokens) => matchState(tokens) },
  { id: "scroll-entrance", description: "Entrance when scrolled into view", since: "0.3",
    examples: ["it fades in when it scrolls into view", "it slides in from the left when it scrolls into view"],
    match: (tokens) => matchScrollEntrance(tokens) },
  { id: "loop", description: "Looping animation", since: "0.3",
    examples: ["it spins forever", "it pulses every 2s", "it floats forever"],
    match: (tokens) => matchLoop(tokens) },
  { id: "color-token", description: "Theme color", since: "0.3",
    examples: ["the brand color is #FF0066"],
    match: (tokens) => matchColorToken(tokens) },
  { id: "auto-dark", description: "Built-in dark palette", since: "0.3",
    examples: ["the page is dark when the system is dark"],
    match: (tokens) => matchAutoDark(tokens) },
  { id: "stagger", description: "Staggered child entrance", since: "0.3",
    examples: ["its children fade in one after another", "its children slide in from the bottom one after another"],
    match: (tokens) => matchStagger(tokens) },
];

/** kadam 0.3 (F4 step 1) native interactions. */
const F4_TEMPLATES: readonly StatementTemplate[] = [
  { id: "f4-click", description: "In-page, email, phone, or download link", since: "0.3",
    examples: ['when clicked, go to "features"', 'when clicked, send an email to "hello@acme.com"',
      'when clicked, call "+1 555 0100"', 'when clicked, download "assets/guide.pdf"'],
    match: (tokens) => matchF4Click(tokens) },
  { id: "summary", description: "Expandable section title", since: "0.3",
    examples: ['the title says "What is Kadam?"'],
    match: (tokens) => matchSummary(tokens) },
  { id: "starts-open", description: "Expandable section starts open", since: "0.3",
    examples: ["it starts open"],
    match: (tokens) => matchStartsOpen(tokens) },
  { id: "field-error", description: "Field error message", since: "0.3",
    examples: ['the error says "Enter a valid email address"'],
    match: (tokens) => matchFieldError(tokens) },
  // Step 2 (D-36 runtime)
  { id: "click-effects", description: "Click effects", since: "0.3",
    examples: ['when clicked, flip "menu1"', 'when clicked, show "panel2" and hide "panel1"',
      'when clicked, open dialog "signupDialog"', "when clicked, close the dialog",
      "when clicked, add 1 to count of cart1", "when clicked, flip isOpen of menu1"],
    match: (tokens) => matchClickEffects(tokens) },
  { id: "key-event", description: "Key press effects", since: "0.3",
    examples: ['when the Escape key is pressed, hide "menu1"', "when the Escape key is pressed, it is hidden"],
    match: (tokens) => matchKeyEvent(tokens) },
  { id: "remember", description: "Element state", since: "0.3",
    examples: ["it remembers isOpen, a boolean that starts as false", "it remembers count, a number that starts as 0"],
    match: (tokens) => matchRemember(tokens) },
  { id: "starts-hidden", description: "Hidden until shown by an effect", since: "0.3",
    examples: ["it starts hidden"],
    match: (tokens) => matchStartsHidden(tokens) },
  { id: "text-binding", description: "Text bound to state", since: "0.3",
    examples: ["the text shows count of cart1"],
    match: (tokens) => matchTextBinding(tokens) },
  { id: "visibility-binding", description: "Visibility bound to state", since: "0.3",
    examples: ["it is hidden unless isOpen of menu1 is true"],
    match: (tokens) => matchVisibilityBinding(tokens) },
];

export const STATEMENT_TEMPLATES: readonly StatementTemplate[] = [
  // kadam 0.3 (F5 step 6, D-41): runtime data.
  { id: "data-load", description: "Load data at run time", since: "0.3",
    examples: ['it loads products from "https://api.example.com/products"'],
    match: (tokens) => matchDataLoad(tokens) },
  { id: "data-shape", description: "Shape of loaded records", since: "0.3",
    examples: ["each product has a name as text, a price as a number, and a link as a url"],
    match: (tokens) => matchDataShape(tokens) },
  { id: "data-state", description: "Loading, empty, and error states", since: "0.3",
    examples: ["while loading, it shows loadingNote", "when there are none, it shows emptyNote", "when loading fails, it shows errorNote"],
    match: (tokens) => matchDataState(tokens) },
  {
    id: "kind",
    description: "Element kind declaration",
    examples: [
      "a button",
      "an image that is 560px by 360px",
      "a text field",
      "a navigation bar",
    ],
    match: (tokens, context) => {
      const result = matchKindStatement(tokens);
      if (result === null) return null;
      const kind = result.kind;
      const reference = kind?.reference;
      const version = context.languageVersion ?? LATEST_UI_LANGUAGE_VERSION;
      if (reference?.type === "builtin-kind") {
        const since = BUILTIN_KIND_INFO[reference.name].since ?? "0.1";
        if (!uiVersionAtLeast(version, since)) {
          return {
            // Keep the kind so the element is not also "missing a kind".
            statement: kind,
            diagnostics: [
              ...result.diagnostics,
              requiresVersion(tokens, `${kind!.article} ${reference.name}`, since, version),
            ],
          };
        }
      }
      if (kind?.repeat !== undefined && !uiVersionAtLeast(version, "0.3")) {
        return { statement: kind, diagnostics: [...result.diagnostics, requiresVersion(tokens, "for each ... in ...", "0.3", version)] };
      }
      return { statement: kind, diagnostics: result.diagnostics };
    },
  },
  {
    id: "page-background",
    description: "Page background color",
    examples: ["the page background is #F7F5F0"],
    match: (tokens) =>
      isKeyword(tokens[2], "background") ? matchPageSetting(tokens) : null,
  },
  {
    id: "page-text",
    description: "Page default text color",
    examples: ["the page text is #171717"],
    match: (tokens) =>
      isKeyword(tokens[2], "text") ? matchPageSetting(tokens) : null,
  },
  {
    id: "page-font",
    description: "Page default font family",
    examples: ["the page font is sans serif"],
    match: (tokens) =>
      isKeyword(tokens[2], "font") ? matchPageSetting(tokens) : null,
  },
  {
    id: "text",
    description: "Text content",
    examples: [
      'the text says "Get Started"',
      'the button text says "Get Started"',
      'the heading text says "Welcome"',
    ],
    match: (tokens) => matchText(tokens),
  },
  {
    id: "size-state",
    description: "Size, visibility, decorative, or required state",
    examples: [
      "it is 160px by 48px",
      "it is 160px wide",
      "it is full width",
      "it is hidden",
      "it is decorative",
      "it is required",
    ],
    match: (tokens) => matchSizeState(tokens),
  },
  {
    id: "background",
    description: "Solid, absent, or gradient background",
    examples: [
      "has a blue background",
      "has no background",
      "has a blue and black gradient",
    ],
    match: (tokens) => matchBackground(tokens),
  },
  {
    id: "gradient-direction",
    description: "Gradient direction",
    examples: ["the gradient goes from left to right"],
    match: (tokens) => matchGradientDirection(tokens),
  },
  {
    id: "border",
    description: "Border",
    examples: ["has a white border", "has a 2px white border", "has no border"],
    match: (tokens) => matchBorder(tokens),
  },
  {
    id: "corners",
    description: "Corner radius",
    examples: [
      "has rounded corners",
      "has 12px rounded corners",
      "has fully rounded corners",
    ],
    match: (tokens) => matchCorners(tokens),
  },
  {
    id: "shadow",
    description: "Shadow preset",
    examples: ["has a soft shadow", "has a medium shadow", "has no shadow"],
    match: (tokens) => matchShadow(tokens),
  },
  {
    id: "typography",
    description: "Text typography",
    examples: [
      "the text is 18px",
      "the text is blue",
      "the text is semibold",
      "the text is italic",
      "the text is centered",
      "the text is left aligned",
    ],
    match: (tokens) => matchTypography(tokens),
  },
  {
    id: "font-family",
    description: "Font family preset",
    examples: ["the font is sans serif"],
    match: (tokens) => matchFont(tokens),
  },
  {
    id: "spacing",
    description: "Padding or margin",
    examples: [
      "it has 24px padding",
      "it has 16px padding on the left",
      "it has 16px padding on the left and right",
      "it has 32px margin",
      "it has 16px margin on top and bottom",
    ],
    match: (tokens) => matchSpacing(tokens),
  },
  {
    id: "layout-direction",
    description: "Child layout direction",
    examples: ["it arranges its children in a row"],
    match: (tokens) => matchLayoutDirection(tokens),
  },
  {
    id: "layout-gap",
    description: "Gap between children",
    examples: ["it has 16px gap between children"],
    match: (tokens) => matchGap(tokens),
  },
  {
    id: "layout-align",
    description: "Alignment of children",
    examples: [
      "it centers its children",
      "it centers its children horizontally",
    ],
    match: (tokens) => matchLayoutAlign(tokens),
  },
  {
    id: "image-source",
    description: "Image source path",
    examples: ['it shows "assets/hero.png"'],
    match: (tokens) => matchImageSource(tokens),
  },
  {
    id: "document-source",
    description: "Markdown document shown inside the element",
    since: "0.3",
    examples: ['it shows the document "content/intro.md"'],
    match: (tokens) => matchDocumentSource(tokens),
  },
  {
    id: "image-description",
    description: "Image description",
    examples: ['the description says "A person using the Kadam editor"'],
    match: (tokens) => matchImageDescription(tokens),
  },
  {
    id: "field-label",
    description: "Text field label",
    examples: ['the label says "Email"'],
    match: (tokens) => matchFieldLabel(tokens),
  },
  {
    id: "field-placeholder",
    description: "Text field placeholder",
    examples: ['the placeholder says "you@example.com"'],
    match: (tokens) => matchFieldPlaceholder(tokens),
  },
  {
    id: "field-type",
    description: "Text field input type",
    examples: ["it accepts email addresses"],
    match: (tokens) => matchFieldAccepts(tokens),
  },
  {
    id: "hover",
    description: "Hover effect",
    examples: [
      "when hovered, the background turns blue",
      "when hovered, it lifts by 2px",
      "when hovered, it scales to 105%",
      "when hovered, the border turns black over 200ms",
    ],
    match: (tokens, context) =>
      matchHover(tokens, uiVersionAtLeast(context.languageVersion ?? LATEST_UI_LANGUAGE_VERSION, "0.3") ? MIN_SCALE_03 : 100),
  },
  {
    id: "click",
    description: "Click action",
    examples: [
      'when clicked, go to page "About"',
      'when clicked, open "https://example.com" in a new tab',
    ],
    match: (tokens) => matchClick(tokens),
  },
  {
    id: "motion",
    description: "Entrance animation",
    examples: [
      "it fades in when the page loads",
      "it fades in over 600ms when the page loads",
      "it slides in from the left when the page loads",
    ],
    match: (tokens) => matchMotion(tokens),
  },
  ...F1_TEMPLATES,
  ...F2_TEMPLATES,
  ...F6_TEMPLATES,
  ...F8_TEMPLATES,
  ...F3_TEMPLATES,
  ...F4_TEMPLATES,
  {
    id: "property",
    description: "Regular property sentence",
    examples: PROPERTIES.map((property) => property.example),
    since: "0.3",
    match: (tokens) => matchPropertySentence(tokens),
  },
];

export const RESPONSIVE_TEMPLATE: ResponsiveTemplate = {
  id: "responsive",
  description: "Breakpoint-scoped statement",
  examples: [
    "on phones, the text is 24px",
    "on tablets, it has 16px padding",
    "on phones, it is hidden",
    "on desktops, it centers its children horizontally",
  ],
  // The registry handles the responsive prefix directly in `matchLine`.
  match: () => null,
};

const RESPONSIVE_ALLOWED: ReadonlySet<string> = new Set([
  "size",
  "background",
  "gradient-direction",
  "border",
  "corners",
  "shadow",
  "typography",
  "font-family",
  "spacing",
  "layout",
  "visibility",
  "property",
  // kadam 0.3 (F2)
  "size-limit",
  "aspect-ratio",
  "content-width",
  "self-center",
  "fluid-text",
  "flex-rule",
  "child-rule",
  "grid",
  "column-span",
  "sticky",
  "position",
  "overflow",
  "image-fit",
  "image-focus",
  // kadam 0.3 (F3)
  "side-border",
  "corner-radius",
  "outline",
  "gradient",
  "gradient-angle",
  "background-fit",
  "background-focus",
  "text-decoration",
  "text-case",
  "text-measure",
  "line-clamp",
  "custom-font",
  "custom-shadow",
  "filter",
  "rotate",
  "move",
  "scale",
  // kadam 0.3 (F4): a menu that is open only on phones
  "visibility-binding",
  // kadam 0.3 (F6): the raw css escape hatch
  "raw-css",
  // kadam 0.3 (F8): image and box effects
  "image-filter",
  "overlay",
  "shape",
]);

const BREAKPOINTS: ReadonlySet<string> = new Set([
  "phones",
  "tablets",
  "desktops",
]);

export interface TemplateMatch {
  readonly template: StatementTemplate;
  readonly body: StatementMatchBody;
}

export interface MatchLineResult {
  /** All templates that claimed the line. More than one is a compiler defect. */
  readonly matches: readonly TemplateMatch[];
  /** Diagnostics produced by the selected template, or by matching itself. */
  readonly diagnostics: readonly DiagnosticSpec[];
  /** Present only when exactly one template matched. */
  readonly selected: TemplateMatch | null;
}

/**
 * Match one logical line. The template table is intentionally exhaustible so
 * tests can inject overlapping entries and prove ambiguity is never resolved.
 */
export function matchLine(
  tokens: readonly Token[],
  context: TemplateContext = DEFAULT_CONTEXT,
  templates: readonly StatementTemplate[] = STATEMENT_TEMPLATES,
): MatchLineResult {
  const negative = negativeValueDiagnostic(tokens);
  if (negative !== null) return { matches: [], diagnostics: [negative], selected: null };
  const resolved = resolveColorTokens(tokens, context);
  const result = matchLineStatements(resolved, context, templates);
  const unitErrors = newUnitDiagnostics(tokens, context);
  return unitErrors.length === 0
    ? result
    : { ...result, diagnostics: [...result.diagnostics, ...unitErrors] };
}

function matchLineStatements(
  tokens: readonly Token[],
  context: TemplateContext,
  templates: readonly StatementTemplate[],
): MatchLineResult {
  if (tokens.length === 0) {
    return { matches: [], diagnostics: [], selected: null };
  }

  if (context.allowResponsive && isDarkModeLine(tokens)) {
    return matchDarkLine(tokens, context, templates);
  }
  if (context.allowResponsive && stateLineHead(tokens) !== null) {
    return matchStateLine(tokens, context, templates);
  }
  if (context.allowResponsive && (isCustomBreakpointLine(tokens) || isContainerLine(tokens))) {
    return matchScopedLine(tokens, context, templates);
  }
  if (context.allowResponsive && isKeyword(tokens[0], "on")) {
    return matchResponsiveLine(tokens, context, templates);
  }

  const matches = collectMatches(tokens, context, templates);

  if (matches.length === 0) {
    return {
      matches,
      diagnostics: [unrecognizedStatement(tokens)],
      selected: null,
    };
  }
  if (matches.length > 1) {
    return {
      matches,
      diagnostics: [ambiguousStatement(tokens, matches)],
      selected: null,
    };
  }
  return {
    matches,
    diagnostics: matches[0]!.body.diagnostics,
    selected: matches[0]!,
  };
}

/**
 * Match the one ordinary statement after a scope prefix (`on phones,`,
 * `on wide screens,`, `when its parent is narrower than 400px,`). Pushes
 * diagnostics and returns null when the inner statement is not allowed.
 */
function matchScopedInner(
  innerTokens: readonly Token[],
  label: string,
  commaSpan: Span,
  context: TemplateContext,
  templates: readonly StatementTemplate[],
  diagnostics: DiagnosticSpec[],
): StatementNode | null {
  if (innerTokens.length === 0) {
    diagnostics.push({
      code: "KDM2010",
      message: `expected a statement after ${label},`,
      span: commaSpan,
      hint: "responsive statements wrap one ordinary element statement",
    });
    return null;
  }

  if (isKeyword(innerTokens[0], "on") || isContainerLine(innerTokens) || isDarkModeLine(innerTokens)) {
    diagnostics.push({
      code: "KDM3013",
      message: "a responsive statement cannot be nested inside another responsive scope",
      span: spanFromTokens(innerTokens),
      hint: "use one breakpoint prefix per line",
    });
    return null;
  }

  if (isKeyword(innerTokens[0], "a") || isKeyword(innerTokens[0], "an")) {
    diagnostics.push({
      code: "KDM3013",
      message: "kind declarations are not allowed in a responsive scope",
      span: spanFromTokens(innerTokens),
      hint: "declare the kind once, outside any breakpoint",
    });
    return null;
  }

  const innerContext: TemplateContext = {
    allowResponsive: false,
    languageVersion: context.languageVersion,
    breakpoints: context.breakpoints,
  };
  const innerMatches = collectMatches(innerTokens, innerContext, templates);
  if (innerMatches.length === 0) {
    diagnostics.push(unrecognizedStatement(innerTokens));
    return null;
  }
  if (innerMatches.length > 1) {
    diagnostics.push(ambiguousStatement(innerTokens, innerMatches));
    return null;
  }

  const innerBody = innerMatches[0]!.body;
  diagnostics.push(...innerBody.diagnostics);
  const innerStatement = innerBody.statement;
  if (innerStatement === null) return null;
  if (innerStatement.type === "page-setting") {
    diagnostics.push({
      code: "KDM3013",
      message: "page settings are not allowed in a responsive scope",
      span: innerStatement.span,
      hint: "page settings apply to the whole page; use an element statement",
    });
    return null;
  }
  if (innerStatement.type === "kind") {
    diagnostics.push({
      code: "KDM3013",
      message: "kind declarations are not allowed in a responsive scope",
      span: innerStatement.span,
      hint: "declare the kind once, outside any breakpoint",
    });
    return null;
  }
  if (!RESPONSIVE_ALLOWED.has(innerStatement.type)) {
    diagnostics.push({
      code: "KDM3013",
      message: `${innerStatement.type} statements are not allowed in a responsive scope`,
      span: innerStatement.span,
      hint:
        "responsive scopes allow size, background, border, corners, shadow, typography, spacing, layout, and visibility",
    });
    return null;
  }
  return innerStatement as StatementNode;
}

/** `when its parent is ...`: a kadam 0.3 container-query line. */
function isContainerLine(tokens: readonly Token[]): boolean {
  return isAnyWord(tokens[0], "when") && isAnyWord(tokens[1], "its") && isAnyWord(tokens[2], "parent");
}

/** `on <name> screens,`: a kadam 0.3 custom breakpoint from kadam.json. */
function isCustomBreakpointLine(tokens: readonly Token[]): boolean {
  return (
    isKeyword(tokens[0], "on") &&
    !BREAKPOINTS.has(tokens[1]?.text.toLowerCase() ?? "") &&
    isAnyWord(tokens[2], "screens")
  );
}

export const SCOPED_TEMPLATE: StatementTemplate = {
  id: "scoped",
  description: "Custom breakpoint or container query",
  since: "0.3",
  examples: [
    "on wide screens, it arranges its children in 4 columns",
    "when its parent is narrower than 400px, it arranges its children in a column",
  ],
  // The registry handles these prefixes directly in `matchLine`.
  match: () => null,
};

const CONTAINER_HINT = "for example: when its parent is narrower than 400px, it arranges its children in a column";

function matchScopedLine(
  tokens: readonly Token[],
  context: TemplateContext,
  templates: readonly StatementTemplate[],
): MatchLineResult {
  const diagnostics: DiagnosticSpec[] = [];
  const failed = (): MatchLineResult => ({
    matches: [{ template: SCOPED_TEMPLATE, body: { statement: null, diagnostics } }],
    diagnostics,
    selected: null,
  });
  const version = context.languageVersion ?? LATEST_UI_LANGUAGE_VERSION;

  let scope: StatementScope;
  let label: string;
  let commaIndex: number;
  if (isContainerLine(tokens)) {
    const comparison = tokens[4];
    const width = tokens[6] === undefined ? null : readLength(tokens[6]);
    if (
      !isKeyword(tokens[3], "is") ||
      (!isAnyWord(comparison, "narrower") && !isAnyWord(comparison, "wider")) ||
      !isAnyWord(tokens[5], "than") ||
      width === null ||
      (width.unit !== "px" && width.unit !== "rem" && width.unit !== "em") ||
      width.value <= 0
    ) {
      diagnostics.push({
        code: "KDM3005",
        message: "a container condition is: when its parent is narrower or wider than <width>,",
        span: spanFromTokens(tokens.slice(0, Math.min(tokens.length, 7))),
        hint: `${CONTAINER_HINT} (the width uses px, rem, or em)`,
      });
      return failed();
    }
    scope = {
      kind: "container",
      comparison: isAnyWord(comparison, "narrower") ? "narrower" : "wider",
      width,
    };
    label = `when its parent is ${scope.comparison} than ${width.raw}`;
    commaIndex = 7;
  } else {
    const name = tokens[1]!.text.toLowerCase();
    const minWidth = context.breakpoints?.get(name);
    if (minWidth === undefined) {
      diagnostics.push({
        code: "KDM3005",
        message: `unknown breakpoint ${JSON.stringify(name)}`,
        span: tokens[1]!.span,
        hint: `use phones, tablets, or desktops, or define it in kadam.json: "breakpoints": { "${name}": 1440 }`,
      });
      return failed();
    }
    scope = { kind: "breakpoint", name, minWidth };
    label = `on ${name} screens`;
    commaIndex = 3;
  }

  const comma = tokens[commaIndex];
  if (comma?.kind !== "comma") {
    diagnostics.push({
      code: "KDM2010",
      message: `a comma is required after ${label}`,
      span: comma?.span ?? tokens[commaIndex - 1]!.span,
      hint: `write: ${label}, it is hidden`,
    });
    return failed();
  }

  const inner = matchScopedInner(tokens.slice(commaIndex + 1), label, comma.span, context, templates, diagnostics);
  if (inner === null) return failed();
  if (!uiVersionAtLeast(version, "0.3")) {
    diagnostics.push(
      requiresVersion(tokens, scope.kind === "container" ? "a container condition" : "a custom breakpoint", "0.3", version),
    );
  }
  const statement: ScopedStatement = { type: "scoped", scope, statement: inner, span: spanFromTokens(tokens) };
  const selected = { template: SCOPED_TEMPLATE, body: { statement, diagnostics } };
  return { matches: [selected], diagnostics, selected };
}

/**
 * Replace declared theme color names (D-38) with color tokens, so every
 * sentence that takes a color accepts them. A declaration line keeps its own
 * name as written. Only declared names are touched, so 0.1 files and
 * undeclared words are unchanged.
 */
function resolveColorTokens(tokens: readonly Token[], context: TemplateContext): readonly Token[] {
  const names = context.colorTokens;
  if (names === undefined || names.size === 0) return tokens;
  const declaration = isDarkModeLine(tokens) ? isColorTokenDeclaration(tokens.slice(4)) : isColorTokenDeclaration(tokens);
  const skip = declaration ? (isDarkModeLine(tokens) ? 5 : 1) : -1;
  let changed = false;
  const out = tokens.map((token, index) => {
    if (index === skip || (token.kind !== "identifier" && token.kind !== "word") || !names.has(token.text)) return token;
    changed = true;
    return { ...token, kind: "color" as const, value: `token:${token.text}` };
  });
  return changed ? out : tokens;
}

/**
 * `in dark mode, <statement>` (D-38): an element statement in a dark scope,
 * or a page background/text setting or theme color for dark mode.
 */
function matchDarkLine(
  tokens: readonly Token[],
  context: TemplateContext,
  templates: readonly StatementTemplate[],
): MatchLineResult {
  const diagnostics: DiagnosticSpec[] = [];
  const failed = (): MatchLineResult => ({
    matches: [{ template: SCOPED_TEMPLATE, body: { statement: null, diagnostics } }],
    diagnostics,
    selected: null,
  });
  const comma = tokens[3];
  if (comma?.kind !== "comma") {
    diagnostics.push({
      code: "KDM2010",
      message: "a comma is required after in dark mode",
      span: comma?.span ?? tokens[2]!.span,
      hint: "write: in dark mode, has a #1F2937 background",
    });
    return failed();
  }
  const inner = tokens.slice(4);
  const version = context.languageVersion ?? LATEST_UI_LANGUAGE_VERSION;
  const versionError = uiVersionAtLeast(version, "0.3") ? [] : [requiresVersion(tokens, "dark mode", "0.3", version)];
  const span = spanFromTokens(tokens);

  // Page-level: the page background/text, or a theme color.
  const pageMatches = collectMatches(inner, { ...context, allowResponsive: false }, templates).filter(
    (match) => match.body.statement?.type === "page-setting",
  );
  if (pageMatches.length === 1) {
    const setting = pageMatches[0]!.body.statement as PageSettingNode;
    diagnostics.push(...pageMatches[0]!.body.diagnostics, ...versionError);
    if (setting.property !== "background" && setting.property !== "text" && setting.property !== "color token") {
      diagnostics.push({
        code: "KDM3013",
        message: "only the page background, the page text, and theme colors can change in dark mode",
        span,
        hint: "write: in dark mode, the page background is #111418",
      });
      return failed();
    }
    const statement = { ...setting, dark: true as const, span };
    const selected = { template: SCOPED_TEMPLATE, body: { statement, diagnostics } };
    return { matches: [selected], diagnostics, selected };
  }

  const statement = matchScopedInner(inner, "in dark mode", comma.span, context, templates, diagnostics);
  if (statement === null) return failed();
  diagnostics.push(...versionError);
  const scoped: ScopedStatement = { type: "scoped", scope: { kind: "dark" }, statement, span };
  const selected = { template: SCOPED_TEMPLATE, body: { statement: scoped, diagnostics } };
  return { matches: [selected], diagnostics, selected };
}

/** Words after `when` that start other sentences, never a state name. */
const NOT_STATES: ReadonlySet<string> = new Set(["it", "its", "the", "sending", "clicked", "hovered", "pressed", "focused", "disabled", "checked", "invalid"]);

/** `when <state> [of <element>] is <value>,`: the state, the value, and where the comma is. */
function stateLineHead(tokens: readonly Token[]): { state: StateReference; value: StateLiteral; comma: number } | null {
  if (!isAnyWord(tokens[0], "when") || NOT_STATES.has(tokens[1]?.text.toLowerCase() ?? "")) return null;
  const comma = tokens.findIndex((token) => token.kind === "comma");
  if (comma < 4) return null;
  const is = tokens.slice(0, comma).findIndex((token, index) => index > 1 && isKeyword(token, "is"));
  if (is === -1) return null;
  const state = readStateReference(tokens.slice(1, is));
  const value = readStateLiteral(tokens.slice(is + 1, comma));
  return state === null || value === null ? null : { state, value, comma };
}

/** kadam 0.3: one style statement that applies while a state has a value. */
function matchStateLine(tokens: readonly Token[], context: TemplateContext, templates: readonly StatementTemplate[]): MatchLineResult {
  const head = stateLineHead(tokens)!;
  const diagnostics: DiagnosticSpec[] = [];
  const version = context.languageVersion ?? LATEST_UI_LANGUAGE_VERSION;
  const statement = matchScopedInner(tokens.slice(head.comma + 1), "when a state has a value", tokens[head.comma]!.span, context, templates, diagnostics);
  if (statement === null) return { matches: [], diagnostics, selected: null };
  if (!uiVersionAtLeast(version, "0.3")) diagnostics.push(requiresVersion(tokens, "a style that follows state", "0.3", version));
  const scoped: ScopedStatement = { type: "scoped", scope: { kind: "state", state: head.state, value: head.value }, statement, span: spanFromTokens(tokens) };
  const selected = { template: SCOPED_TEMPLATE, body: { statement: scoped, diagnostics } };
  return { matches: [selected], diagnostics, selected };
}

/** A negative number is allowed only as a letter spacing (`the letter spacing is -1px`). */
function negativeValueDiagnostic(tokens: readonly Token[]): DiagnosticSpec | null {
  const at = tokens.findIndex((token) => typeof token.value === "number" && token.value < 0 && token.text.startsWith("-"));
  if (at === -1) return null;
  const words = tokens.slice(0, at).map((token) => token.text.toLowerCase());
  const spacing = words.at(-1) === "is" && words.at(-2) === "spacing" && words.at(-3) === "letter";
  if (spacing && tokens[at]!.kind === "length" && at === tokens.length - 1) return null;
  return {
    code: "KDM3005",
    message: `${tokens[at]!.text} is negative; only the letter spacing can be negative`,
    span: tokens[at]!.span,
    hint: "use a positive value, or a sentence that says the direction, such as it moves by 4px to the left",
  };
}

const NEW_UNITS: ReadonlySet<string> = new Set(["em", "vw", "vh", "dvh"]);

/** A 0.1 file may not use the kadam 0.3 units; one error per token. */
function newUnitDiagnostics(tokens: readonly Token[], context: TemplateContext): DiagnosticSpec[] {
  const version = context.languageVersion ?? LATEST_UI_LANGUAGE_VERSION;
  if (uiVersionAtLeast(version, "0.3")) return [];
  const result: DiagnosticSpec[] = [];
  for (const token of tokens) {
    if (token.kind === "length" && token.unit !== undefined && NEW_UNITS.has(token.unit)) {
      result.push(requiresVersion([token], `the unit ${token.unit}`, "0.3", version));
    } else if (token.kind === "angle") {
      result.push(requiresVersion([token], "the unit deg", "0.3", version));
    } else if (token.kind === "hex-color" && !token.text.startsWith("#")) {
      result.push(requiresVersion([token], `${token.text.slice(0, token.text.indexOf("("))}() colors`, "0.3", version));
    }
  }
  return result;
}

function collectMatches(
  tokens: readonly Token[],
  context: TemplateContext,
  templates: readonly StatementTemplate[],
): TemplateMatch[] {
  const matches: TemplateMatch[] = [];
  const version = context.languageVersion ?? LATEST_UI_LANGUAGE_VERSION;
  for (const template of templates) {
    const body = template.match(tokens, context);
    if (body === null) continue;
    if (body.statement === null && body.diagnostics.length === 0) continue;
    const since = template.since ?? "0.1";
    if (!uiVersionAtLeast(version, since)) {
      // The line is newer syntax. Claim it (so it is not reported as
      // unrecognized) and add an explicit version error. The statement is kept
      // so later checks do not add misleading follow-on errors ("no kind
      // sentence", "requires a caption"); the error still blocks all output.
      matches.push({
        template,
        body: {
          statement: body.statement,
          diagnostics: [
            ...body.diagnostics,
            requiresVersion(tokens, constructName(template, tokens), since, version),
          ],
        },
      });
      continue;
    }
    matches.push({ template, body });
  }
  return matches;
}

/** What a version diagnostic calls the construct: the property, if known. */
function constructName(template: StatementTemplate, tokens: readonly Token[]): string {
  if (template.id === "property") {
    const property = propertyNamed(tokens);
    if (property !== undefined) return `the ${property.name}`;
  }
  return template.description.toLowerCase();
}

function requiresVersion(
  tokens: readonly Token[],
  construct: string,
  since: UiLanguageVersion,
  version: UiLanguageVersion,
): DiagnosticSpec {
  return {
    code: "KDM2013",
    message: `${construct} requires kadam ${since}; this file is kadam ${version}`,
    span: spanFromTokens(tokens),
    hint: `put kadam ${since} on the first line of the file, or set "kadam": "${since}" in kadam.json`,
  };
}

function matchResponsiveLine(
  tokens: readonly Token[],
  context: TemplateContext,
  templates: readonly StatementTemplate[],
): MatchLineResult {
  const span = spanFromTokens(tokens);
  const scopeToken = tokens[1];
  const diagnostics: DiagnosticSpec[] = [];

  if (!isKeyword(scopeToken, "phones") &&
      !isKeyword(scopeToken, "tablets") &&
      !isKeyword(scopeToken, "desktops")) {
    diagnostics.push({
      code: "KDM3005",
      message: `invalid breakpoint ${JSON.stringify(scopeToken?.text ?? "")}`,
      span: scopeToken?.span ?? span,
      hint: "use phones, tablets, or desktops",
    });
    return {
      matches: [{ template: RESPONSIVE_TEMPLATE, body: { statement: null, diagnostics } }],
      diagnostics,
      selected: null,
    };
  }

  const breakpoint = scopeToken!.text.toLowerCase() as Breakpoint;
  const comma = tokens[2];
  if (comma?.kind !== "comma") {
    diagnostics.push({
      code: "KDM2010",
      message: `a comma is required after on ${breakpoint}`,
      span: comma?.span ?? scopeToken!.span,
      hint: `write: on ${breakpoint}, it is hidden`,
    });
    return {
      matches: [{ template: RESPONSIVE_TEMPLATE, body: { statement: null, diagnostics } }],
      diagnostics,
      selected: null,
    };
  }

  const innerStatement = matchScopedInner(
    tokens.slice(3),
    `on ${breakpoint}`,
    comma.span,
    context,
    templates,
    diagnostics,
  );
  if (innerStatement === null) {
    return {
      matches: [{ template: RESPONSIVE_TEMPLATE, body: { statement: null, diagnostics } }],
      diagnostics,
      selected: null,
    };
  }

  const statement: ResponsiveStatement = {
    type: "responsive",
    breakpoint,
    statement: innerStatement as StatementNode,
    span,
  };
  return {
    matches: [
      {
        template: RESPONSIVE_TEMPLATE,
        body: { statement, diagnostics },
      },
    ],
    diagnostics,
    selected: {
      template: RESPONSIVE_TEMPLATE,
      body: { statement, diagnostics },
    },
  };
}

function unrecognizedStatement(tokens: readonly Token[]): DiagnosticSpec {
  const suggestions = closestMatches(
    describeTokens(tokens),
    templateExamples(),
    3,
  );
  return {
    code: "KDM2001",
    message: `unrecognized statement ${JSON.stringify(describeTokens(tokens))}`,
    span: spanFromTokens(tokens),
    ...(suggestions.length > 0
      ? { hint: `did you mean: ${suggestions.join(" | ")}?` }
      : {}),
  };
}

function ambiguousStatement(
  tokens: readonly Token[],
  matches: readonly TemplateMatch[],
): DiagnosticSpec {
  const ids = matches.map((match) => match.template.id);
  return {
    code: "KDM9001",
    message: `${JSON.stringify(describeTokens(tokens))} matches more than one statement template: ${ids.join(", ")}`,
    span: spanFromTokens(tokens),
    hint: "this is a compiler defect, not a source error; the line was not parsed",
  };
}

/** Every canonical example, in template-table order. */
export function templateExamples(): string[] {
  const examples: string[] = [];
  for (const template of [...STATEMENT_TEMPLATES, RESPONSIVE_TEMPLATE]) {
    examples.push(...template.examples);
  }
  return examples;
}

export function isPageSettingNode(
  node: StatementNode | PageSettingNode,
): node is PageSettingNode {
  return node.type === "page-setting";
}
