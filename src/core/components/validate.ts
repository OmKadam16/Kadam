import type {
  ComponentKindReference,
  ComponentNode,
  ComponentParameterNode,
  ElementNode,
  PageNode,
  PropertyBindingNode,
  StatementNode,
} from "../ast/nodes.js";
import { DiagnosticBag, type Diagnostic } from "../diagnostics/diagnostic.js";
import { closestMatches } from "../parser/suggest.js";
import { isAbsoluteHttpUrl } from "../parser/matchers-interaction.js";
import { validateElementTree } from "../parser/validate.js";
import { parseColorText, parseLengthText } from "../parser/values.js";
import type { Span } from "../source/source-file.js";
import type {
  ComponentCatalog,
  ComponentRecord,
  ComponentUse,
} from "./catalog.js";
import { componentKey } from "./catalog.js";
import { collectSlots, isSlotElement, slotName } from "./slot.js";

export interface ComponentValidationOptions {
  /** Page titles available for `page` properties and navigation targets. */
  readonly pages?: readonly { readonly title: string; readonly route: string }[] | undefined;
}

/** Validate every declaration, property, variant, interpolation, and cycle. */
export function validateComponentCatalog(
  catalog: ComponentCatalog,
  options: ComponentValidationOptions = {},
): readonly Diagnostic[] {
  const diagnostics = new DiagnosticBag();
  const pageTitles = pageTitleSet(options);

  for (const name of catalog.names) {
    const record = catalog.records.get(name);
    if (record !== undefined) {
      validateDefinition(record, catalog, pageTitles, diagnostics);
    }
  }

  validateCycles(catalog, diagnostics);
  return diagnostics.sorted();
}

/** Validate component instances used directly by a page. */
export function validatePageComponents(
  page: PageNode,
  catalog: ComponentCatalog,
  options: ComponentValidationOptions = {},
): readonly Diagnostic[] {
  const diagnostics = new DiagnosticBag();
  const pageTitles = pageTitleSet(options);
  walkElements(page.elements, null, catalog, pageTitles, diagnostics);
  return diagnostics.sorted();
}

function validateDefinition(
  record: ComponentRecord,
  catalog: ComponentCatalog,
  pageTitles: ReadonlySet<string> | null,
  diagnostics: DiagnosticBag,
): void {
  const component = record.node;

  validateRoot(component, component.elements, "component", diagnostics);
  for (const variant of component.variants) {
    validateRoot(component, variant.elements, `variant ${JSON.stringify(variant.name)}`, diagnostics, variant.nameSpan);
  }

  validateSlots(component.elements, "component body", diagnostics);
  for (const variant of component.variants) {
    validateSlots(
      variant.elements,
      `variant ${JSON.stringify(variant.name)}`,
      diagnostics,
    );
  }

  for (const parameter of component.parameters) {
    validateParameterDefault(parameter, pageTitles, diagnostics);
  }

  // Structural validation is shared with pages, but component instances are
  // deliberately unresolved at this layer.
  // Version-dependent capabilities are judged again on each expanded page,
  // against that page's language version, so the definition is not narrowed here.
  validateElementTree(component.elements, diagnostics, {
    allowComponentKinds: true,
    allowSlotKinds: true,
    languageVersion: "0.3",
  });
  for (const variant of component.variants) {
    validateElementTree(variant.elements, diagnostics, {
      allowComponentKinds: true,
      allowSlotKinds: true,
      languageVersion: "0.3",
    });
  }

  walkElements(component.elements, record, catalog, pageTitles, diagnostics);
  for (const variant of component.variants) {
    walkElements(variant.elements, record, catalog, pageTitles, diagnostics);
  }
}

function validateRoot(
  component: ComponentNode,
  elements: readonly ElementNode[],
  label: string,
  diagnostics: DiagnosticBag,
  headerSpan: Span = component.nameSpan,
): void {
  if (elements.length === 1) return;
  if (elements.length === 0) {
    diagnostics.error(
      "KDM3021",
      `${label} must contain exactly one root element`,
      headerSpan,
      "add one root element or wrap the content in a container",
    );
    return;
  }
  diagnostics.error(
    "KDM3021",
    `${label} must contain exactly one root element; found ${elements.length}`,
    elements[1]!.nameSpan,
    "wrap the roots in a container, card, or navigation bar",
  );
}

