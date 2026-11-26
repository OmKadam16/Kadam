import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/**
 * D-44 step 3: `kadam dev` runs the project's generated server (from the
 * server module) as a child process and sends `/_kadam/` requests to it.
 *
 * The child gets its own copy of the server files and the built pages (it
 * reads a page to answer a form sent without JavaScript). It is restarted
 * only when the server code changes; page edits are just rewritten.
 */

export interface AppServerFile {
  readonly path: string;
  readonly contents: string | Uint8Array;
  readonly kind: string;
}

export class AppServer {
  readonly #logger: (message: string) => void;
  readonly #dir = mkdtempSync(join(tmpdir(), "kadam-dev-server-"));
  #child: ChildProcess | null = null;
  #ready: Promise<number | null> = Promise.resolve(null);
  #code = "";
  #closed = false;

  constructor(logger: (message: string) => void) {
    this.#logger = logger;
  }

  /** True when the project has a server module. */
  get active(): boolean {
    return this.#child !== null;
  }

  /** Bring the child in line with the latest successful build. */
  sync(files: readonly AppServerFile[]): void {
    if (this.#closed) return;
    const server = files.filter((file) => file.kind === "server");
    if (server.length === 0) {
      this.#stop();
      this.#code = "";
      return;
    }
    for (const file of [...server, ...files.filter((candidate) => candidate.kind === "html")]) {
      const target = join(this.#dir, file.path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, file.contents);
    }
    const code = server.map((file) => `${file.path}\n${String(file.contents)}`).join("\n");
    if (code === this.#code && this.#child !== null) return;
    this.#code = code;
    this.#stop();
    this.#start();
  }

  #start(): void {
    const child = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", join(this.#dir, "server", "server.ts")], {
      env: { ...process.env, PORT: "0", HOST: "127.0.0.1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.#child = child;
    this.#ready = new Promise((resolveReady) => {
      let output = "";
      const lines = (stream: NodeJS.ReadableStream, error: boolean): void => {
        let partial = "";
        stream.on("data", (chunk: Buffer) => {
          const text = partial + chunk.toString("utf8");
          const parts = text.split("\n");
          partial = parts.pop() ?? "";
          for (const line of parts) {
            output += `${line}\n`;
            const match = /^Kadam server: http:\/\/[^:]+:(\d+)\//.exec(line);
            if (match !== null) {
              resolveReady(Number(match[1]));
              continue;
            }
            this.#logger(`${error ? "[server error]" : "[server]"} ${line}`);
          }
        });
      };
      lines(child.stdout!, false);
      lines(child.stderr!, true);
      child.on("exit", (code) => {
        if (this.#child === child) this.#child = null;
        resolveReady(null);
        if (!this.#closed && code !== null && code !== 0) this.#logger(`[server] stopped with code ${code}${output === "" ? "" : `:\n${output}`}`);
      });
    });
  }

  #stop(): void {
    const child = this.#child;
    this.#child = null;
    this.#ready = Promise.resolve(null);
    child?.kill();
  }

  /** Forward one request to the child, or answer 503 when it is not running. */
  async proxy(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const port = await this.#ready;
    if (port === null) {
      res.writeHead(503, { "content-type": "application/json" }).end('{"error":"the Kadam server is not running"}');
      return;
    }
    const upstream = httpRequest(
      { host: "127.0.0.1", port, method: req.method, path: req.url, headers: req.headers },
      (answer) => {
        res.writeHead(answer.statusCode ?? 502, answer.headers);
        answer.pipe(res);
      },
    );
    upstream.on("error", () => {
      if (!res.headersSent) res.writeHead(502, { "content-type": "application/json" });
      res.end('{"error":"the Kadam server did not answer"}');
    });
    req.pipe(upstream);
  }

  close(): void {
    this.#closed = true;
    this.#stop();
    rmSync(this.#dir, { recursive: true, force: true });
  }
}
