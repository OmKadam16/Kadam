import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { createStudioServer } from "./server.js";

interface CliOptions {
  readonly projectRoot: string;
  readonly host: string;
  readonly port: number;
  readonly strictPort: boolean;
  readonly open: boolean;
}

const USAGE = `Kadam Studio

Usage:
  kadam-studio [project-directory] [options]

Options:
  --port <number>    Studio port (default: 4310)
  --host <address>   Bind address (default: 127.0.0.1)
  --strict-port      Fail instead of trying the next port
  --open             Open the Studio URL in the default browser
  --help             Show this message
`;

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options === null) {
    process.stdout.write(USAGE);
    return;
  }

  const server = await createStudioServer({
    projectRoot: options.projectRoot,
    host: options.host,
    port: options.port,
    strictPort: options.strictPort,
  });

  console.log(`kadam studio: ${server.url}`);
  console.log(`kadam studio: project ${resolve(options.projectRoot)}`);

  if (options.open) openBrowser(server.url);

  let shuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    await server.close();
    process.exit(0);
  };

  process.once("SIGINT", () => {
    void shutdown();
  });
  process.once("SIGTERM", () => {
    void shutdown();
  });
}

function parseArgs(args: readonly string[]): CliOptions | null {
  let projectRoot = process.cwd();
  let host = "127.0.0.1";
  let port = Number(process.env.KADAM_STUDIO_PORT ?? "4310");
  let strictPort = false;
  let open = false;
  let sawProject = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === "--help" || argument === "-h") return null;
    if (argument === "--strict-port") {
      strictPort = true;
      continue;
    }
    if (argument === "--open") {
      open = true;
      continue;
    }
    if (argument === "--port") {
      const value = args[index + 1];
      if (value === undefined || !Number.isInteger(Number(value))) {
        throw new Error("--port requires an integer");
      }
      port = Number(value);
      index += 1;
      continue;
    }
    if (argument === "--host") {
      const value = args[index + 1];
      if (value === undefined) throw new Error("--host requires an address");
      host = value;
      index += 1;
      continue;
    }
    if (argument.startsWith("-")) {
      throw new Error(`unknown option '${argument}'`);
    }
    if (sawProject) throw new Error("only one project directory may be given");
    projectRoot = resolve(argument);
    sawProject = true;
  }

  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error("port must be an integer between 0 and 65535");
  }

  return { projectRoot, host, port, strictPort, open };
}

function openBrowser(url: string): void {
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
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    child.on("error", () => {
      // Opening a browser is best effort.
    });
    child.unref();
  } catch {
    // Opening a browser is best effort.
  }
}

main().catch((error: unknown) => {
  console.error(
    `kadam studio: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