function validateParameterDefault(
  parameter: ComponentParameterNode,
  pageTitles: ReadonlySet<string> | null,
  diagnostics: DiagnosticBag,
): void {
  if (parameter.defaultValue === null) return;
  const span = parameter.defaultValueSpan ?? parameter.nameSpan;
  if (parameter.defaultValue.includes("{$")) {
    diagnostics.error(
      "KDM3031",
      `default for parameter ${JSON.stringify(parameter.name)} cannot contain a placeholder`,
      span,
      "defaults are static strings",
    );
    return;
  }
  if (parameter.valueType === "page" && pageTitles !== null) {
    if (!pageTitles.has(parameter.defaultValue)) {
      diagnostics.error(
        "KDM3026",
        `default page ${JSON.stringify(parameter.defaultValue)} for ${JSON.stringify(parameter.name)} does not exist`,
        span,
        "use the exact title of a declared page",
      );
    }
  }
  if (parameter.valueType === "url" && !isAbsoluteHttpUrl(parameter.defaultValue)) {
    diagnostics.error(
      "KDM3026",
      `default url ${JSON.stringify(parameter.defaultValue)} for ${JSON.stringify(parameter.name)} is not an absolute http or https URL`,
      span,
      "use an absolute URL with a host, such as https://example.com",
    );
  }
  if (parameter.valueType === "image" && !isProjectImagePath(parameter.defaultValue)) {
    diagnostics.error(
      "KDM3026",
      `default image ${JSON.stringify(parameter.defaultValue)} for ${JSON.stringify(parameter.name)} is not a project-relative image path`,
      span,
      "use a path such as assets/photo.png without .. or a URL scheme",
    );
  }
  if (parameter.valueType === "length" && parseLengthText(parameter.defaultValue) === null) {
    diagnostics.error(
      "KDM3026",
      `default length ${JSON.stringify(parameter.defaultValue)} for ${JSON.stringify(parameter.name)} is not a length`,
      span,
      "use px, rem, or 0",
    );
  }
  if (parameter.valueType === "color" && parseColorText(parameter.defaultValue) === null) {
    diagnostics.error(
      "KDM3026",
      `default color ${JSON.stringify(parameter.defaultValue)} for ${JSON.stringify(parameter.name)} is not a color`,
      span,
      "use a CSS named color or a #RGB/#RRGGBB hex literal",
    );
  }
}

function walkElements(
  elements: readonly ElementNode[],
  sourceRecord: ComponentRecord | null,
  catalog: ComponentCatalog,
  pageTitles: ReadonlySet<string> | null,
  diagnostics: DiagnosticBag,
): void {
  for (const element of elements) {
    if (element.kind?.reference.type === "component-kind") {
      validateInstance(element, sourceRecord, catalog, pageTitles, diagnostics);
      if (element.children.length > 0) {
        validateInstanceContent(
          element,
          sourceRecord,
          catalog,
          pageTitles,
          diagnostics,
        );
      }
      if (element.statements.length > 0) {
        diagnostics.error(
          "KDM3030",
          "a component instance cannot contain appearance or event statements",
          element.statements[0]!.span,
          "move styling and interactions into the component or wrap the instance",
        );
      }
      continue;
    }

    if (element.properties.length > 0) {
      diagnostics.error(
        "KDM3030",
        "property bindings require a component kind",
        element.properties[0]!.span,
        "declare the element as a component instance first",
      );
    }

    validateStatements(element.statements, sourceRecord, pageTitles, diagnostics);
    walkElements(element.children, sourceRecord, catalog, pageTitles, diagnostics);
  }
}

function validateInstance(
  element: ElementNode,
  sourceRecord: ComponentRecord | null,
  catalog: ComponentCatalog,
  pageTitles: ReadonlySet<string> | null,
  diagnostics: DiagnosticBag,
): void {
  if (element.kind?.reference.type !== "component-kind") return;
  const reference = element.kind.reference;
  const target = resolveComponentReference(reference, catalog, diagnostics);
  if (target === null) return;

  const selectedVariant = element.kind.variant;
  if (
    selectedVariant !== null &&
    selectedVariant !== undefined &&
    !target.variants.has(selectedVariant.name)
  ) {
    const names = [...target.variants.keys()].sort(compareText);
    diagnostics.error(
      "KDM3029",
      `unknown variant ${JSON.stringify(selectedVariant.name)} on component ${JSON.stringify(target.name)}`,
      selectedVariant.nameSpan,
      names.length > 0
        ? `available variants: ${names.join(", ")}`
        : "this component has no named variants",
    );
  }

  const seen = new Map<string, Span>();
  for (const binding of element.properties) {
    const parameter = target.parameters.get(binding.name);
    if (parameter === undefined) {
      const names = [...target.parameters.keys()].sort(compareText);
      const suggestions = closestMatches(binding.name, names, 3);
      diagnostics.error(
        "KDM3024",
        `unknown property ${JSON.stringify(binding.name)} on component ${JSON.stringify(target.name)}`,
        binding.nameSpan,
        suggestions.length > 0
          ? `did you mean: ${suggestions.join(", ")}?`
          : `available properties: ${names.join(", ") || "none"}`,
      );
      continue;
    }

    const previous = seen.get(binding.name);
    if (previous !== undefined) {
      diagnostics.error(
        "KDM3025",
        `duplicate property ${JSON.stringify(binding.name)}`,
        binding.span,
        "each component property may be bound once",
        [{ span: previous, message: "first bound here" }],
      );
      continue;
    }
    seen.set(binding.name, binding.span);
    validateBinding(binding, parameter, sourceRecord, pageTitles, diagnostics);
  }

  const missing = [...target.parameters.values()].filter(
    (parameter) => parameter.defaultValue === null && !seen.has(parameter.name),
  );
  for (const parameter of missing) {
    diagnostics.error(
      "KDM3023",
      `missing required property ${JSON.stringify(parameter.name)} on component ${JSON.stringify(target.name)}`,
      reference.span,
      `add: with a ${parameter.name} of "..."`,
      [{ span: parameter.nameSpan, message: "property declared here" }],
    );
  }
}

