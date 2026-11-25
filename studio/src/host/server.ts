import { existsSync, readFileSync, statSync } from "node:fs";
import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  contentTypeFor,
  createDevServer,
  hostAllowed,
  type DevServer,
  type DevStatus,
} from "kadam";
import type {
  ApiErrorBody,
  BootstrapPayload,
  CheckPayload,
  EditRequestBody,
  EditResponseBody,
  LayerRequestBody,
  LayerResponseBody,
  LayerKind,
  PropertyResponseBody,
  ReloadResponseBody,
  SaveResponseBody,
  StyleResponseBody,
  StyleSelector,
  StudioStatus,
} from "../shared/protocol.js";
import { PREVIEW_BRIDGE_SCRIPT } from "./preview-bridge.js";
import {
  StudioProject,
  StudioRequestError,
  documentPayload,
  serializeDiagnostics,
  type PropertyRequest,
  type StyleRequest,
} from "./project.js";

const PREVIEW_BASE = "/__preview";
const STUDIO_PREFIX = "/__studio";
const DEV_PREFIX = "/__kadam";
const PORT_ATTEMPTS = 10;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_HTML_BYTES = 16 * 1024 * 1024;

const STUDIO_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: blob:; connect-src 'self'; frame-src 'self'; " +
  "font-src 'self' data:; object-src 'none'; base-uri 'none'; " +
  "frame-ancestors 'none'";

export interface StudioServerOptions {
  readonly projectRoot: string;
  /** Built browser shell directory. Defaults to `dist/web` next to the host. */
  readonly webDir?: string | undefined;
  readonly host?: string | undefined;
  readonly port?: number | undefined;
  readonly strictPort?: boolean | undefined;
  readonly watch?: boolean | undefined;
  readonly logger?: ((message: string) => void) | undefined;
}

export interface StudioServer {
  readonly url: string;
  readonly origin: string;
  readonly port: number;
  readonly host: string;
  readonly previewUrl: string;
  readonly closed: Promise<void>;
  getStatus(): DevStatus;
  close(): Promise<void>;
}

