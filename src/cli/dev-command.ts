import { statSync } from "node:fs";
import { createDevServer, type DevServer } from "../server/dev-server.js";

interface DevArguments {
  readonly projectDir: string | undefined;
  readonly port: number | undefined;
  readonly portExplicit: boolean;
  readonly host: string | undefined;
  readonly basePath: string | undefined;
  readonly openBrowser: boolean;
  readonly poll: boolean;
}

export async function runDevCommand(
  rawArgs: readonly string[],
): Promise<void> {
  const parsed = parseDevArguments(rawArgs);
  if (parsed === null) process.exit(2);

  const projectRoot = parsed.projectDir ?? ".";

  let server: DevServer;
  try {
    server = await createDevServer({
      projectRoot,
      port: parsed.port,
      strictPort: parsed.portExplicit,
      host: parsed.host,
      basePath: parsed.basePath,
      openBrowser: parsed.openBrowser,
      poll: parsed.poll,
    });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    const message = error instanceof Error ? error.message : String(error);
    if (code === "EADDRINUSE") {
      console.error(
        `kadam dev: port ${parsed.port ?? 3000} is already in use. Choose another --port or stop the process using it.`,
      );
    } else {
      console.error(`kadam dev: ${message}`);
    }
    process.exit(1);
  }

  const status = server.getStatus();
  console.log(`kadam dev: watching ${projectRoot}`);
  console.log(
    status.phase === "success"
      ? `kadam dev: ${status.routes.length} page${
          status.routes.length === 1 ? "" : "s"
        } ready`
      : "kadam dev: waiting for a successful build",
  );
  console.log(`kadam dev: serving ${server.url}`);
  console.log("kadam dev: press Ctrl+C to stop");

  let stopping = false;
  const stop = (): void => {
    if (stopping) {
      process.exit(1);
    }
    stopping = true;
    console.log("\nkadam dev: stopping…");
    void server.close();
  };

  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  await server.closed;
  console.log("kadam dev: stopped.");
  process.exit(0);
}

function parseDevArguments(
  rawArgs: readonly string[],
): DevArguments | null {
  let projectDir: string | undefined;
  let port: number | undefined;
  let portExplicit = false;
  let host: string | undefined;
  let basePath: string | undefined;
  let noOpen = false;
  let poll = false;

  for (let index = 0; index < rawArgs.length; index += 1) {
    const argument = rawArgs[index]!;

    if (argument === "--project" || argument === "-p") {
      const value = rawArgs[index + 1];
      if (value === undefined || value === "") {
        console.error("kadam dev: --project requires a directory path");
        return null;
      }
      projectDir = value;
      index += 1;
      continue;
    }
    if (argument.startsWith("--project=")) {
      const value = argument.slice("--project=".length);
      if (value === "") {
        console.error("kadam dev: --project requires a directory path");
        return null;
      }
      projectDir = value;
      continue;
    }
    if (argument === "--port" || argument === "-P") {
      const value = rawArgs[index + 1];
      if (value === undefined || value === "") {
        console.error("kadam dev: --port requires a number");
        return null;
      }
      const parsedPort = Number(value);
      if (
        !Number.isInteger(parsedPort) ||
        parsedPort < 0 ||
        parsedPort > 65535
      ) {
        console.error(
          `kadam dev: invalid port ${JSON.stringify(value)}; expected 0-65535`,
        );
        return null;
      }
      port = parsedPort;
      portExplicit = true;
      index += 1;
      continue;
    }
    if (argument.startsWith("--port=")) {
      const value = argument.slice("--port=".length);
      const parsedPort = Number(value);
      if (
        value === "" ||
        !Number.isInteger(parsedPort) ||
        parsedPort < 0 ||
        parsedPort > 65535
      ) {
        console.error(
          `kadam dev: invalid port ${JSON.stringify(value)}; expected 0-65535`,
        );
        return null;
      }
      port = parsedPort;
      portExplicit = true;
      continue;
    }
    if (argument === "--host") {
      const value = rawArgs[index + 1];
      if (value === undefined || value === "") {
        console.error("kadam dev: --host requires an interface");
        return null;
      }
      host = value;
      index += 1;
      continue;
    }
    if (argument.startsWith("--host=")) {
      const value = argument.slice("--host=".length);
      if (value === "") {
        console.error("kadam dev: --host requires an interface");
        return null;
      }
      host = value;
      continue;
    }
    if (argument === "--base-path" || argument === "-b") {
      const value = rawArgs[index + 1];
      if (value === undefined || value === "") {
        console.error("kadam dev: --base-path requires a path string");
        return null;
      }
      basePath = value;
      index += 1;
      continue;
    }
    if (argument.startsWith("--base-path=")) {
      const value = argument.slice("--base-path=".length);
      if (value === "") {
        console.error("kadam dev: --base-path requires a path string");
        return null;
      }
      basePath = value;
      continue;
    }
    if (argument === "--no-open") {
      noOpen = true;
      continue;
    }
    if (argument === "--poll") {
      poll = true;
      continue;
    }
    if (argument.startsWith("-")) {
      console.error(
        `kadam dev: unexpected argument ${JSON.stringify(argument)}`,
      );
      return null;
    }
    if (projectDir !== undefined) {
      console.error(
        `kadam dev: unexpected argument ${JSON.stringify(argument)}`,
      );
      return null;
    }
    projectDir = argument;
  }

  if (projectDir !== undefined && !isDirectory(projectDir)) {
    console.error(
      `kadam dev: ${projectDir} is not a directory; dev needs a project containing kadam.json`,
    );
    return null;
  }
  if (host !== undefined && parsedHostIsPublic(host)) {
    console.warn(
      `kadam dev: binding ${host} exposes the preview and its generated files to the network.`,
    );
  }

  return {
    projectDir,
    port,
    portExplicit,
    host,
    basePath,
    openBrowser:
      !noOpen &&
      process.stdout.isTTY === true &&
      process.env.CI === undefined,
    poll,
  };
}

function parsedHostIsPublic(host: string): boolean {
  return host !== "127.0.0.1" && host !== "localhost" && host !== "::1";
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