function validateBinding(
  binding: PropertyBindingNode,
  parameter: ComponentParameterNode,
  sourceRecord: ComponentRecord | null,
  pageTitles: ReadonlySet<string> | null,
  diagnostics: DiagnosticBag,
): void {
  const expected = parameter.valueType;
  const scan = scanPlaceholders(binding.value);
  const span = binding.valueSpan;

  // A page file has no component scope: its binding values are literal
  // strings. Only component bodies interpolate their own bindings.
  if (sourceRecord === null) {
    if (expected === "page" && pageTitles !== null && !pageTitles.has(binding.value)) {
      diagnostics.error(
        "KDM3026",
        `page ${JSON.stringify(binding.value)} does not exist`,
        span,
        "use the exact title of a declared page",
        [{ span: parameter.nameSpan, message: "page property declared here" }],
      );
    }
    if (expected === "url" && !isAbsoluteHttpUrl(binding.value)) {
      diagnostics.error(
        "KDM3026",
        `url ${JSON.stringify(binding.value)} is not an absolute http or https URL`,
        span,
        "use an absolute URL with a host, such as https://example.com",
        [{ span: parameter.nameSpan, message: "url property declared here" }],
      );
    }
    if (expected === "image" && !isProjectImagePath(binding.value)) {
      diagnostics.error(
        "KDM3026",
        `image ${JSON.stringify(binding.value)} is not a project-relative image path`,
        span,
        "use a path such as assets/photo.png without .. or a URL scheme",
        [{ span: parameter.nameSpan, message: "image property declared here" }],
      );
    }
    if (expected === "length" && parseLengthText(binding.value) === null) {
      diagnostics.error(
        "KDM3026",
        `length ${JSON.stringify(binding.value)} is not a length`,
        span,
        "use px, rem, or 0",
        [{ span: parameter.nameSpan, message: "length property declared here" }],
      );
    }
    if (expected === "color" && parseColorText(binding.value) === null) {
      diagnostics.error(
        "KDM3026",
        `color ${JSON.stringify(binding.value)} is not a color`,
        span,
        "use a CSS named color or a #RGB/#RRGGBB hex literal",
        [{ span: parameter.nameSpan, message: "color property declared here" }],
      );
    }
    return;
  }

  if (scan.malformed) {
    diagnostics.error(
      "KDM3027",
      "malformed component interpolation; expected {$name}",
      span,
      "placeholders use a lower-camel parameter name inside {$...}",
    );
    return;
  }

  if (expected === "page") {
    if (scan.names.length > 0) {
      if (scan.names.length !== 1 || binding.value.trim() !== `{$${scan.names[0]!}}`) {
        diagnostics.error(
          "KDM3026",
          "a page property must be exactly one page title or one page parameter",
          span,
          "use a literal page title or {$pageName}",
        );
        return;
      }
      const source = sourceRecord.parameters.get(scan.names[0]!);
      if (source === undefined) {
        diagnostics.error(
          "KDM3027",
          `unknown interpolation parameter ${JSON.stringify(scan.names[0])}`,
          span,
          "use a parameter declared by the enclosing component",
        );
      } else if (source.valueType !== "page") {
        diagnostics.error(
          "KDM3026",
          `parameter ${JSON.stringify(source.name)} is ${source.valueType}, but this page property needs page`,
          span,
          "bind a page parameter or a literal page title",
        );
      }
      return;
    }

    if (pageTitles !== null && !pageTitles.has(binding.value)) {
      diagnostics.error(
        "KDM3026",
        `page ${JSON.stringify(binding.value)} does not exist`,
        span,
        "use the exact title of a declared page",
        [{ span: parameter.nameSpan, message: "page property declared here" }],
      );
    }
    return;
  }

  if (expected === "url") {
    if (scan.names.length > 0) {
      if (scan.names.length !== 1 || binding.value.trim() !== `{$${scan.names[0]!}}`) {
        diagnostics.error(
          "KDM3026",
          "a url property must be exactly one absolute URL or one url parameter",
          span,
          "use a literal URL or {$urlName}",
        );
        return;
      }
      const source = sourceRecord.parameters.get(scan.names[0]!);
      if (source === undefined) {
        diagnostics.error(
          "KDM3027",
          `unknown interpolation parameter ${JSON.stringify(scan.names[0])}`,
          span,
          "use a parameter declared by the enclosing component",
        );
      } else if (source.valueType !== "url") {
        diagnostics.error(
          "KDM3026",
          `parameter ${JSON.stringify(source.name)} is ${source.valueType}, but this url property needs url`,
          span,
          "bind a url parameter or a literal URL",
        );
      }
      return;
    }

    if (!isAbsoluteHttpUrl(binding.value)) {
      diagnostics.error(
        "KDM3026",
        `url ${JSON.stringify(binding.value)} is not an absolute http or https URL`,
        span,
        "use an absolute URL with a host, such as https://example.com",
        [{ span: parameter.nameSpan, message: "url property declared here" }],
      );
    }
    return;
  }

  if (expected === "image") {
    if (scan.names.length > 0) {
      if (scan.names.length !== 1 || binding.value.trim() !== `{$${scan.names[0]!}}`) {
        diagnostics.error(
          "KDM3026",
          "an image property must be exactly one path or one image parameter",
          span,
          "use a literal path or {$imageName}",
        );
        return;
      }
      const source = sourceRecord.parameters.get(scan.names[0]!);
      if (source === undefined) {
        diagnostics.error(
          "KDM3027",
          `unknown interpolation parameter ${JSON.stringify(scan.names[0])}`,
          span,
          "use a parameter declared by the enclosing component",
        );
      } else if (source.valueType !== "image") {
        diagnostics.error(
          "KDM3026",
          `parameter ${JSON.stringify(source.name)} is ${source.valueType}, but this image property needs image`,
          span,
          "bind an image parameter or a literal path",
        );
      }
      return;
    }

    if (!isProjectImagePath(binding.value)) {
      diagnostics.error(
        "KDM3026",
        `image ${JSON.stringify(binding.value)} is not a project-relative image path`,
        span,
        "use a path such as assets/photo.png without .. or a URL scheme",
        [{ span: parameter.nameSpan, message: "image property declared here" }],
      );
    }
    return;
  }

  if (expected === "length") {
    if (scan.names.length > 0) {
      if (scan.names.length !== 1 || binding.value.trim() !== `{$${scan.names[0]!}}`) {
        diagnostics.error(
          "KDM3026",
          "a length property must be exactly one length or one length parameter",
          span,
          'use a literal length or "{$lengthName}"',
        );
        return;
      }
      const source = sourceRecord.parameters.get(scan.names[0]!);
      if (source === undefined) {
        diagnostics.error(
          "KDM3027",
          `unknown interpolation parameter ${JSON.stringify(scan.names[0])}`,
          span,
          "use a parameter declared by the enclosing component",
        );
      } else if (source.valueType !== "length") {
        diagnostics.error(
          "KDM3026",
          `parameter ${JSON.stringify(source.name)} is ${source.valueType}, but this length property needs length`,
          span,
          "bind a length parameter or a literal length",
        );
      }
      return;
    }

    if (parseLengthText(binding.value) === null) {
      diagnostics.error(
        "KDM3026",
        `length ${JSON.stringify(binding.value)} is not a length`,
        span,
        "use px, rem, or 0",
        [{ span: parameter.nameSpan, message: "length property declared here" }],
      );
    }
    return;
  }

  if (expected === "color") {
    if (scan.names.length > 0) {
      if (scan.names.length !== 1 || binding.value.trim() !== `{$${scan.names[0]!}}`) {
        diagnostics.error(
          "KDM3026",
          "a color property must be exactly one color or one color parameter",
          span,
          'use a literal color or "{$colorName}"',
        );
        return;
      }
      const source = sourceRecord.parameters.get(scan.names[0]!);
      if (source === undefined) {
        diagnostics.error(
          "KDM3027",
          `unknown interpolation parameter ${JSON.stringify(scan.names[0])}`,
          span,
          "use a parameter declared by the enclosing component",
        );
      } else if (source.valueType !== "color") {
        diagnostics.error(
          "KDM3026",
          `parameter ${JSON.stringify(source.name)} is ${source.valueType}, but this color property needs color`,
          span,
          "bind a color parameter or a literal color",
        );
      }
      return;
    }

    if (parseColorText(binding.value) === null) {
      diagnostics.error(
        "KDM3026",
        `color ${JSON.stringify(binding.value)} is not a color`,
        span,
        "use a CSS named color or a #RGB/#RRGGBB hex literal",
        [{ span: parameter.nameSpan, message: "color property declared here" }],
      );
    }
    return;
  }

  for (const name of scan.names) {
    const source = sourceRecord.parameters.get(name);
    if (source === undefined) {
      diagnostics.error(
        "KDM3027",
        `unknown interpolation parameter ${JSON.stringify(name)}`,
        span,
        "use a parameter declared by the enclosing component",
      );
    } else if (source.valueType !== "text") {
      diagnostics.error(
        "KDM3027",
        `parameter ${JSON.stringify(source.name)} is ${source.valueType}, but this property needs text`,
        span,
        "bind a text parameter or a literal string",
      );
    }
  }
}