export async function createStudioServer(
  options: StudioServerOptions,
): Promise<StudioServer> {
  const projectRoot = resolve(options.projectRoot);
  const webDir = resolve(
    options.webDir ??
      fileURLToPath(new URL("../web/", import.meta.url)),
  );
  if (!existsSync(resolve(webDir, "index.html"))) {
    throw new Error(
      `Studio browser shell not found in '${webDir}'; run 'npm run build' in studio/`,
    );
  }

  const logger =
    options.logger ?? ((message: string) => console.log(message));
  const project = new StudioProject(projectRoot);

  const dev: DevServer = await createDevServer({
    projectRoot,
    host: "127.0.0.1",
    port: 0,
    strictPort: true,
    basePath: PREVIEW_BASE,
    watch: options.watch !== false,
    ...(options.logger === undefined ? {} : { logger }),
  });

  let closing = false;
  let resolveClosed: () => void = () => {};
  const closed = new Promise<void>((resolvePromise) => {
    resolveClosed = resolvePromise;
  });

  const handler = (req: IncomingMessage, res: ServerResponse): void => {
    void handleRequest(req, res).catch((error: unknown) => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      if (error instanceof StudioRequestError) {
        sendError(res, error.status, error.code, error.message);
        return;
      }
      logger(
        `kadam studio: request failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      sendError(res, 500, "internal-error", "the Studio host failed");
    });
  };

  async function handleRequest(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const host = options.host ?? "127.0.0.1";
    if (!hostAllowed(req.headers.host, host)) {
      sendText(res, 403, "Forbidden");
      return;
    }

    const method = req.method ?? "GET";
    if (
      method !== "GET" &&
      method !== "HEAD" &&
      method !== "POST"
    ) {
      res.setHeader("Allow", "GET, HEAD, POST");
      sendText(res, 405, "Method Not Allowed");
      return;
    }

    let url: URL;
    try {
      url = new URL(req.url ?? "/", "http://localhost");
    } catch {
      sendText(res, 400, "Bad Request");
      return;
    }
    const pathname = url.pathname;

    if (pathname === `${DEV_PREFIX}` || pathname.startsWith(`${DEV_PREFIX}/`)) {
      proxyToDev(req, res, dev, false, logger);
      return;
    }
    if (
      pathname === PREVIEW_BASE ||
      pathname.startsWith(`${PREVIEW_BASE}/`)
    ) {
      proxyToDev(req, res, dev, true, logger);
      return;
    }

    if (pathname === `${STUDIO_PREFIX}/preview-bridge.js`) {
      if (method !== "GET" && method !== "HEAD") {
        methodNotAllowed(res, "GET, HEAD");
        return;
      }
      setStudioHeaders(res);
      sendBody(
        res,
        200,
        PREVIEW_BRIDGE_SCRIPT,
        "text/javascript; charset=utf-8",
        method === "HEAD",
      );
      return;
    }

    if (pathname.startsWith(`${STUDIO_PREFIX}/`)) {
      setStudioHeaders(res);
      await handleStudioApi(req, res, url, project, dev);
      return;
    }

    if (method !== "GET" && method !== "HEAD") {
      methodNotAllowed(res, "GET, HEAD");
      return;
    }

    setStudioHeaders(res);
    if (!serveStatic(pathname, res, webDir, method === "HEAD")) {
      sendText(res, 404, "Not Found");
    }
  }

  const { server, port } = await listenOnPort(
    handler,
    options.host ?? "127.0.0.1",
    options.port ?? 4310,
    options.strictPort === true,
  );

  const origin = `http://${formatHost(options.host ?? "127.0.0.1")}:${port}`;
  const url = `${origin}/`;

  async function close(): Promise<void> {
    if (closing) {
      await closed;
      return;
    }
    closing = true;

    await new Promise<void>((resolveClose) => {
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolveClose();
      };
      const timer = setTimeout(() => {
        server.closeAllConnections();
        finish();
      }, 1000);
      timer.unref();
      server.close(finish);
    });

    await dev.close();
    resolveClosed();
  }

  return {
    url,
    origin,
    port,
    host: options.host ?? "127.0.0.1",
    previewUrl: `${dev.origin}${PREVIEW_BASE}/`,
    closed,
    getStatus: () => dev.getStatus(),
    close,
  };
}

async function handleStudioApi(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  project: StudioProject,
  dev: DevServer,
): Promise<void> {
  const pathname = url.pathname;
  const method = req.method ?? "GET";

  if (pathname === `${STUDIO_PREFIX}/bootstrap`) {
    if (!requireMethod(req, res, ["GET", "HEAD"])) return;
    const payload: BootstrapPayload = {
      project: { name: project.name, manifestPath: project.manifestPath },
      entries: project.entries(),
      openDocuments: project.openDocuments(),
      status: studioStatus(dev.getStatus()),
      previewBase: PREVIEW_BASE,
    };
    sendJson(res, 200, payload, method === "HEAD");
    return;
  }

  if (pathname === `${STUDIO_PREFIX}/tree`) {
    if (!requireMethod(req, res, ["GET", "HEAD"])) return;
    sendJson(res, 200, { ok: true, entries: project.entries() }, method === "HEAD");
    return;
  }

  if (pathname === `${STUDIO_PREFIX}/status`) {
    if (!requireMethod(req, res, ["GET", "HEAD"])) return;
    sendJson(res, 200, studioStatus(dev.getStatus()), method === "HEAD");
    return;
  }

  if (pathname === `${STUDIO_PREFIX}/file`) {
    if (!requireMethod(req, res, ["GET", "HEAD"])) return;
    const path = requireQuery(url, "path");
    const document = project.open(path);
    sendJson(
      res,
      200,
      {
        ok: true,
        document: documentPayload(document, project.documentKind(document.path)),
      },
      method === "HEAD",
    );
    return;
  }

  if (pathname === `${STUDIO_PREFIX}/outline`) {
    if (!requireMethod(req, res, ["GET", "HEAD"])) return;
    const path = requireQuery(url, "path");
    sendJson(
      res,
      200,
      { ok: true, outline: project.outline(path) },
      method === "HEAD",
    );
    return;
  }

  if (pathname === `${STUDIO_PREFIX}/inspect`) {
    if (!requireMethod(req, res, ["GET", "HEAD"])) return;
    const path = requireQuery(url, "path");
    const targetId = url.searchParams.get("targetId") ?? undefined;
    const rawOffset = url.searchParams.get("offset");
    const offset =
      rawOffset === null ? undefined : parseInteger(rawOffset, "offset");
    const element = project.inspect(path, {
      ...(targetId === undefined ? {} : { targetId }),
      ...(offset === undefined ? {} : { offset }),
    });
    sendJson(res, 200, { ok: true, element }, method === "HEAD");
    return;
  }

  if (pathname === `${STUDIO_PREFIX}/check`) {
    if (!requireMethod(req, res, ["POST"])) return;
    requireSameOrigin(req);
    const body = await readJsonBody(req);
    if (body !== null && typeof body.path === "string") {
      project.open(body.path);
    }
    const result = project.check();
    const payload: CheckPayload = {
      ok: true,
      valid: result.valid,
      diagnostics: result.diagnostics,
    };
    sendJson(res, 200, payload);
    return;
  }

  if (pathname === `${STUDIO_PREFIX}/edit`) {
    if (!requireMethod(req, res, ["POST"])) return;
    requireSameOrigin(req);
    const body = await readJsonBody(req);
    const request = parseEditBody(body);
    const result = project.edit(request);

    if (!result.ok) {
      sendJson(res, 422, {
        ok: false,
        error:
          result.error ?? {
            code: "invalid-edit",
            message: "the edit does not compile",
          },
        diagnostics: serializeDiagnostics(
          result.diagnostics,
          project.projectRoot,
        ),
      });
      return;
    }

    const status = refreshPreview(project, dev);
    const payload: EditResponseBody = {
      ok: true,
      document: documentPayload(
        result.document,
        project.documentKind(result.document.path),
      ),
      diagnostics: serializeDiagnostics(
        result.diagnostics,
        project.projectRoot,
      ),
      status,
    };
    sendJson(res, 200, payload);
    return;
  }

  if (pathname === `${STUDIO_PREFIX}/property`) {
    if (!requireMethod(req, res, ["POST"])) return;
    requireSameOrigin(req);
    const body = await readJsonBody(req);
    const parsed = parsePropertyBody(body);
    const result = project.setProperty(
      parsed.path,
      parsed.targetId,
      parsed.request,
    );

    if (!result.ok) {
      sendJson(res, 422, {
        ok: false,
        error:
          result.error ?? {
            code: "invalid-edit",
            message: "the property change does not compile",
          },
        diagnostics: serializeDiagnostics(
          result.diagnostics,
          project.projectRoot,
        ),
      });
      return;
    }

    const status = refreshPreview(project, dev);
    const element = project.inspect(result.document.path, {
      targetId: parsed.targetId,
    });
    const payload: PropertyResponseBody = {
      ok: true,
      document: documentPayload(
        result.document,
        project.documentKind(result.document.path),
      ),
      element,
      diagnostics: serializeDiagnostics(
        result.diagnostics,
        project.projectRoot,
      ),
      status,
    };
    sendJson(res, 200, payload);
    return;
  }

  if (pathname === `${STUDIO_PREFIX}/style`) {
    if (!requireMethod(req, res, ["POST"])) return;
    requireSameOrigin(req);
    const body = await readJsonBody(req);
    const parsed = parseStyleBody(body);
    const result = project.setStyle(
      parsed.path,
      parsed.targetId,
      parsed.request,
    );

    if (!result.ok) {
      sendJson(res, 422, {
        ok: false,
        error:
          result.error ?? {
            code: "invalid-edit",
            message: "the style change does not compile",
          },
        diagnostics: serializeDiagnostics(
          result.diagnostics,
          project.projectRoot,
        ),
      });
      return;
    }

    const status = refreshPreview(project, dev);
    const element = project.inspect(result.document.path, {
      targetId: parsed.targetId,
    });
    const payload: StyleResponseBody = {
      ok: true,
      document: documentPayload(
        result.document,
        project.documentKind(result.document.path),
      ),
      element,
      diagnostics: serializeDiagnostics(
        result.diagnostics,
        project.projectRoot,
      ),
      status,
    };
    sendJson(res, 200, payload);
    return;
  }

  if (pathname === `${STUDIO_PREFIX}/layer`) {
    if (!requireMethod(req, res, ["POST"])) return;
    requireSameOrigin(req);
    const body = await readJsonBody(req);
    const request = parseLayerBody(body);
    const result = project.changeLayer(request);

    if (!result.ok) {
      sendJson(res, 422, {
        ok: false,
        error:
          result.error ?? {
            code: "invalid-layer",
            message: "the layer change does not compile",
          },
        diagnostics: serializeDiagnostics(
          result.diagnostics,
          project.projectRoot,
        ),
      });
      return;
    }

    const status = refreshPreview(project, dev);
    const payload: LayerResponseBody = {
      ok: true,
      document: documentPayload(
        result.document,
        project.documentKind(result.document.path),
      ),
      outline: result.outline,
      selectedId: result.selectedId,
      message: result.message,
      diagnostics: serializeDiagnostics(
        result.diagnostics,
        project.projectRoot,
      ),
      status,
    };
    sendJson(res, 200, payload);
    return;
  }

  if (pathname === `${STUDIO_PREFIX}/save`) {
    if (!requireMethod(req, res, ["POST"])) return;
    requireSameOrigin(req);
    const body = await readJsonBody(req);
    const path = requireString(body, "path");
    const result = project.save(path);

    if (!result.ok) {
      sendJson(res, result.error.code === "conflict" ? 409 : 400, {
        ok: false,
        error: {
          code: result.error.code,
          message: result.error.message,
        },
        ...(result.error.diskText === undefined
          ? {}
          : { diskText: result.error.diskText }),
      });
      return;
    }

    const status = refreshPreview(project, dev);
    const payload: SaveResponseBody = {
      ok: true,
      status: result.status,
      document: documentPayload(
        result.document,
        project.documentKind(result.document.path),
      ),
      preview: status,
    };
    sendJson(res, 200, payload);
    return;
  }

  if (pathname === `${STUDIO_PREFIX}/reload`) {
    if (!requireMethod(req, res, ["POST"])) return;
    requireSameOrigin(req);
    const body = await readJsonBody(req);
    const path = requireString(body, "path");
    const document = project.reload(path);
    const status = refreshPreview(project, dev);
    const payload: ReloadResponseBody = {
      ok: true,
      document: documentPayload(document, project.documentKind(document.path)),
      status,
    };
    sendJson(res, 200, payload);
    return;
  }

  sendError(res, 404, "not-found", "unknown Studio endpoint");
}

function parseEditBody(body: Record<string, unknown>): EditRequestBody {
  const intent = requireString(body, "intent");
  if (
    intent !== "inspector" &&
    intent !== "format" &&
    intent !== "rename" &&
    intent !== "create" &&
    intent !== "manual"
  ) {
    throw new StudioRequestError(400, "invalid-intent", "unknown edit intent");
  }

  return {
    path: requireString(body, "path"),
    baseVersion: requireInteger(body, "baseVersion"),
    from: requireInteger(body, "from"),
    to: requireInteger(body, "to"),
    originalText: requireString(body, "originalText"),
    replacementText: requireString(body, "replacementText"),
    intent,
  };
}

function parseLayerBody(body: Record<string, unknown>): LayerRequestBody {
  const path = requireString(body, "path");
  const action = requireString(body, "action");
  const targetId = requireString(body, "targetId");

  if (action === "add") {
    const kind = requireString(body, "kind");
    if (!isLayerKind(kind)) {
      throw new StudioRequestError(
        400,
        "invalid-layer-kind",
        `unsupported layer kind '${kind}'`,
      );
    }
    const text = body.text;
    if (text !== undefined && typeof text !== "string") {
      throw new StudioRequestError(
        400,
        "invalid-value",
        "layer text must be a string",
      );
    }
    return {
      path,
      action,
      targetId,
      kind,
      ...(typeof text === "string" ? { text } : {}),
    };
  }

  if (action === "reorder") {
    const destinationId = requireString(body, "destinationId");
    const position = requireString(body, "position");
    if (position !== "before" && position !== "after" && position !== "inside") {
      throw new StudioRequestError(
        400,
        "invalid-position",
        "layer position must be before, after, or inside",
      );
    }
    return { path, action, targetId, destinationId, position };
  }

  if (action === "move") {
    const direction = requireString(body, "direction");
    if (direction !== "up" && direction !== "down") {
      throw new StudioRequestError(
        400,
        "invalid-direction",
        "layer direction must be up or down",
      );
    }
    return { path, action, targetId, direction };
  }

  if (action === "delete") {
    return { path, action, targetId };
  }

  throw new StudioRequestError(
    400,
    "invalid-action",
    `unsupported layer action '${action}'`,
  );
}

function isLayerKind(value: string): value is LayerKind {
  return (
    value === "container" ||
    value === "heading" ||
    value === "paragraph" ||
    value === "button" ||
    value === "card"
  );
}

function parsePropertyBody(body: Record<string, unknown>): {
  readonly path: string;
  readonly targetId: string;
  readonly request: PropertyRequest;
} {
  const path = requireString(body, "path");
  const targetId = requireString(body, "targetId");
  const property = requireString(body, "property");
  const value = body.value;

  switch (property) {
    case "text": {
      if (typeof value !== "string") {
        throw new StudioRequestError(400, "invalid-value", "text must be a string");
      }
      return { path, targetId, request: { property, value } };
    }
    case "background": {
      return {
        path,
        targetId,
        request: { property, value: parseBackground(value) },
      };
    }
    case "border": {
      return {
        path,
        targetId,
        request: { property, value: parseBorder(value) },
      };
    }
    case "corners": {
      return {
        path,
        targetId,
        request: { property, value: parseCorners(value) },
      };
    }
    default:
      throw new StudioRequestError(
        400,
        "invalid-property",
        `unsupported property '${property}'`,
      );
  }
}

type BackgroundRequestValue = Extract<
  PropertyRequest,
  { property: "background" }
>["value"];
type BorderRequestValue = Extract<PropertyRequest, { property: "border" }>["value"];
type CornersRequestValue = Extract<
  PropertyRequest,
  { property: "corners" }
>["value"];

function parseBackground(value: unknown): BackgroundRequestValue {
  const record = requireObject(value, "background");
  const mode = requireString(record, "mode");
  if (mode === "none") return { mode };
  if (mode === "solid") {
    return { mode, color: requireString(record, "color") };
  }
  if (mode === "gradient") {
    const conjunction =
      record.conjunction === "to" || record.conjunction === "and"
        ? record.conjunction
        : undefined;
    return {
      mode,
      from: requireString(record, "from"),
      to: requireString(record, "to"),
      ...(conjunction === undefined ? {} : { conjunction }),
    };
  }
  throw new StudioRequestError(
    400,
    "invalid-value",
    "background mode must be solid, none, or gradient",
  );
}

function parseBorder(value: unknown): BorderRequestValue {
  const record = requireObject(value, "border");
  const mode = requireString(record, "mode");
  if (mode === "none") return { mode };
  if (mode === "solid") {
    return {
      mode,
      color: requireString(record, "color"),
      width: requireString(record, "width"),
    };
  }
  throw new StudioRequestError(
    400,
    "invalid-value",
    "border mode must be none or solid",
  );
}

function parseStyleBody(body: Record<string, unknown>): {
  readonly path: string;
  readonly targetId: string;
  readonly request: StyleRequest;
} {
  const path = requireString(body, "path");
  const targetId = requireString(body, "targetId");
  const selector = parseStyleSelector(body.selector);
  const rawStatement = body.statement;
  if (rawStatement !== null && typeof rawStatement !== "string") {
    throw new StudioRequestError(
      400,
      "invalid-value",
      "statement must be a string or null",
    );
  }
  if (typeof rawStatement === "string" && rawStatement.length > 500) {
    throw new StudioRequestError(
      400,
      "invalid-value",
      "style statement is too long",
    );
  }
  return {
    path,
    targetId,
    request: { selector, statement: rawStatement },
  };
}

function parseStyleSelector(value: unknown): StyleSelector {
  const record = requireObject(value, "selector");
  const family = requireString(record, "family");
  switch (family) {
    case "typography": {
      const key = requireString(record, "key");
      if (
        key !== "size" &&
        key !== "color" &&
        key !== "weight" &&
        key !== "style" &&
        key !== "align"
      ) {
        throw new StudioRequestError(400, "invalid-value", "unknown typography key");
      }
      return { family, key };
    }
    case "font-family":
    case "shadow":
    case "size":
    case "visibility":
    case "motion":
    case "gradient-direction":
      return { family };
    case "spacing": {
      const key = requireString(record, "key");
      if (key !== "padding" && key !== "margin") {
        throw new StudioRequestError(400, "invalid-value", "unknown spacing key");
      }
      const rawSides = record.sides;
      if (!Array.isArray(rawSides) || rawSides.length === 0) {
        throw new StudioRequestError(400, "invalid-value", "spacing sides are required");
      }
      const sides = rawSides.map((side) => {
        if (
          side !== "top" &&
          side !== "right" &&
          side !== "bottom" &&
          side !== "left"
        ) {
          throw new StudioRequestError(400, "invalid-value", "unknown spacing side");
        }
        return side;
      });
      return { family, key, sides };
    }
    case "layout": {
      const key = requireString(record, "key");
      if (key === "align") {
        const axis = requireString(record, "axis");
        if (axis !== "both" && axis !== "horizontal" && axis !== "vertical") {
          throw new StudioRequestError(400, "invalid-value", "unknown align axis");
        }
        return { family, key, axis };
      }
      if (key !== "direction" && key !== "gap") {
        throw new StudioRequestError(400, "invalid-value", "unknown layout key");
      }
      return { family, key };
    }
    case "hover": {
      const key = record.key;
      if (key === undefined) return { family };
      if (
        key !== "background" &&
        key !== "text" &&
        key !== "border" &&
        key !== "lift" &&
        key !== "scale"
      ) {
        throw new StudioRequestError(400, "invalid-value", "unknown hover effect");
      }
      return { family, key };
    }
    default:
      throw new StudioRequestError(400, "invalid-value", "unknown style family");
  }
}

function parseCorners(value: unknown): CornersRequestValue {
  const record = requireObject(value, "corners");
  const mode = requireString(record, "mode");
  if (mode === "default" || mode === "full") return { mode };
  if (mode === "custom") {
    return { mode, radius: requireString(record, "radius") };
  }
  throw new StudioRequestError(
    400,
    "invalid-value",
    "corner mode must be default, full, or custom",
  );
}

function refreshPreview(project: StudioProject, dev: DevServer): StudioStatus {
  const overrides = project.overrides();
  const outcome =
    overrides.size === 0
      ? dev.clearSourceOverrides()
      : dev.setSourceOverrides(overrides);
  return studioStatus(outcome.status);
}

function studioStatus(status: DevStatus): StudioStatus {
  return {
    buildId: status.buildId,
    phase: status.phase,
    served: status.served,
    compileMs: status.compileMs,
    routes: status.routes.map((route) => ({
      route: route.route,
      title: route.title,
    })),
  };
}

function proxyToDev(
  req: IncomingMessage,
  res: ServerResponse,
  dev: DevServer,
  injectBridge: boolean,
  logger: (message: string) => void,
): void {
  const headers = { ...req.headers };
  headers.host = `${formatHost(dev.host)}:${dev.port}`;
  delete headers["accept-encoding"];

  const upstream = httpRequest(
    {
      host: dev.host,
      port: dev.port,
      path: req.url ?? "/",
      method: req.method,
      headers,
    },
    (upstreamResponse) => {
      const contentType = String(
        upstreamResponse.headers["content-type"] ?? "",
      );
      const isHtml = injectBridge && contentType.startsWith("text/html");

      if (!isHtml || req.method === "HEAD") {
        res.writeHead(
          upstreamResponse.statusCode ?? 502,
          upstreamResponse.headers,
        );
        upstreamResponse.pipe(res);
        return;
      }

      const chunks: Buffer[] = [];
      let size = 0;
      upstreamResponse.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_HTML_BYTES) {
          upstreamResponse.destroy();
          if (!res.headersSent) {
            sendError(res, 502, "preview-too-large", "preview HTML is too large");
          }
          return;
        }
        chunks.push(chunk);
      });
      upstreamResponse.on("end", () => {
        const html = Buffer.concat(chunks).toString("utf8");
        const injected = injectPreviewBridge(html);

        res.statusCode = upstreamResponse.statusCode ?? 502;
        for (const [name, value] of Object.entries(upstreamResponse.headers)) {
          if (value === undefined) continue;
          if (
            name === "content-length" ||
            name === "transfer-encoding" ||
            name === "connection"
          ) {
            continue;
          }
          res.setHeader(name, value);
        }

        const policy = upstreamResponse.headers["content-security-policy"];
        res.setHeader(
          "Content-Security-Policy",
          `${typeof policy === "string" ? `${policy}; ` : ""}frame-ancestors 'self'`,
        );
        res.removeHeader("X-Frame-Options");

        const buffer = Buffer.from(injected, "utf8");
        res.setHeader("Content-Length", String(buffer.length));
        res.end(buffer);
      });
      upstreamResponse.on("error", () => {
        if (!res.headersSent) {
          sendError(res, 502, "preview-failed", "preview response failed");
        } else {
          res.destroy();
        }
      });
    },
  );

  upstream.setTimeout(0);
  upstream.on("error", (error) => {
    logger(
      `kadam studio: preview proxy failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    if (!res.headersSent) {
      sendError(res, 502, "preview-unavailable", "the preview server is unavailable");
    } else {
      res.destroy();
    }
  });

  res.on("close", () => upstream.destroy());
  req.pipe(upstream);
}

function injectPreviewBridge(html: string): string {
  const tag = `<script src="/__studio/preview-bridge.js" defer></script>`;
  const index = html.lastIndexOf("</body>");
  if (index === -1) return `${html}${html.endsWith("\n") ? "" : "\n"}${tag}\n`;
  return `${html.slice(0, index)}${tag}\n${html.slice(index)}`;
}

function serveStatic(
  pathname: string,
  res: ServerResponse,
  webDir: string,
  headOnly: boolean,
): boolean {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    sendText(res, 400, "Bad Request");
    return true;
  }
  if (decoded.includes("\0") || decoded.includes("\\")) {
    sendText(res, 400, "Bad Request");
    return true;
  }

  let relativePath = decoded === "/" ? "index.html" : decoded.slice(1);
  if (relativePath === "" || relativePath.endsWith("/")) {
    relativePath += "index.html";
  }

  let candidate = resolve(webDir, relativePath);
  if (!isInsideOrEqual(webDir, candidate)) {
    sendText(res, 403, "Forbidden");
    return true;
  }

  try {
    if (statSync(candidate).isDirectory()) {
      candidate = resolve(candidate, "index.html");
    }
  } catch {
    // Fall through to the SPA fallback.
  }

  if (!isInsideOrEqual(webDir, candidate) || !isFile(candidate)) {
    if (extname(decoded) !== "") return false;
    candidate = resolve(webDir, "index.html");
    if (!isFile(candidate)) return false;
  }

  const extension = candidate.slice(candidate.lastIndexOf(".") + 1).toLowerCase();
  const contentType =
    contentTypeFor(candidate) ?? EXTRA_CONTENT_TYPES[extension] ?? "application/octet-stream";

  if (contentType.startsWith("text/html")) {
    res.setHeader("Content-Security-Policy", STUDIO_CSP);
  }
  sendBody(res, 200, readFileSync(candidate), contentType, headOnly);
  return true;
}

const EXTRA_CONTENT_TYPES: Readonly<Record<string, string>> = {
  json: "application/json; charset=utf-8",
  map: "application/json; charset=utf-8",
  ico: "image/x-icon",
  txt: "text/plain; charset=utf-8",
  webmanifest: "application/manifest+json",
};

function setStudioHeaders(res: ServerResponse): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader("Cache-Control", "no-store");
}

function requireMethod(
  req: IncomingMessage,
  res: ServerResponse,
  allowed: readonly string[],
): boolean {
  const method = req.method ?? "GET";
  if (allowed.includes(method)) return true;
  methodNotAllowed(res, allowed.join(", "));
  return false;
}

function methodNotAllowed(res: ServerResponse, allow: string): void {
  res.setHeader("Allow", allow);
  sendText(res, 405, "Method Not Allowed");
}

function requireSameOrigin(req: IncomingMessage): void {
  const origin = req.headers.origin;
  if (origin === undefined) return;
  const host = req.headers.host;
  if (host === undefined || origin !== `http://${host}`) {
    throw new StudioRequestError(
      403,
      "cross-origin",
      "Studio mutations must come from the Studio origin",
    );
  }
}

async function readJsonBody(
  req: IncomingMessage,
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    size += buffer.length;
    if (size > MAX_BODY_BYTES) {
      throw new StudioRequestError(
        413,
        "body-too-large",
        "request body is too large",
      );
    }
    chunks.push(buffer);
  }
  if (size === 0) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new StudioRequestError(400, "invalid-json", "request body must be JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new StudioRequestError(
      400,
      "invalid-body",
      "request body must be a JSON object",
    );
  }
  return parsed as Record<string, unknown>;
}

