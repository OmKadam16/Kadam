/** JSON contract shared by the Studio Node host and browser shell. */

export type SourceKind = "page" | "component";

export type NewlineStyle = "\n" | "\r\n";

export type StudioSeverity = "error" | "warning" | "info";

export interface StudioDiagnostic {
  readonly code: string;
  readonly severity: StudioSeverity;
  readonly message: string;
  /** Project-relative path. */
  readonly file: string;
  readonly from: number;
  readonly to: number;
  readonly line: number;
  readonly column: number;
  readonly hint?: string;
}

export interface StudioRoute {
  readonly route: string;
  readonly title: string;
}

export interface StudioStatus {
  readonly buildId: number;
  readonly phase: "success" | "failure";
  readonly served: "current" | "last-success" | "none";
  readonly compileMs: number;
  readonly routes: readonly StudioRoute[];
}

export interface TreeEntry {
  readonly path: string;
  readonly label: string;
  readonly kind: SourceKind;
  readonly route?: string;
}

export interface SourceDocumentPayload {
  readonly path: string;
  readonly text: string;
  readonly version: number;
  readonly kind: SourceKind;
  readonly dirty: boolean;
  readonly newline: NewlineStyle;
  readonly bom: boolean;
}

export interface SpanPayload {
  readonly from: number;
  readonly to: number;
  readonly line: number;
  readonly column: number;
  readonly endLine: number;
  readonly endColumn: number;
}

export type OutlineNodeType = "page" | "component" | "variant" | "element";

export interface OutlinePayload {
  readonly id: string;
  readonly type: OutlineNodeType;
  readonly name: string;
  readonly kind: string | null;
  readonly span: SpanPayload;
  readonly nameSpan: SpanPayload;
  readonly children: readonly OutlinePayload[];
}

export type BackgroundValue =
  | { readonly mode: "solid"; readonly color: string }
  | { readonly mode: "none" }
  | {
      readonly mode: "gradient";
      readonly from: string;
      readonly to: string;
      readonly conjunction: "and" | "to";
    };

export type BorderValue =
  | { readonly mode: "none" }
  | {
      readonly mode: "solid";
      readonly color: string;
      readonly width: string;
    };

export type CornersValue =
  | { readonly mode: "default" }
  | { readonly mode: "full" }
  | { readonly mode: "custom"; readonly radius: string };

export interface InspectorPayload {
  readonly targetId: string;
  readonly name: string;
  readonly kind: string | null;
  readonly text: string | null;
  readonly background: BackgroundValue | null;
  readonly border: BorderValue | null;
  readonly corners: CornersValue | null;
  readonly span: SpanPayload;
  readonly nameSpan: SpanPayload;
}

export interface BootstrapPayload {
  readonly project: {
    readonly name: string;
    readonly manifestPath: string;
  };
  readonly entries: readonly TreeEntry[];
  readonly openDocuments: readonly SourceDocumentPayload[];
  readonly status: StudioStatus;
  readonly previewBase: string;
}

export interface CheckPayload {
  readonly ok: true;
  readonly valid: boolean;
  readonly diagnostics: readonly StudioDiagnostic[];
}

export interface EditRequestBody {
  readonly path: string;
  readonly baseVersion: number;
  readonly from: number;
  readonly to: number;
  readonly originalText: string;
  readonly replacementText: string;
  readonly intent: "inspector" | "format" | "rename" | "create" | "manual";
}

export interface EditResponseBody {
  readonly ok: true;
  readonly document: SourceDocumentPayload;
  readonly diagnostics: readonly StudioDiagnostic[];
  readonly status: StudioStatus;
}

export interface PropertyRequestBody {
  readonly path: string;
  readonly targetId: string;
  readonly property: "text" | "background" | "border" | "corners";
  readonly value: unknown;
}

export interface PropertyResponseBody {
  readonly ok: true;
  readonly document: SourceDocumentPayload;
  readonly element: InspectorPayload;
  readonly diagnostics: readonly StudioDiagnostic[];
  readonly status: StudioStatus;
}