function validateStatements(
  statements: readonly StatementNode[],
  sourceRecord: ComponentRecord | null,
  pageTitles: ReadonlySet<string> | null,
  diagnostics: DiagnosticBag,
): void {
  for (const statement of statements) {
    switch (statement.type) {
      case "text":
        validateTextValue(statement.value, statement.valueSpan, sourceRecord, diagnostics);
        break;
      case "field-label":
      case "field-placeholder":
      case "image-description":
        validateTextValue(statement.value, statement.valueSpan, sourceRecord, diagnostics);
        break;
      case "click":
        if (statement.action.type === "navigate") {
          validatePageValue(
            statement.action.pageTitle,
            statement.action.pageTitleSpan,
            sourceRecord,
            pageTitles,
            diagnostics,
          );
        } else if (statement.action.type === "external") {
          validateUrlValue(
            statement.action.url,
            statement.action.urlSpan,
            sourceRecord,
            diagnostics,
          );
        }
        break;
      case "image-source":
        validateImageValue(statement.value, statement.valueSpan, sourceRecord, diagnostics);
        break;
      case "background":
        if (statement.mode === "solid") {
          validateColorReference(statement.color, sourceRecord, diagnostics);
        } else if (statement.mode === "gradient") {
          validateColorReference(statement.from, sourceRecord, diagnostics);
          validateColorReference(statement.to, sourceRecord, diagnostics);
        }
        break;
      case "spacing":
        validateLengthReference(statement.value, sourceRecord, diagnostics);
        break;
      case "layout":
        if (statement.property === "gap") {
          validateLengthReference(statement.value, sourceRecord, diagnostics);
        }
        break;
      case "size":
        validateLengthReference(statement.width, sourceRecord, diagnostics);
        validateLengthReference(statement.height, sourceRecord, diagnostics);
        break;
      case "typography":
        if (statement.property === "size") {
          validateLengthReference(statement.value, sourceRecord, diagnostics);
        } else if (statement.property === "color") {
          validateColorReference(statement.value, sourceRecord, diagnostics);
        } else if (statement.property === "reference") {
          validateTypographyReference(statement.value, sourceRecord, diagnostics);
        }
        break;
      case "border":
        if (statement.mode === "solid") {
          validateLengthReference(statement.width, sourceRecord, diagnostics);
          validateColorReference(statement.color, sourceRecord, diagnostics);
        }
        break;
      case "corners":
        if (statement.mode === "custom") {
          validateLengthReference(statement.radius, sourceRecord, diagnostics);
        }
        break;
      case "hover":
        if (statement.effect.type === "lift") {
          validateLengthReference(statement.effect.distance, sourceRecord, diagnostics);
        } else if (
          statement.effect.type === "background" ||
          statement.effect.type === "text" ||
          statement.effect.type === "border"
        ) {
          validateColorReference(statement.effect.color, sourceRecord, diagnostics);
        }
        break;
      case "responsive":
      case "scoped":
        validateStatements([statement.statement], sourceRecord, pageTitles, diagnostics);
        break;
      default:
        break;
    }
  }
}

