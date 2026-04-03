import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { afterEach, expect, mock, spyOn, test } from "bun:test";
import * as core from "@actions/core";
import * as tc from "@actions/tool-cache";

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const defaultEntrypoint = fileURLToPath(new URL("./main.ts", import.meta.url));
const CLI_CONFIG_REGISTRY = "SUPABASE_INTERNAL_IMAGE_REGISTRY";
const tempDirs = new Set<string>();
let mainModule: typeof import("./main.ts") | null = null;

afterEach(() => {
  mock.restore();
  for (const dir of tempDirs) {
    rmSync(dir, { force: true, recursive: true });
  }
  tempDirs.clear();
});

function createFakeCli(versionOutput: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "setup-cli-"));
  tempDirs.add(dir);

  if (process.platform === "win32") {
    writeFileSync(
      path.join(dir, "supabase.cmd"),
      versionOutput ? `@echo off\r\necho ${versionOutput}\r\n` : "@echo off\r\n",
    );
    return dir;
  }

  const escapedOutput = versionOutput.replaceAll("'", "'\"'\"'");
  writeFileSync(
    path.join(dir, "supabase"),
    versionOutput
      ? `#!/usr/bin/env bash\nprintf '%s\\n' '${escapedOutput}'\n`
      : "#!/usr/bin/env bash\n",
  );
  Bun.spawnSync(["chmod", "+x", path.join(dir, "supabase")]);
  return dir;
}

function createActionSpies(version: string, cliDir: string) {
  return {
    getInput: spyOn(core, "getInput").mockReturnValue(version),
    setOutput: spyOn(core, "setOutput").mockImplementation(() => {}),
    addPath: spyOn(core, "addPath").mockImplementation(() => {}),
    exportVariable: spyOn(core, "exportVariable").mockImplementation(() => {}),
    setFailed: spyOn(core, "setFailed").mockImplementation(() => {}),
    downloadTool: spyOn(tc, "downloadTool").mockImplementation(async (url: string) => {
      expect(url).toContain(
        `/${version === "latest" ? "latest/download" : `download/v${version}`}/`,
      );
      return path.join(os.tmpdir(), "supabase-cli.tar.gz");
    }),
    extractTar: spyOn(tc, "extractTar").mockImplementation(async () => cliDir),
  };
}

async function getMainModule(): Promise<typeof import("./main.ts")> {
  if (!mainModule) {
    mainModule = await import("./main.ts");
  }

  return mainModule;
}

async function waitForCalls(assertion: () => void): Promise<void> {
  let failure: Error | null = null;

  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      failure = error instanceof Error ? error : new Error(String(error));
      await Bun.sleep(10);
    }
  }

  throw failure ?? new Error("Timed out waiting for action side effects");
}

test("runs the action entrypoint with the default version", async () => {
  const action = Bun.YAML.parse(readFileSync(path.join(repo, "action.yml"), "utf8")) as {
    inputs: { version: { default: string } };
  };
  const cliDir = createFakeCli(`supabase ${action.inputs.version.default}`);
  const spies = createActionSpies(action.inputs.version.default, cliDir);
  const originalArgv1 = process.argv[1];
  process.argv[1] = defaultEntrypoint;

  try {
    mainModule = await import("./main.ts");
    await waitForCalls(() => {
      expect(spies.setOutput).toHaveBeenCalledWith(
        "version",
        `supabase ${action.inputs.version.default}`,
      );
      expect(spies.addPath).toHaveBeenCalledWith(cliDir);
    });
  } finally {
    process.argv[1] = originalArgv1 ?? "";
  }

  expect(spies.exportVariable).toHaveBeenCalledWith(CLI_CONFIG_REGISTRY, "ghcr.io");
  expect(spies.setFailed).not.toHaveBeenCalled();
});

test("installs the latest CLI and exports the registry env var", async () => {
  const cliDir = createFakeCli("supabase 2.84.2");
  const spies = createActionSpies("latest", cliDir);
  const { run } = await getMainModule();

  await run();

  expect(spies.downloadTool).toHaveBeenCalledTimes(1);
  expect(spies.setOutput).toHaveBeenCalledWith("version", "supabase 2.84.2");
  expect(spies.addPath).toHaveBeenCalledWith(cliDir);
  expect(spies.exportVariable).toHaveBeenCalledWith(CLI_CONFIG_REGISTRY, "ghcr.io");
  expect(spies.setFailed).not.toHaveBeenCalled();
});

test("installs a legacy CLI without exporting the registry env var", async () => {
  const cliDir = createFakeCli("supabase 1.0.0");
  const spies = createActionSpies("1.0.0", cliDir);
  const { run } = await getMainModule();

  await run();

  expect(spies.downloadTool).toHaveBeenCalledWith(
    expect.stringContaining("/download/v1.0.0/supabase_1.0.0_"),
  );
  expect(spies.setOutput).toHaveBeenCalledWith("version", "supabase 1.0.0");
  expect(spies.addPath).toHaveBeenCalledWith(cliDir);
  expect(spies.exportVariable).not.toHaveBeenCalled();
  expect(spies.setFailed).not.toHaveBeenCalled();
});

test("installs a modern pinned CLI and exports the registry env var", async () => {
  const cliDir = createFakeCli("supabase 2.84.2");
  const spies = createActionSpies("2.84.2", cliDir);
  const { run } = await getMainModule();

  await run();

  expect(spies.downloadTool).toHaveBeenCalledWith(
    expect.stringContaining("/download/v2.84.2/supabase_"),
  );
  expect(spies.downloadTool).not.toHaveBeenCalledWith(
    expect.stringContaining("/download/v2.84.2/supabase_2.84.2_"),
  );
  expect(spies.setOutput).toHaveBeenCalledWith("version", "supabase 2.84.2");
  expect(spies.exportVariable).toHaveBeenCalledWith(CLI_CONFIG_REGISTRY, "ghcr.io");
  expect(spies.setFailed).not.toHaveBeenCalled();
});

test("fails when the installed CLI does not report a version", async () => {
  const cliDir = createFakeCli("");
  const spies = createActionSpies("2.84.2", cliDir);
  const { run } = await getMainModule();

  await run();

  expect(spies.setFailed).toHaveBeenCalledWith(
    "Could not determine installed Supabase CLI version",
  );
  expect(spies.setOutput).not.toHaveBeenCalled();
  expect(spies.addPath).not.toHaveBeenCalled();
  expect(spies.exportVariable).not.toHaveBeenCalled();
});
