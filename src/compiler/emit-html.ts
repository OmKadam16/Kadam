import { InternalCompilerError } from "./internal-error.js";
import type { IrElement, IrSize, PageIR } from "./ir.js";
import { baseCssHref, pageCssHref } from "./routes.js";

export function emitHtml(page: PageIR): string {
  const lines: string[] = [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '  <meta charset="utf-8">',
    '  <meta name="viewport" content="width=device-width, initial-scale=1">',
    `  <title>${escapeText(page.title)}</title>`,
    `  <link rel="stylesheet" href="${escapeAttribute(baseCssHref(page.basePath))}">`,
    `  <link rel="stylesheet" href="${escapeAttribute(pageCssHref(page.routeSlug, page.basePath))}">`,
    "</head>",
    "<body>",
    '  <main class="kdm-page">',
    ...page.elements.map((element) => renderElement(element, 2)),
    "  </main>",
    "</body>",
    "</html>",
  ];
  return `${lines.join("\n")}\n`;
}

function renderElement(element: IrElement, depth: number): string {
  const indent = "  ".repeat(depth);
  const classAttribute = `${element.className} ${element.kindClass}`;

  switch (element.kind) {
    case "button": {
      const text = requireText(element);
      if (element.action === null) {
        return `${indent}<button class="${classAttribute}" data-kdm-id="${element.nodeId}" type="button">${escapeText(text)}</button>`;
      }
      return `${indent}<a${linkAttributes(element)}>${escapeText(text)}</a>`;
    }
    case "link": {
      const text = requireText(element);
      if (element.action === null) {
        throw new InternalCompilerError(
          "a link reached emission without an action",
          element.nameSpan,
        );
      }
      return `${indent}<a${linkAttributes(element)}>${escapeText(text)}</a>`;
    }
    case "main heading": {
      const text = requireText(element);
      return `${indent}<h1 class="${classAttribute}" data-kdm-id="${element.nodeId}">${escapeText(text)}</h1>`;
    }
    case "section heading": {
      const text = requireText(element);
      return `${indent}<h2 class="${classAttribute}" data-kdm-id="${element.nodeId}">${escapeText(text)}</h2>`;
    }
    case "minor heading": {
      const text = requireText(element);
      return `${indent}<h3 class="${classAttribute}" data-kdm-id="${element.nodeId}">${escapeText(text)}</h3>`;
    }
    case "paragraph": {
      const text = requireText(element);
      return `${indent}<p class="${classAttribute}" data-kdm-id="${element.nodeId}">${escapeText(text)}</p>`;
    }
    case "image":
      return renderImage(element, indent, classAttribute);
    case "text field":
      return renderField(element, indent, classAttribute);
    case "divider":
      return `${indent}<hr class="${classAttribute}" data-kdm-id="${element.nodeId}">`;
    case "navigation bar":
      return renderContainer(element, "nav", indent, classAttribute);
    case "card":
    case "container":
      return renderContainer(element, "div", indent, classAttribute);
  }
}

function renderContainer(
  element: IrElement,
  tag: "div" | "nav",
  indent: string,
  classAttribute: string,
): string {
  if (element.children.length === 0) {
    return `${indent}<${tag} class="${classAttribute}" data-kdm-id="${element.nodeId}"></${tag}>`;
  }
  return [
    `${indent}<${tag} class="${classAttribute}" data-kdm-id="${element.nodeId}">`,
    ...element.children.map((child) => renderElement(child, indent.length / 2 + 1)),
    `${indent}</${tag}>`,
  ].join("\n");
}

function renderImage(
  element: IrElement,
  indent: string,
  classAttribute: string,
): string {
  const image = element.image;
  if (image === null) {
    throw new InternalCompilerError(
      "an image reached emission without content",
      element.nameSpan,
    );
  }

  const attributes = [
    `class="${classAttribute}"`,
    `data-kdm-id="${element.nodeId}"`,
    `src="${escapeAttribute(image.url)}"`,
    `alt="${escapeAttribute(image.decorative ? "" : image.alt ?? "")}"`,
  ];
  const width = htmlDimension(element.authored.width);
  const height = htmlDimension(element.authored.height);
  if (width !== null) attributes.push(`width="${width}"`);
  if (height !== null) attributes.push(`height="${height}"`);
  return `${indent}<img ${attributes.join(" ")}>`;
}

function renderField(
  element: IrElement,
  indent: string,
  classAttribute: string,
): string {
  const field = element.field;
  if (field === null) {
    throw new InternalCompilerError(
      "a text field reached emission without content",
      element.nameSpan,
    );
  }

  const inputAttributes = [
    'class="kdm-field-input"',
    `id="${field.inputId}"`,
    `type="${field.inputType}"`,
  ];
  if (field.placeholder !== null) {
    inputAttributes.push(`placeholder="${escapeAttribute(field.placeholder)}"`);
  }
  if (field.required) inputAttributes.push("required");

  return [
    `${indent}<div class="${classAttribute}" data-kdm-id="${element.nodeId}">`,
    `${indent}  <label class="kdm-field-label" for="${field.labelFor}">${escapeText(field.label)}</label>`,
    `${indent}  <input ${inputAttributes.join(" ")}>`,
    `${indent}</div>`,
  ].join("\n");
}

function linkAttributes(element: IrElement): string {
  if (element.action === null) {
    throw new InternalCompilerError(
      "an anchor reached emission without an action",
      element.nameSpan,
    );
  }

  const attributes = [
    ` class="${element.className} ${element.kindClass}"`,
    ` data-kdm-id="${element.nodeId}"`,
    ` href="${escapeAttribute(
      element.action.kind === "navigate"
        ? element.action.route
        : element.action.url,
    )}"`,
  ];
  if (element.action.kind === "external") {
    attributes.push(' target="_blank"', ' rel="noopener noreferrer"');
  }
  return attributes.join("");
}

function requireText(element: IrElement): string {
  if (element.text === null) {
    throw new InternalCompilerError(
      `${element.kind} reached emission without text`,
      element.nameSpan,
    );
  }
  return element.text.text;
}

function htmlDimension(size: IrSize | undefined): string | null {
  if (
    size === undefined ||
    size.kind !== "length" ||
    size.value.unit !== "px" ||
    !Number.isInteger(size.value.value) ||
    size.value.value < 0
  ) {
    return null;
  }
  return String(size.value.value);
}

export function escapeText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function escapeAttribute(value: string): string {
  return escapeText(value)
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