function validateTextValue(
  value: string,
  span: Span,
  sourceRecord: ComponentRecord | null,
  diagnostics: DiagnosticBag,
): void {
  // Page-owned text is literal, even when it contains brace text that would
  // look like interpolation inside a component body.
  if (sourceRecord === null) return;

  const scan = scanPlaceholders(value);
  if (scan.malformed) {
    diagnostics.error(
      "KDM3027",
      "malformed component interpolation; expected {$name}",
      span,
      "placeholders use a lower-camel parameter name inside {$...}",
    );
    return;
  }
  for (const name of scan.names) {
    const source = sourceRecord.parameters.get(name);
    if (source === undefined) {
      diagnostics.error(
        "KDM3027",
        `unknown interpolation parameter ${JSON.stringify(name)}`,
        span,
        "use a parameter declared by the enclosing component",
      );
    } else if (source.valueType !== "text") {
      diagnostics.error(
        "KDM3027",
        `parameter ${JSON.stringify(source.name)} is ${source.valueType}, but this text slot needs text`,
        span,
        "use a text parameter or a literal string",
      );
    }
  }
}

function validatePageValue(
  value: string,
  span: Span,
  sourceRecord: ComponentRecord | null,
  pageTitles: ReadonlySet<string> | null,
  diagnostics: DiagnosticBag,
): void {
  // Page-owned navigation targets are literal titles, not interpolation
  // strings. A page title that happens to contain braces remains usable.
  if (sourceRecord === null) {
    if (pageTitles !== null && !pageTitles.has(value)) {
      diagnostics.error(
        "KDM3007",
        `unknown page reference ${JSON.stringify(value)}`,
        span,
        "use the exact title of a page in the project",
      );
    }
    return;
  }

  const scan = scanPlaceholders(value);
  if (scan.malformed) {
    diagnostics.error(
      "KDM3027",
      "malformed component interpolation; expected {$name}",
      span,
      "placeholders use a lower-camel parameter name inside {$...}",
    );
    return;
  }
  if (scan.names.length > 0) {
    if (scan.names.length !== 1 || value.trim() !== `{$${scan.names[0]!}}`) {
      diagnostics.error(
        "KDM3027",
        "a page target must be exactly one page title or one page parameter",
        span,
        "use a literal page title or {$pageName}",
      );
      return;
    }
    const source = sourceRecord.parameters.get(scan.names[0]!);
    if (source === undefined) {
      diagnostics.error(
        "KDM3027",
        `unknown interpolation parameter ${JSON.stringify(scan.names[0])}`,
        span,
        "use a parameter declared by the enclosing component",
      );
    } else if (source.valueType !== "page") {
      diagnostics.error(
        "KDM3027",
        `parameter ${JSON.stringify(source.name)} is ${source.valueType}, but a page target needs page`,
        span,
        "use a page parameter or a literal page title",
      );
    }
    return;
  }
  if (pageTitles !== null && !pageTitles.has(value)) {
    diagnostics.error(
      "KDM3007",
      `unknown page reference ${JSON.stringify(value)}`,
      span,
      "use the exact title of a page in the project",
    );
  }
}

