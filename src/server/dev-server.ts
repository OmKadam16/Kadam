import { spawn } from "node:child_process";
import { statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import { formatDiagnostics } from "../core/diagnostics/format.js";
import { CLIENT_SCRIPT } from "./client/client-script.js";
import { CLIENT_STYLE } from "./client/client-style.js";
import { DevSession, type BuildOutcome, type DevStatus } from "./dev-session.js";
import {
  DEV_PREFIX,
  contentTypeFor,
  injectClientScript,
  renderErrorShell,
  renderNotFound,
  resolveRequestPath,
} from "./request.js";
import { createWatcher, type Watcher } from "./watch.js";

const MAX_EVENT_CLIENTS = 32;
const HEARTBEAT_MS = 15_000;
const PORT_ATTEMPTS = 10;

const SECURITY_POLICY =
  "default-src 'self'; img-src 'self' data:; style-src 'self'; " +
  "script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'";

export interface DevServerOptions {
  readonly projectRoot: string;
  readonly host?: string | undefined;
  readonly port?: number | undefined;
  /** When true, a busy port is an error instead of trying the next one. */
  readonly strictPort?: boolean | undefined;
  readonly basePath?: string | undefined;
  readonly openBrowser?: boolean | undefined;
  readonly poll?: boolean | undefined;
  readonly watch?: boolean | undefined;
  readonly logger?: ((message: string) => void) | undefined;
}

export interface DevServer {
  readonly url: string;
  readonly origin: string;
  readonly port: number;
  readonly host: string;
  readonly basePath: string;
  readonly closed: Promise<void>;
  getStatus(): DevStatus;
  rebuild(): BuildOutcome;
  /** Replace the in-memory source overlay and rebuild immediately. */
  setSourceOverrides(
    overrides: ReadonlyMap<string, string | Uint8Array>,
  ): BuildOutcome;
  /** Drop the source overlay, return to disk sources, and rebuild. */
  clearSourceOverrides(): BuildOutcome;
  close(): Promise<void>;
}

export async function createDevServer(
  options: DevServerOptions,
): Promise<DevServer> {
  const projectRoot = resolve(options.projectRoot);
  assertProjectDirectory(projectRoot);

  const logger = options.logger ?? ((message: string) => console.log(message));
  const session = new DevSession({
    projectRoot,
    basePath: options.basePath,
  });

  const initial = session.build([]);
  logBuild(initial, logger, true);

  const basePath = session.basePath;
  const host = options.host ?? "127.0.0.1";
  const requestedPort = options.port ?? 3000;
  const clients = new Set<ServerResponse>();
  const pendingPaths = new Set<string>();

  let watcher: Watcher | null = null;
  let building = false;
  let queued = false;
  let closing = false;
  let resolveClosed: () => void = () => {};
  const closed = new Promise<void>((resolveClosedPromise) => {
    resolveClosed = resolveClosedPromise;
  });

  function broadcast(event: string, payload: unknown, id?: number): void {
    for (const client of clients) {
      try {
        writeEvent(client, event, payload, id);
      } catch {
        clients.delete(client);
      }
    }
  }

  function handleRequest(
    req: IncomingMessage,
    res: ServerResponse,
  ): void {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Content-Security-Policy", SECURITY_POLICY);

    if (!hostAllowed(req.headers.host, host)) {
      sendText(res, 403, "Forbidden");
      return;
    }

    const method = req.method ?? "GET";
    if (method !== "GET" && method !== "HEAD") {
      res.setHeader("Allow", "GET, HEAD");
      sendText(res, 405, "Method Not Allowed");
      return;
    }
    const headOnly = method === "HEAD";

    let url: URL;
    try {
      url = new URL(req.url ?? "/", "http://localhost");
    } catch {
      sendText(res, 400, "Bad Request");
      return;
    }
    const pathname = url.pathname;

    if (pathname === `${DEV_PREFIX}/events`) {
      openEventStream(req, res);
      return;
    }
    if (pathname === `${DEV_PREFIX}/status`) {
      sendJson(res, 200, session.status, headOnly);
      return;
    }
    if (pathname === `${DEV_PREFIX}/client.js`) {
      sendBody(res, 200, CLIENT_SCRIPT, "text/javascript; charset=utf-8", headOnly);
      return;
    }
    if (pathname === `${DEV_PREFIX}/client.css`) {
      sendBody(res, 200, CLIENT_STYLE, "text/css; charset=utf-8", headOnly);
      return;
    }
    if (pathname === DEV_PREFIX || pathname.startsWith(`${DEV_PREFIX}/`)) {
      sendHtml(res, 404, renderNotFound([], basePath), headOnly);
      return;
    }

    const snapshot = session.snapshot;
    if (snapshot === null) {
      sendHtml(res, 503, renderErrorShell(), headOnly);
      return;
    }

    const resolved = resolveRequestPath(
      pathname,
      basePath,
      new Set(snapshot.files.keys()),
    );

    switch (resolved.kind) {
      case "bad-request":
        sendText(res, 400, "Bad Request");
        return;
      case "not-found":
        sendHtml(res, 404, renderNotFound(session.status.routes, basePath), headOnly);
        return;
      case "redirect":
        res.statusCode = 301;
        res.setHeader("Location", resolved.location);
        res.end();
        return;
      case "file": {
        const entry = snapshot.files.get(resolved.path);
        if (entry === undefined) {
          sendHtml(res, 404, renderNotFound(session.status.routes, basePath), headOnly);
          return;
        }
        const type =
          contentTypeFor(resolved.path) ?? "application/octet-stream";
        if (entry.kind === "html" && typeof entry.contents === "string") {
          sendBody(res, 200, injectClientScript(entry.contents), type, headOnly);
        } else {
          sendBody(res, 200, entry.contents, type, headOnly);
        }
        return;
      }
    }
  }

  function openEventStream(
    req: IncomingMessage,
    res: ServerResponse,
  ): void {
    if (clients.size >= MAX_EVENT_CLIENTS) {
      sendText(res, 503, "Too many event streams");
      return;
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write("retry: 1000\n\n");
    clients.add(res);
    try {
      writeEvent(res, "status", session.status, session.status.buildId);
    } catch {
      clients.delete(res);
      res.end();
      return;
    }

    req.on("close", () => {
      clients.delete(res);
    });
  }

  function runRebuild(changedPaths: readonly string[] = []): BuildOutcome {
    const outcome = session.build(changedPaths);
    watcher?.update(session.watchPaths);
    logBuild(outcome, logger, false);

    broadcast("status", outcome.status, outcome.status.buildId);

    if (outcome.ok) {
      if (outcome.plan.kind === "reload") {
        broadcast(
          "reload",
          { buildId: outcome.status.buildId, reason: outcome.plan.reason },
          outcome.status.buildId,
        );
      } else if (outcome.plan.kind === "css") {
        broadcast(
          "css",
          {
            buildId: outcome.status.buildId,
            hrefs: outcome.plan.paths.map((path) => `${basePath}/${path}`),
          },
          outcome.status.buildId,
        );
      }
    }

    return outcome;
  }

  function scheduleRebuild(paths: readonly string[]): void {
    for (const path of paths) pendingPaths.add(path);
    if (building) {
      queued = true;
      return;
    }

    building = true;
    try {
      do {
        queued = false;
        const changed = [...pendingPaths].sort();
        pendingPaths.clear();
        runRebuild(changed);
      } while (queued);
    } finally {
      building = false;
    }
  }

  const { server, port } = await listenOnPort(
    handleRequest,
    host,
    requestedPort,
    options.strictPort === true,
  );

  const origin = `http://${formatHost(host)}:${port}`;
  const url = `${origin}${basePath}/`;

  if (options.watch !== false) {
    watcher = createWatcher({
      projectRoot,
      outDir: session.outDir,
      onChange: scheduleRebuild,
      poll: options.poll === true,
      logger,
    });
    watcher.update(session.watchPaths);
  }

  const heartbeat = setInterval(() => {
    for (const client of clients) {
      try {
        client.write(": ping\n\n");
      } catch {
        clients.delete(client);
      }
    }
  }, HEARTBEAT_MS);
  heartbeat.unref();

  if (options.openBrowser === true) openBrowserUrl(url);

  async function close(): Promise<void> {
    if (closing) {
      await closed;
      return;
    }
    closing = true;

    watcher?.close();
    clearInterval(heartbeat);

    for (const client of clients) {
      try {
        writeEvent(client, "shutdown", {});
      } catch {
        // The connection is already gone.
      }
      try {
        client.end();
      } catch {
        // The connection is already gone.
      }
    }
    clients.clear();

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

    resolveClosed();
  }

  return {
    url,
    origin,
    port,
    host,
    basePath,
    closed,
    getStatus: () => session.status,
    rebuild: () => runRebuild([]),
    setSourceOverrides: (overrides) => {
      session.setSourceOverrides(overrides);
      return runRebuild([]);
    },
    clearSourceOverrides: () => {
      session.clearSourceOverrides();
      return runRebuild([]);
    },
    close,
  };
}

function logBuild(
  outcome: BuildOutcome,
  logger: (message: string) => void,
  initial: boolean,
): void {
  if (outcome.ok) {
    const pages = outcome.status.routes.length;
    logger(
      `kadam dev: ${initial ? "built" : "rebuilt"} ${pages} page${
        pages === 1 ? "" : "s"
      } in ${outcome.status.compileMs} ms`,
    );
    return;
  }

  const formatted = formatDiagnostics(outcome.diagnostics, outcome.sources);
  if (formatted !== "") logger(formatted);
  logger(
    `kadam dev: ${
      initial
        ? "initial build failed; serving the error page"
        : "build failed; keeping the last successful preview"
    }`,
  );
}

function writeEvent(
  res: ServerResponse,
  event: string,
  payload: unknown,
  id?: number,
): void {
  const lines: string[] = [];
  if (id !== undefined) lines.push(`id: ${id}`);
  lines.push(`event: ${event}`);
  lines.push(`data: ${JSON.stringify(payload)}`);
  res.write(`${lines.join("\n")}\n\n`);
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

function sendHtml(
  res: ServerResponse,
  status: number,
  html: string,
  headOnly = false,
): void {
  sendBody(res, status, html, "text/html; charset=utf-8", headOnly);
}

function sendText(res: ServerResponse, status: number, text: string): void {
  sendBody(res, status, text, "text/plain; charset=utf-8");
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

function assertProjectDirectory(projectRoot: string): void {
  let stats;
  try {
    stats = statSync(projectRoot);
  } catch {
    throw new Error(`project directory '${projectRoot}' does not exist`);
  }
  if (!stats.isDirectory()) {
    throw new Error(`project path '${projectRoot}' is not a directory`);
  }
}

function formatHost(host: string): string {
  if (host.includes(":") && !host.startsWith("[")) return `[${host}]`;
  return host;
}

export function hostAllowed(
  header: string | undefined,
  boundHost: string,
): boolean {
  if (header === undefined || header === "") return false;
  // Explicit opt-in to network access disables the rebinding guard by design.
  if (boundHost === "0.0.0.0" || boundHost === "::") return true;

  let hostname: string;
  if (header.startsWith("[")) {
    const end = header.indexOf("]");
    hostname = end === -1 ? header : header.slice(0, end + 1);
  } else {
    hostname = header.split(":")[0] ?? header;
  }

  const allowed = new Set([
    "127.0.0.1",
    "localhost",
    "[::1]",
    "::1",
    boundHost.toLowerCase(),
  ]);
  return allowed.has(hostname.toLowerCase());
}

async function listenOnPort(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
  host: string,
  startPort: number,
  strictPort: boolean,
): Promise<{ server: import("node:http").Server; port: number }> {
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
    : new Error("could not bind a development port");
}

function openBrowserUrl(url: string): void {
  let command: string;
  let args: string[];
  if (process.platform === "darwin") {
    command = "open";
    args = [url];
  } else if (process.platform === "win32") {
    command = "cmd";
    args = ["/c", "start", "", url];
  } else {
    command = "xdg-open";
    args = [url];
  }

  try {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
    });
    child.on("error", () => {
      // Opening a browser is best effort.
    });
    child.unref();
  } catch {
    // Opening a browser is best effort.
  }
}
