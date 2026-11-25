import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { compileV02Text } from "../dist/v02/compile.js";

const runFile = promisify(execFile);
const cli = fileURLToPath(new URL("../dist/cli/main.js", import.meta.url));
const python = process.env.PYTHON ?? "python3";

function compile(source, target, path = "demo.kdm") {
  return compileV02Text(path, source, target === undefined ? {} : { target });
}

function writeOutput(result, directory) {
  mkdirSync(directory, { recursive: true });
  for (const file of result.files) {
    writeFileSync(join(directory, file.path), file.contents);
  }
  return directory;
}

async function execute(command, args, cwd) {
  return runFile(command, args, { cwd });
}

async function executeFailure(command, args, cwd) {
  try {
    await execute(command, args, cwd);
  } catch (error) {
    return error;
  }
  assert.fail(`${command} ${args.join(" ")} unexpectedly succeeded`);
}

const conformanceSource = `kadam 0.2

module conformance {
    record Person {
        name as text
        age as number
    }

    function factorial takes n as number and returns number {
        if n <= 1 {
            return 1
        } otherwise {
            return n * factorial(n - 1)
        }
    }

    function choose takes flag as boolean and returns text {
        if flag {
            return "yes"
        } otherwise {
            return "no"
        }
    }

    function main takes nothing and returns number {
        let person be Person { name: "Kadam", age: 2 }
        output "hello"
        output person.name
        output choose(true)
        output choose(false)

        var count be 0
        while count < 3 {
            output count
            set count to count + 1
        }

        let values as list of number be [3, 5, 8]
        output length(values)
        output values[1]
        output factorial(5)
        return 0
    }
}
`;

test("v0.2 conformance runs identically on TypeScript and Python", async () => {
  const expected =
    "hello\nKadam\nyes\nno\n0\n1\n2\n3\n5\n120\n";
  for (const [target, command, file] of [
    ["typescript", process.execPath, "main.ts"],
    ["python", python, "main.py"],
  ]) {
    const result = compile(conformanceSource, target, "conformance.kdm");
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics, null, 2));
    const directory = writeOutput(
      result,
      mkdtempSync(join(tmpdir(), `kadam-v02-${target}-`)),
    );
    const { stdout, stderr } = await execute(command, [file], directory);
    assert.equal(stderr, "");
    assert.equal(stdout, expected);
  }
});

test("v0.2 maps nested lists, record lists, and empty records on both targets", async () => {
  const source = `kadam 0.2

module shapes {
    record Empty {
    }

    record Person {
        name as text
        tags as list of text
    }

    function makeEmpty takes nothing and returns Empty {
        return Empty {}
    }

    function main takes nothing and returns number {
        let person be Person { name: "Ada", tags: ["math", "code"] }
        let people as list of Person be [person]
        let nested as list of list of number be [[1, 2], [3]]
        let flags as list of boolean be []
        let empty as Empty be makeEmpty()
        output length(people)
        output people[0].name
        output length(people[0].tags)
        output nested[1][0]
        output length(flags)
        output not false
        output true and false
        output false or true
        return 0
    }
}
`;
  const expected = "1\nAda\n2\n3\n0\ntrue\nfalse\ntrue\n";
  for (const [target, command, file] of [
    ["typescript", process.execPath, "main.ts"],
    ["python", python, "main.py"],
  ]) {
    const result = compile(source, target, "shapes.kdm");
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics, null, 2));
    const directory = writeOutput(
      result,
      mkdtempSync(join(tmpdir(), `kadam-v02-shapes-${target}-`)),
    );
    assert.equal((await execute(command, [file], directory)).stdout, expected);
  }
});

test("v0.2 file effects round-trip through both runtimes", async () => {
  const source = `kadam 0.2

module files {
    function main takes nothing and returns number {
        writeText("data.txt", "hello\\nworld")
        output readText("data.txt")
        return 0
    }
}
`;
  for (const [target, command, file] of [
    ["typescript", process.execPath, "main.ts"],
    ["python", python, "main.py"],
  ]) {
    const result = compile(source, target, "files.kdm");
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics, null, 2));
    assert.equal(result.module.functions[0].effects.includes("io.output"), true);
    assert.equal(
      result.module.functions[0].effects.includes("io.file.read"),
      true,
    );
    assert.equal(
      result.module.functions[0].effects.includes("io.file.write"),
      true,
    );
    const directory = writeOutput(
      result,
      mkdtempSync(join(tmpdir(), `kadam-v02-files-${target}-`)),
    );
    const { stdout } = await execute(command, [file], directory);
    assert.equal(stdout, "hello\nworld\n");
  }
});

test("v0.2 external providers link on both targets", async () => {
  const source = `kadam 0.2

module externalDemo {
    external function twice takes value as number and returns number {
        provided by "typescript" as "./native.ts#twice"
        provided by "python" as "native#twice"
    }

    function main takes nothing and returns number {
        output twice(21)
        return 0
    }
}
`;
  const typescript = compile(source, "typescript", "externalDemo.kdm");
  assert.equal(typescript.ok, true, JSON.stringify(typescript.diagnostics, null, 2));
  const tsDirectory = writeOutput(
    typescript,
    mkdtempSync(join(tmpdir(), "kadam-v02-external-ts-")),
  );
  writeFileSync(
    join(tsDirectory, "native.ts"),
    "export function twice(value: number): number { return value * 2; }\n",
  );
  assert.equal((await execute(process.execPath, ["main.ts"], tsDirectory)).stdout, "42\n");

  const pythonResult = compile(source, "python", "externalDemo.kdm");
  assert.equal(
    pythonResult.ok,
    true,
    JSON.stringify(pythonResult.diagnostics, null, 2),
  );
  const pyDirectory = writeOutput(
    pythonResult,
    mkdtempSync(join(tmpdir(), "kadam-v02-external-py-")),
  );
  writeFileSync(
    join(pyDirectory, "native.py"),
    "def twice(value):\n    return value * 2\n",
  );
  assert.equal((await execute(python, ["main.py"], pyDirectory)).stdout, "42\n");
});