function validateUrlValue(
  value: string,
  span: Span,
  sourceRecord: ComponentRecord | null,
  diagnostics: DiagnosticBag,
): void {
  if (sourceRecord === null) {
    if (value.includes("{$")) {
      diagnostics.error(
        "KDM3005",
        "external URLs on a page are literal and cannot contain interpolation",
        span,
        "bind a url property on a component, or write an absolute URL",
      );
    }
    return;
  }

  const scan = scanPlaceholders(value);
  if (scan.malformed) {
    diagnostics.error(
      "KDM3027",
      "malformed component interpolation; expected {$name}",
      span,
      "placeholders use a lower-camel parameter name inside {$...}",
    );
    return;
  }
  if (scan.names.length === 0) return;
  if (scan.names.length !== 1 || value.trim() !== `{$${scan.names[0]!}}`) {
    diagnostics.error(
      "KDM3027",
      "a url target must be exactly one URL or one url parameter",
      span,
      "use a literal URL or {$urlName}",
    );
    return;
  }
  const source = sourceRecord.parameters.get(scan.names[0]!);
  if (source === undefined) {
    diagnostics.error(
      "KDM3027",
      `unknown interpolation parameter ${JSON.stringify(scan.names[0])}`,
      span,
      "use a parameter declared by the enclosing component",
    );
  } else if (source.valueType !== "url") {
    diagnostics.error(
      "KDM3027",
      `parameter ${JSON.stringify(source.name)} is ${source.valueType}, but a url target needs url`,
      span,
      "use a url parameter or a literal URL",
    );
  }
}

function validateImageValue(
  value: string,
  span: Span,
  sourceRecord: ComponentRecord | null,
  diagnostics: DiagnosticBag,
): void {
  // Page-owned image paths are literal and checked with the other semantics.
  if (sourceRecord === null) return;

  const scan = scanPlaceholders(value);
  if (scan.malformed) {
    diagnostics.error(
      "KDM3027",
      "malformed component interpolation; expected {$name}",
      span,
      "placeholders use a lower-camel parameter name inside {$...}",
    );
    return;
  }
  if (scan.names.length === 0) return;
  if (scan.names.length !== 1 || value.trim() !== `{$${scan.names[0]!}}`) {
    diagnostics.error(
      "KDM3027",
      "an image source must be exactly one path or one image parameter",
      span,
      "use a literal path or {$imageName}",
    );
    return;
  }
  const source = sourceRecord.parameters.get(scan.names[0]!);
  if (source === undefined) {
    diagnostics.error(
      "KDM3027",
      `unknown interpolation parameter ${JSON.stringify(scan.names[0])}`,
      span,
      "use a parameter declared by the enclosing component",
    );
  } else if (source.valueType !== "image") {
    diagnostics.error(
      "KDM3027",
      `parameter ${JSON.stringify(source.name)} is ${source.valueType}, but an image source needs image`,
      span,
      "use an image parameter or a literal path",
    );
  }
}

function validateLengthReference(
  value: { readonly reference?: { readonly name: string; readonly span: Span } | undefined } | undefined,
  sourceRecord: ComponentRecord | null,
  diagnostics: DiagnosticBag,
): void {
  const reference = value?.reference;
  if (reference === undefined || sourceRecord === null) return;
  const source = sourceRecord.parameters.get(reference.name);
  if (source === undefined) {
    diagnostics.error(
      "KDM3027",
      `unknown interpolation parameter ${JSON.stringify(reference.name)}`,
      reference.span,
      "use a parameter declared by the enclosing component",
    );
  } else if (source.valueType !== "length") {
    diagnostics.error(
      "KDM3027",
      `parameter ${JSON.stringify(source.name)} is ${source.valueType}, but a length slot needs length`,
      reference.span,
      "use a length parameter or a literal length",
    );
  }
}

function validateTypographyReference(
  reference: { readonly name: string; readonly span: Span },
  sourceRecord: ComponentRecord | null,
  diagnostics: DiagnosticBag,
): void {
  if (sourceRecord === null) return;
  const source = sourceRecord.parameters.get(reference.name);
  if (source === undefined) {
    diagnostics.error(
      "KDM3027",
      `unknown interpolation parameter ${JSON.stringify(reference.name)}`,
      reference.span,
      "use a parameter declared by the enclosing component",
    );
  } else if (source.valueType !== "length" && source.valueType !== "color") {
    diagnostics.error(
      "KDM3027",
      `parameter ${JSON.stringify(source.name)} is ${source.valueType}, but a typography value needs length or color`,
      reference.span,
      "bind a length or color parameter",
    );
  }
}

function validateColorReference(
  value: { readonly reference?: { readonly name: string; readonly span: Span } | undefined } | undefined,
  sourceRecord: ComponentRecord | null,
  diagnostics: DiagnosticBag,
): void {
  const reference = value?.reference;
  if (reference === undefined || sourceRecord === null) return;
  const source = sourceRecord.parameters.get(reference.name);
  if (source === undefined) {
    diagnostics.error(
      "KDM3027",
      `unknown interpolation parameter ${JSON.stringify(reference.name)}`,
      reference.span,
      "use a parameter declared by the enclosing component",
    );
  } else if (source.valueType !== "color") {
    diagnostics.error(
      "KDM3027",
      `parameter ${JSON.stringify(source.name)} is ${source.valueType}, but a color slot needs color`,
      reference.span,
      "use a color parameter or a literal color",
    );
  }
}

