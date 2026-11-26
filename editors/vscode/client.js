// A minimal Language Server Protocol client over stdio, with no dependencies.
// It knows nothing about VS Code, so it can be tested on its own.
"use strict";

const { spawn } = require("node:child_process");

class LspClient {
  constructor(command, args, options = {}) {
    this.child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"], cwd: options.cwd, shell: process.platform === "win32" });
    this.buffer = Buffer.alloc(0);
    this.nextId = 1;
    this.pending = new Map();
    this.handlers = new Map();
    this.onError = options.onError ?? (() => {});
    this.child.stdout.on("data", (chunk) => this.receive(chunk));
    this.child.stderr.on("data", (chunk) => this.onError(chunk.toString("utf8")));
    this.child.on("error", (error) => this.onError(error.message));
    this.child.on("exit", () => {
      for (const { reject } of this.pending.values()) reject(new Error("the Kadam language server stopped"));
      this.pending.clear();
    });
  }

  receive(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const end = this.buffer.indexOf("\r\n\r\n");
      if (end === -1) return;
      const match = /Content-Length: (\d+)/i.exec(this.buffer.subarray(0, end).toString("ascii"));
      if (match === null) {
        this.buffer = this.buffer.subarray(end + 4);
        continue;
      }
      const length = Number(match[1]);
      if (this.buffer.length < end + 4 + length) return;
      const message = JSON.parse(this.buffer.subarray(end + 4, end + 4 + length).toString("utf8"));
      this.buffer = this.buffer.subarray(end + 4 + length);
      if (message.id !== undefined && this.pending.has(message.id) && message.method === undefined) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result);
      } else if (message.method !== undefined) {
        const handler = this.handlers.get(message.method);
        if (handler) handler(message.params);
      }
    }
  }

  write(message) {
    const body = Buffer.from(JSON.stringify({ jsonrpc: "2.0", ...message }), "utf8");
    this.child.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
    this.child.stdin.write(body);
  }

  request(method, params) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.write({ id, method, params });
    });
  }

  notify(method, params) {
    this.write({ method, params });
  }

  on(method, handler) {
    this.handlers.set(method, handler);
  }

  async stop() {
    try {
      await this.request("shutdown", null);
      this.notify("exit", null);
    } catch {
      this.child.kill();
    }
  }
}

module.exports = { LspClient };
