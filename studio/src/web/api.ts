import type {
  ApiErrorBody,
  BootstrapPayload,
  CheckPayload,
  EditRequestBody,
  EditResponseBody,
  LayerRequestBody,
  LayerResponseBody,
  OutlinePayload,
  PropertyRequestBody,
  PropertyResponseBody,
  StyleRequestBody,
  StyleResponseBody,
  ReloadResponseBody,
  SaveRequestBody,
  SaveResponseBody,
  SourceDocumentPayload,
  StudioDiagnostic,
  StudioMapPayload,
  StudioStatus,
  TreeEntry,
} from "../shared/protocol.js";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly diagnostics: readonly StudioDiagnostic[] | undefined;
  readonly diskText: string | undefined;

  constructor(
    status: number,
    code: string,
    message: string,
    diagnostics?: readonly StudioDiagnostic[],
    diskText?: string,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.diagnostics = diagnostics;
    this.diskText = diskText;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      cache: "no-store",
      ...init,
      headers: {
        Accept: "application/json",
        ...(init?.headers ?? {}),
      },
    });
  } catch (error) {
    throw new ApiError(
      0,
      "network-error",
      error instanceof Error ? error.message : "the Studio host is not reachable",
    );
  }

  const text = await response.text();
  let parsed: unknown = null;
  if (text !== "") {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }

  if (!response.ok) {
    const body = isRecord(parsed) ? (parsed as Partial<ApiErrorBody>) : null;
    const error = body !== null && isRecord(body.error) ? body.error : null;
    throw new ApiError(
      response.status,
      typeof error?.code === "string" ? error.code : "request-failed",
      typeof error?.message === "string"
        ? error.message
        : `request failed (${response.status})`,
      body !== null && Array.isArray(body.diagnostics)
        ? (body.diagnostics as readonly StudioDiagnostic[])
        : undefined,
      body !== null && typeof body.diskText === "string"
        ? body.diskText
        : undefined,
    );
  }

  return parsed as T;
}

function get<T>(path: string): Promise<T> {
  return request<T>(path);
}

function post<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export const api = {
  bootstrap(): Promise<BootstrapPayload> {
    return get<BootstrapPayload>("/__studio/bootstrap");
  },

  tree(): Promise<{ readonly ok: true; readonly entries: readonly TreeEntry[] }> {
    return get("/__studio/tree");
  },

  status(): Promise<StudioStatus> {
    return get<StudioStatus>("/__studio/status");
  },

  file(
    path: string,
  ): Promise<{ readonly ok: true; readonly document: SourceDocumentPayload }> {
    return get(`/__studio/file?path=${encodeURIComponent(path)}`);
  },

  outline(
    path: string,
  ): Promise<{ readonly ok: true; readonly outline: OutlinePayload | null }> {
    return get(`/__studio/outline?path=${encodeURIComponent(path)}`);
  },

  inspect(
    path: string,
    target: { readonly targetId?: string; readonly offset?: number },
  ): Promise<{ readonly ok: true; readonly element: import("../shared/protocol.js").InspectorPayload }> {
    const query = new URLSearchParams({ path });
    if (target.targetId !== undefined) query.set("targetId", target.targetId);
    if (target.offset !== undefined) query.set("offset", String(target.offset));
    return get(`/__studio/inspect?${query.toString()}`);
  },

  check(path?: string): Promise<CheckPayload> {
    return post("/__studio/check", path === undefined ? {} : { path });
  },

  edit(body: EditRequestBody): Promise<EditResponseBody> {
    return post("/__studio/edit", body);
  },

  property(body: PropertyRequestBody): Promise<PropertyResponseBody> {
    return post("/__studio/property", body);
  },

  style(body: StyleRequestBody): Promise<StyleResponseBody> {
    return post("/__studio/style", body);
  },

  layer(body: LayerRequestBody): Promise<LayerResponseBody> {
    return post("/__studio/layer", body);
  },

  save(body: SaveRequestBody): Promise<SaveResponseBody> {
    return post("/__studio/save", body);
  },

  reload(body: SaveRequestBody): Promise<ReloadResponseBody> {
    return post("/__studio/reload", body);
  },

  studioMap(buildId: number): Promise<StudioMapPayload> {
    return get(`/__kadam/studio-map?buildId=${buildId}`);
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