function isProjectImagePath(value: string): boolean {
  if (value.length === 0) return false;
  const normalized = value.replaceAll("\\", "/");
  const segments = normalized.split("/");
  return (
    !normalized.startsWith("/") &&
    !/^[A-Za-z]:/.test(normalized) &&
    !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(normalized) &&
    !value.includes("\\") &&
    !normalized.includes("?") &&
    !normalized.includes("#") &&
    !segments.includes("..") &&
    /\.(?:png|jpe?g|webp|avif|gif|svg)$/i.test(normalized)
  );
}

function scanPlaceholders(value: string): { names: string[]; malformed: boolean } {
  const pattern = /\{\$([a-z][A-Za-z0-9]{0,63})\}/g;
  const names: string[] = [];
  for (const match of value.matchAll(pattern)) names.push(match[1]!);
  const stripped = value.replace(pattern, "");
  return { names, malformed: stripped.includes("{$") };
}

function validateCycles(catalog: ComponentCatalog, diagnostics: DiagnosticBag): void {
  const state = new Map<string, 0 | 1 | 2>();
  const stack: string[] = [];

  const visit = (name: string): void => {
    state.set(name, 1);
    stack.push(name);
    const record = catalog.records.get(name);
    for (const use of record?.references ?? []) {
      if (!catalog.records.has(use.key)) continue;
      const next = state.get(use.key) ?? 0;
      if (next === 1) {
        const start = stack.indexOf(use.key);
        const cycle = [...stack.slice(start), use.key];
        diagnostics.error(
          "KDM3028",
          `circular component reference: ${cycle.join(" -> ")}`,
          use.nameSpan,
          "remove one component instance from the cycle",
          cycle.slice(0, -1).map((component) => {
            const target = catalog.records.get(component)!;
            return { span: target.node.nameSpan, message: `component ${component} declared here` };
          }),
        );
      } else if (next === 0) {
        visit(use.key);
      }
    }
    stack.pop();
    state.set(name, 2);
  };

  for (const name of catalog.names) {
    if ((state.get(name) ?? 0) === 0) visit(name);
  }
}

function resolveComponentReference(
  reference: ComponentKindReference,
  catalog: ComponentCatalog,
  diagnostics: DiagnosticBag,
): ComponentRecord | null {
  const target = catalog.records.get(
    componentKey(reference.namespace, reference.name),
  );
  if (target !== undefined) return target;

  if (reference.namespace === null) {
    const names = [...catalog.records.values()]
      .filter((record) => record.namespace === null)
      .map((record) => record.name);
    const suggestions = closestMatches(reference.name, names, 3);
    diagnostics.error(
      "KDM3022",
      `unknown component ${JSON.stringify(reference.name)}`,
      reference.span,
      suggestions.length > 0
        ? `did you mean: ${suggestions.join(", ")}?`
        : "declare the component in kadam.json and its own .kdm file",
    );
    return null;
  }

  if (!catalog.namespaces.has(reference.namespace)) {
    const namespaces = [...catalog.namespaces].sort(compareText);
    diagnostics.error(
      "KDM3036",
      `unknown component namespace ${JSON.stringify(reference.namespace)}`,
      reference.namespaceSpan ?? reference.span,
      namespaces.length > 0
        ? `declared namespaces: ${namespaces.join(", ")}`
        : "add a component entry with a namespace to kadam.json",
    );
    return null;
  }

  const projectRecord = catalog.records.get(reference.name);
  if (projectRecord !== undefined && projectRecord.namespace === null) {
    diagnostics.error(
      "KDM3037",
      `component ${JSON.stringify(reference.name)} belongs to the project namespace`,
      reference.namespaceSpan ?? reference.span,
      `remove "from ${reference.namespace}" or declare a library component with that name`,
    );
    return null;
  }

  const names = [...catalog.records.values()]
    .filter((record) => record.namespace === reference.namespace)
    .map((record) => record.name);
  const suggestions = closestMatches(reference.name, names, 3);
  diagnostics.error(
    "KDM3036",
    `namespace ${JSON.stringify(reference.namespace)} has no component ${JSON.stringify(reference.name)}`,
    reference.span,
    suggestions.length > 0
      ? `did you mean: ${suggestions.join(", ")}?`
      : `available components: ${names.join(", ") || "none"}`,
  );
  return null;
}

function bodyOfInstance(
  element: ElementNode,
  catalog: ComponentCatalog,
): readonly ElementNode[] | null {
  const reference = element.kind?.reference;
  if (reference?.type !== "component-kind") return null;
  const target = catalog.records.get(
    componentKey(reference.namespace, reference.name),
  );
  if (target === undefined) return null;
  const variantName = element.kind?.variant?.name ?? null;
  if (variantName === null) return target.node.elements;
  return target.variants.get(variantName)?.elements ?? null;
}