function requireObject(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new StudioRequestError(400, "invalid-value", `${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== "string") {
    throw new StudioRequestError(400, "invalid-body", `'${key}' must be a string`);
  }
  return value;
}

function requireInteger(body: Record<string, unknown>, key: string): number {
  const value = body[key];
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new StudioRequestError(400, "invalid-body", `'${key}' must be an integer`);
  }
  return value;
}

function requireQuery(url: URL, key: string): string {
  const value = url.searchParams.get(key);
  if (value === null || value === "") {
    throw new StudioRequestError(400, "missing-parameter", `'${key}' is required`);
  }
  return value;
}

function parseInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new StudioRequestError(
      400,
      "invalid-parameter",
      `'${name}' must be a non-negative integer`,
    );
  }
  return parsed;
}

function sendJson(
  res: ServerResponse,
  status: number,
  value: unknown,
  headOnly = false,
): void {
  sendBody(
    res,
    status,
    JSON.stringify(value),
    "application/json; charset=utf-8",
    headOnly,
  );
}

function sendError(
  res: ServerResponse,
  status: number,
  code: string,
  message: string,
): void {
  const body: ApiErrorBody = { ok: false, error: { code, message } };
  sendJson(res, status, body);
}

function sendText(res: ServerResponse, status: number, text: string): void {
  sendBody(res, status, text, "text/plain; charset=utf-8");
}

function sendBody(
  res: ServerResponse,
  status: number,
  body: string | Uint8Array,
  contentType: string,
  headOnly = false,
): void {
  const buffer =
    typeof body === "string" ? Buffer.from(body, "utf8") : Buffer.from(body);
  res.statusCode = status;
  res.setHeader("Content-Type", contentType);
  res.setHeader("Content-Length", String(buffer.length));
  if (headOnly) res.end();
  else res.end(buffer);
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function isInsideOrEqual(root: string, target: string): boolean {
  return resolve(root) === resolve(target) || isInside(root, target);
}

function isInside(root: string, target: string): boolean {
  const relation = relative(root, target);
  return (
    relation !== "" &&
    relation !== ".." &&
    !relation.startsWith(`..${sep}`) &&
    !isAbsolute(relation)
  );
}

function formatHost(host: string): string {
  if (host.includes(":") && !host.startsWith("[")) return `[${host}]`;
  return host;
}

async function listenOnPort(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
  host: string,
  startPort: number,
  strictPort: boolean,
): Promise<{ server: Server; port: number }> {
  const attempts = strictPort || startPort === 0 ? 1 : PORT_ATTEMPTS;
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const candidate = startPort === 0 ? 0 : startPort + attempt;
    const server = createServer(handler);
    try {
      await new Promise<void>((resolveListen, rejectListen) => {
        const onError = (error: Error): void => {
          server.removeListener("listening", onListening);
          rejectListen(error);
        };
        const onListening = (): void => {
          server.removeListener("error", onError);
          resolveListen();
        };
        server.once("error", onError);
        server.once("listening", onListening);
        server.listen(candidate, host);
      });
      const address = server.address() as AddressInfo;
      return { server, port: address.port };
    } catch (error) {
      lastError = error;
      try {
        server.close();
      } catch {
        // The server never started listening.
      }
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EADDRINUSE" || strictPort || startPort === 0) throw error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("could not bind a Studio port");
}