export type StyleSide = "top" | "right" | "bottom" | "left";
export type StyleAxis = "both" | "horizontal" | "vertical";

export type StyleSelector =
  | {
      readonly family: "typography";
      readonly key: "size" | "color" | "weight" | "style" | "align";
    }
  | { readonly family: "font-family" }
  | { readonly family: "shadow" }
  | { readonly family: "size" }
  | { readonly family: "visibility" }
  | {
      readonly family: "spacing";
      readonly key: "padding" | "margin";
      readonly sides: readonly StyleSide[];
    }
  | { readonly family: "layout"; readonly key: "direction" | "gap" }
  | {
      readonly family: "layout";
      readonly key: "align";
      readonly axis: StyleAxis;
    }
  | {
      readonly family: "hover";
      readonly key?: "background" | "text" | "border" | "lift" | "scale";
    }
  | { readonly family: "motion" }
  | { readonly family: "gradient-direction" };

export interface StyleRequestBody {
  readonly path: string;
  readonly targetId: string;
  readonly selector: StyleSelector;
  /** Canonical single-line statement, or null to remove matching statements. */
  readonly statement: string | null;
}

export interface StyleResponseBody {
  readonly ok: true;
  readonly document: SourceDocumentPayload;
  readonly element: InspectorPayload;
  readonly diagnostics: readonly StudioDiagnostic[];
  readonly status: StudioStatus;
}

export type LayerKind =
  | "container"
  | "heading"
  | "paragraph"
  | "button"
  | "card";

export type LayerDirection = "up" | "down";
export type LayerDropPosition = "before" | "after" | "inside";

export type LayerRequestBody =
  | {
      readonly path: string;
      readonly action: "add";
      readonly targetId: string;
      readonly kind: LayerKind;
      readonly text?: string;
    }
  | {
      readonly path: string;
      readonly action: "move";
      readonly targetId: string;
      readonly direction: LayerDirection;
    }
  | {
      readonly path: string;
      readonly action: "reorder";
      readonly targetId: string;
      readonly destinationId: string;
      readonly position: LayerDropPosition;
    }
  | {
      readonly path: string;
      readonly action: "delete";
      readonly targetId: string;
    };

export interface LayerResponseBody {
  readonly ok: true;
  readonly document: SourceDocumentPayload;
  readonly outline: OutlinePayload | null;
  readonly selectedId: string | null;
  readonly message: string;
  readonly diagnostics: readonly StudioDiagnostic[];
  readonly status: StudioStatus;
}

export interface SaveRequestBody {
  readonly path: string;
}

export interface SaveResponseBody {
  readonly ok: true;
  readonly status: "saved" | "unchanged";
  readonly document: SourceDocumentPayload;
  readonly preview: StudioStatus;
}

export interface ReloadResponseBody {
  readonly ok: true;
  readonly document: SourceDocumentPayload;
  readonly status: StudioStatus;
}

export interface StudioMapOffset {
  readonly offset: number;
  readonly line: number;
  readonly column: number;
}

export interface StudioMapSpan {
  readonly start: StudioMapOffset;
  readonly end: StudioMapOffset;
}

/** Development-only map served by `/__kadam/studio-map`. */
export interface StudioMapElement {
  readonly nodeId: string;
  readonly name: string;
  readonly kind: string;
  readonly span: StudioMapSpan;
  readonly nameSpan: StudioMapSpan;
}

export interface StudioMapPage {
  readonly route: string;
  readonly title: string;
  readonly sourceFile: string;
  readonly elements: readonly StudioMapElement[];
}

export interface StudioMapPayload {
  readonly buildId: number;
  readonly pages: readonly StudioMapPage[];
}

export type PropertyValue =
  | string
  | BackgroundValue
  | BorderValue
  | CornersValue;

export interface ApiErrorBody {
  readonly ok: false;
  readonly error: {
    readonly code: string;
    readonly message: string;
  };
  readonly diagnostics?: readonly StudioDiagnostic[];
  readonly diskText?: string;
}