/**
 * Instance children are either plain content for the unnamed slot or named
 * slot groups. A slot group is caller markup, but it never emits an element.
 */
function validateInstanceContent(
  element: ElementNode,
  sourceRecord: ComponentRecord | null,
  catalog: ComponentCatalog,
  pageTitles: ReadonlySet<string> | null,
  diagnostics: DiagnosticBag,
): void {
  const body = bodyOfInstance(element, catalog);
  if (body === null) return; // unknown component or variant already reported
  const slots = collectSlots(body);

  if (slots.total === 0) {
    diagnostics.error(
      "KDM3030",
      "this component does not accept child elements",
      element.children[0]!.nameSpan,
      "add a content slot to the component or remove the children",
    );
    return;
  }

  const plain: ElementNode[] = [];
  const filled = new Map<string, ElementNode>();

  for (const child of element.children) {
    if (!isSlotElement(child)) {
      plain.push(child);
      continue;
    }

    const name = slotName(child);
    if (name === null) {
      diagnostics.error(
        "KDM3034",
        "use plain child elements for the unnamed content slot",
        child.nameSpan,
        "remove the a slot kind from the supplied content",
      );
      continue;
    }
    if (!slots.named.has(name)) {
      const available = [...slots.named.keys()].sort(compareText);
      diagnostics.error(
        "KDM3034",
        `this component has no content slot named ${JSON.stringify(name)}`,
        child.kind?.reference.span ?? child.nameSpan,
        available.length > 0
          ? `available slots: ${available.join(", ")}`
          : "declare a named slot in the component body",
      );
      continue;
    }
    const previous = filled.get(name);
    if (previous !== undefined) {
      diagnostics.error(
        "KDM3034",
        `duplicate content for slot ${JSON.stringify(name)}`,
        child.nameSpan,
        "each named slot accepts one group of children",
        [{ span: previous.nameSpan, message: "first supplied here" }],
      );
      continue;
    }
    filled.set(name, child);

    if (child.statements.length > 0 || child.properties.length > 0) {
      diagnostics.error(
        "KDM3034",
        "a slot group cannot carry statements or properties",
        child.statements[0]?.span ?? child.properties[0]!.span,
        "style the supplied elements instead",
      );
    }
  }

  if (plain.length > 0 && !slots.hasUnnamed) {
    diagnostics.error(
      "KDM3030",
      "this component has no unnamed content slot",
      plain[0]!.nameSpan,
      "pass children inside a named slot group",
    );
  }

  walkElements(plain, sourceRecord, catalog, pageTitles, diagnostics);
  for (const child of filled.values()) {
    walkElements(child.children, sourceRecord, catalog, pageTitles, diagnostics);
  }
}

/**
 * A body or variant may declare one slot. The slot is a placeholder, so it
 * carries no statements or size of its own; its children are fallback content.
 */function validateSlots(
  elements: readonly ElementNode[],
  label: string,
  diagnostics: DiagnosticBag,
): void {
  const named = new Map<string, Span>();
  let unnamedFirst: ElementNode | null = null;
  let reportedNested = false;

  const walk = (
    list: readonly ElementNode[],
    insideSlot: ElementNode | null,
  ): void => {
    for (const element of list) {
      if (!isSlotElement(element)) {
        walk(element.children, insideSlot);
        continue;
      }

      const name = slotName(element);

      if (insideSlot !== null) {
        if (!reportedNested) {
          reportedNested = true;
          diagnostics.error(
            "KDM3033",
            "a content slot cannot contain another content slot",
            element.nameSpan,
            "move the inner slot out of the fallback content",
          );
        }
      } else {
        if (list === elements && list[0] === element) {
          diagnostics.error(
            "KDM3033",
            `a content slot cannot be the root of the ${label}`,
            element.nameSpan,
            "wrap the slot in a container, card, or navigation bar",
          );
        }

        if (name === null) {
          if (unnamedFirst !== null) {
            diagnostics.error(
              "KDM3033",
              `the ${label} declares more than one unnamed content slot`,
              element.nameSpan,
              "keep one unnamed content slot per body or variant",
              [
                {
                  span: unnamedFirst.nameSpan,
                  message: "first slot declared here",
                },
              ],
            );
          } else {
            unnamedFirst = element;
          }
        } else {
          const previous = named.get(name);
          if (previous !== undefined) {
            diagnostics.error(
              "KDM3033",
              `the ${label} declares more than one content slot named ${JSON.stringify(name)}`,
              element.nameSpan,
              "name each slot once per body or variant",
              [{ span: previous, message: "first slot declared here" }],
            );
          } else {
            named.set(name, element.nameSpan);
          }
        }
      }

      if (element.statements.length > 0) {
        diagnostics.error(
          "KDM3033",
          "a content slot cannot carry statements or a size",
          element.statements[0]!.span,
          "style the surrounding container instead",
        );
      }

      walk(element.children, element);
    }
  };

  walk(elements, null);
}

function pageTitleSet(
  options: ComponentValidationOptions,
): ReadonlySet<string> | null {
  if (options.pages === undefined) return null;
  return new Set(options.pages.map((page) => page.title));
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}