test("v0.2 rejects missing providers and unsupported effects before writing", () => {
  const missingProvider = `kadam 0.2

module missingProvider {
    external function getEnv takes name as text and returns text {
        provided by "python" as "os#getenv"
    }

    function main takes nothing and returns number {
        output getEnv("HOME")
        return 0
    }
}
`;
  const missing = compile(missingProvider, "typescript", "missingProvider.kdm");
  assert.equal(missing.ok, false);
  assert.equal(missing.files.length, 0);
  assert.equal(missing.diagnostics.some((item) => item.code === "KDM5008"), true);

  const unsupported = `kadam 0.2

module unsupported {
    external function ping takes host as text and returns text {
        provided by "typescript" as "./native.ts#ping"
        affects network.request
    }

    function main takes nothing and returns number {
        output ping("localhost")
        return 0
    }
}
`;
  const effect = compile(unsupported, "typescript", "unsupported.kdm");
  assert.equal(effect.ok, false);
  assert.equal(effect.files.length, 0);
  assert.equal(effect.diagnostics.some((item) => item.code === "KDM5009"), true);
});

test("v0.2 rejects immutable assignment and discarded values", () => {
  const source = `kadam 0.2

module rejected {
    function main takes nothing and returns number {
        let value be 1
        set value to 2
        1 + 2
        output [1, 2]
        return 0
    }
}
`;
  const result = compile(source, "typescript", "rejected.kdm");
  assert.equal(result.ok, false);
  assert.equal(result.files.length, 0);
  assert.equal(result.diagnostics.some((item) => item.code === "KDM5007"), true);
  assert.equal(result.diagnostics.some((item) => item.code === "KDM5013"), true);
  assert.equal(result.diagnostics.some((item) => item.code === "KDM5006"), true);
});

test("v0.2 reports stable static diagnostics and emits nothing", () => {
  const source = `kadam 0.2

module broken {
    function main takes nothing and returns number {
        let wrong as number be "text"
        let value be 1
        if value {
            output wrong
        }
        return 0
    }
}
`;
  const result = compile(source, "typescript", "broken.kdm");
  assert.equal(result.ok, false);
  assert.equal(result.files.length, 0);
  assert.equal(result.diagnostics.some((item) => item.code === "KDM5006"), true);
  assert.equal(result.diagnostics.some((item) => item.code === "KDM5011"), true);
});

test("v0.2 runtime failures return status 1 on both runtimes", async () => {
  const division = `kadam 0.2

module division {
    function main takes nothing and returns number {
        output 8 / 0
        return 0
    }
}
`;
  const index = `kadam 0.2

module index {
    function main takes nothing and returns number {
        let values as list of number be [1]
        output values[2]
        return 0
    }
}
`;
  for (const [target, command, file] of [
    ["typescript", process.execPath, "main.ts"],
    ["python", python, "main.py"],
  ]) {
    for (const [source, moduleName, category] of [
      [division, "division", "division by zero"],
      [index, "index", "list index out of bounds"],
    ]) {
      const result = compile(source, target, `${moduleName}.kdm`);
      assert.equal(result.ok, true, JSON.stringify(result.diagnostics, null, 2));
      const directory = writeOutput(
        result,
        mkdtempSync(join(tmpdir(), `kadam-v02-${moduleName}-${target}-`)),
      );
      const error = await executeFailure(command, [file], directory);
      assert.equal(error.code, 1);
      assert.match(error.stderr, new RegExp(category));
    }
  }
});

test("v0.2 output is byte-identical across repeated builds", () => {
  for (const target of ["typescript", "python"]) {
    const first = compile(conformanceSource, target, "conformance.kdm");
    const second = compile(conformanceSource, target, "conformance.kdm");
    assert.deepEqual(first.files, second.files);
  }
});

test("kadam parse, check, and build route v0.2 modules", async () => {
  const directory = mkdtempSync(join(tmpdir(), "kadam-v02-cli-"));
  const sourcePath = join(directory, "cliDemo.kdm");
  writeFileSync(
    sourcePath,
    `kadam 0.2

module cliDemo {
    function main takes nothing and returns number {
        output "cli"
        return 0
    }
}
`,
  );

  const parsed = await execute(process.execPath, [cli, "parse", sourcePath], directory);
  const ast = JSON.parse(parsed.stdout);
  assert.equal(ast.type, "module");
  assert.equal(ast.name, "cliDemo");

  const checked = await execute(
    process.execPath,
    [cli, "check", "--target", "python", sourcePath],
    directory,
  );
  assert.match(checked.stdout, /module cliDemo for target python/);

  const outDir = join(directory, "out");
  const built = await execute(
    process.execPath,
    [cli, "build", sourcePath, "--target", "python", "--out", outDir],
    directory,
  );
  assert.match(built.stdout, /target python/);
  const executed = await execute(python, ["main.py"], outDir);
  assert.equal(executed.stdout, "cli\n");
});
