import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
const originalWorkspace = process.env.GITHUB_WORKSPACE;
const tempDirs = new Set<string>();
let mainModule: typeof import("./main.ts") | null = null;

afterEach(() => {
  mock.restore();
  process.env.GITHUB_WORKSPACE = originalWorkspace;

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

function createWorkspace(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "setup-cli-workspace-"));
  tempDirs.add(dir);

  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = path.join(dir, relativePath);
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, content);
  }

  return dir;
}

function createBunLock(
  version: string,
  options: {
    includeDependency?: boolean;
    includePackageEntry?: boolean;
    useDevDependency?: boolean;
  } = {},
): string {
  const includeDependency = options.includeDependency ?? true;
  const includePackageEntry = options.includePackageEntry ?? true;
  const dependencyKey = options.useDevDependency ? "devDependencies" : "dependencies";

  return `{
  "lockfileVersion": 1,
  "configVersion": 1,
  "workspaces": {
    "": {
      "name": "app",
      "${dependencyKey}": {
${includeDependency ? `        "supabase": "^${version}"` : ""}
      }
    }
  },
  "packages": {
${
  includePackageEntry
    ? `    "supabase": [
      "supabase@${version}",
      "",
      {},
      "sha512-test"
    ]`
    : ""
}
  }
}
`;
}

function createPnpmLock(
  version: string,
  options: { asString?: boolean; includeVersion?: boolean; useDevDependency?: boolean } = {},
): string {
  const dependencyKey = options.useDevDependency ? "devDependencies" : "dependencies";

  return `lockfileVersion: "9.0"
importers:
  .:
    ${dependencyKey}:
${
  options.asString
    ? `      supabase: ${version}`
    : `      supabase:
        specifier: ^${version}
${options.includeVersion === false ? "" : `        version: ${version}`}`
}
packages:
  supabase@${version}:
    resolution:
      integrity: sha512-test
`;
}

function createPackageLock(version: string): string {
  return JSON.stringify(
    {
      name: "app",
      lockfileVersion: 3,
      packages: {
        "": {
          dependencies: {
            supabase: `^${version}`,
          },
        },
        "node_modules/supabase": {
          version,
        },
      },
    },
    null,
    2,
  );
}

function createActionSpies(inputVersion: string, cliDir: string, expectedUrlFragment: string) {
  return {
    getInput: spyOn(core, "getInput").mockReturnValue(inputVersion),
    setOutput: spyOn(core, "setOutput").mockImplementation(() => {}),
    addPath: spyOn(core, "addPath").mockImplementation(() => {}),
    exportVariable: spyOn(core, "exportVariable").mockImplementation(() => {}),
    setFailed: spyOn(core, "setFailed").mockImplementation(() => {}),
    downloadTool: spyOn(tc, "downloadTool").mockImplementation(async (url: string) => {
      expect(url).toContain(expectedUrlFragment);
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

test("awaits the action entrypoint with omitted version and latest fallback", async () => {
  process.env.GITHUB_WORKSPACE = repo;
  const cliDir = createFakeCli("supabase 2.84.2");
  let startDownload!: () => void;
  let finishDownload!: () => void;
  const downloadStarted = new Promise<void>((resolve) => {
    startDownload = resolve;
  });
  const downloadFinished = new Promise<string>((resolve) => {
    finishDownload = () => resolve(path.join(os.tmpdir(), "supabase-cli.tar.gz"));
  });
  const spies = {
    getInput: spyOn(core, "getInput").mockReturnValue(""),
    setOutput: spyOn(core, "setOutput").mockImplementation(() => {}),
    addPath: spyOn(core, "addPath").mockImplementation(() => {}),
    exportVariable: spyOn(core, "exportVariable").mockImplementation(() => {}),
    setFailed: spyOn(core, "setFailed").mockImplementation(() => {}),
    downloadTool: spyOn(tc, "downloadTool").mockImplementation(async (url: string) => {
      expect(url).toContain("/latest/download/");
      startDownload();
      return downloadFinished;
    }),
    extractTar: spyOn(tc, "extractTar").mockImplementation(async () => cliDir),
  };
  const originalArgv1 = process.argv[1];
  process.argv[1] = defaultEntrypoint;

  try {
    let importSettled = false;
    const entrypoint = import(`./main.ts?entrypoint=${Date.now()}`).finally(() => {
      importSettled = true;
    });

    await downloadStarted;
    await Bun.sleep(0);

    expect(importSettled).toBe(false);

    finishDownload();
    await entrypoint;
  } finally {
    process.argv[1] = originalArgv1 ?? "";
  }

  expect(spies.setOutput).toHaveBeenCalledWith("version", "supabase 2.84.2");
  expect(spies.addPath).toHaveBeenCalledWith(cliDir);
  expect(spies.exportVariable).toHaveBeenCalledWith(CLI_CONFIG_REGISTRY, "ghcr.io");
  expect(spies.setFailed).not.toHaveBeenCalled();
});

test("uses the root bun.lock version when version is omitted", async () => {
  process.env.GITHUB_WORKSPACE = createWorkspace({
    "bun.lock": createBunLock("2.41.0"),
  });
  const cliDir = createFakeCli("supabase 2.41.0");
  const spies = createActionSpies("", cliDir, "/download/v2.41.0/supabase_");
  const { run } = await getMainModule();

  await run();

  expect(spies.downloadTool).not.toHaveBeenCalledWith(expect.stringContaining("/latest/download/"));
  expect(spies.setOutput).toHaveBeenCalledWith("version", "supabase 2.41.0");
  expect(spies.exportVariable).toHaveBeenCalledWith(CLI_CONFIG_REGISTRY, "ghcr.io");
  expect(spies.setFailed).not.toHaveBeenCalled();
});

test("uses the root pnpm-lock.yaml version when version is omitted", async () => {
  process.env.GITHUB_WORKSPACE = createWorkspace({
    "pnpm-lock.yaml": createPnpmLock("2.42.0"),
  });
  const cliDir = createFakeCli("supabase 2.42.0");
  const spies = createActionSpies("", cliDir, "/download/v2.42.0/supabase_");
  const { run } = await getMainModule();

  await run();

  expect(spies.setOutput).toHaveBeenCalledWith("version", "supabase 2.42.0");
  expect(spies.exportVariable).toHaveBeenCalledWith(CLI_CONFIG_REGISTRY, "ghcr.io");
  expect(spies.setFailed).not.toHaveBeenCalled();
});

test("uses the root package-lock.json version when version is omitted", async () => {
  process.env.GITHUB_WORKSPACE = createWorkspace({
    "package-lock.json": createPackageLock("2.43.0"),
  });
  const cliDir = createFakeCli("supabase 2.43.0");
  const spies = createActionSpies("", cliDir, "/download/v2.43.0/supabase_");
  const { run } = await getMainModule();

  await run();

  expect(spies.setOutput).toHaveBeenCalledWith("version", "supabase 2.43.0");
  expect(spies.exportVariable).toHaveBeenCalledWith(CLI_CONFIG_REGISTRY, "ghcr.io");
  expect(spies.setFailed).not.toHaveBeenCalled();
});

test("falls through malformed lockfiles and uses the next supported root lockfile", async () => {
  process.env.GITHUB_WORKSPACE = createWorkspace({
    "bun.lock": "{ not valid",
    "package-lock.json": createPackageLock("2.44.0"),
  });
  const cliDir = createFakeCli("supabase 2.44.0");
  const spies = createActionSpies("", cliDir, "/download/v2.44.0/supabase_");
  const { run } = await getMainModule();

  await run();

  expect(spies.setOutput).toHaveBeenCalledWith("version", "supabase 2.44.0");
  expect(spies.exportVariable).toHaveBeenCalledWith(CLI_CONFIG_REGISTRY, "ghcr.io");
  expect(spies.setFailed).not.toHaveBeenCalled();
});

test("falls back to latest when version is omitted and no supported root lockfile is present", async () => {
  process.env.GITHUB_WORKSPACE = createWorkspace({
    "README.md": "# app\n",
  });
  const cliDir = createFakeCli("supabase 2.84.2");
  const spies = createActionSpies("", cliDir, "/latest/download/");
  const { run } = await getMainModule();

  await run();

  expect(spies.setOutput).toHaveBeenCalledWith("version", "supabase 2.84.2");
  expect(spies.exportVariable).toHaveBeenCalledWith(CLI_CONFIG_REGISTRY, "ghcr.io");
  expect(spies.setFailed).not.toHaveBeenCalled();
});

test("falls back to latest when version is omitted and no workspace is available", async () => {
  delete process.env.GITHUB_WORKSPACE;
  const cliDir = createFakeCli("supabase 2.84.2");
  const spies = createActionSpies("", cliDir, "/latest/download/");
  const { run } = await getMainModule();

  await run();

  expect(spies.setOutput).toHaveBeenCalledWith("version", "supabase 2.84.2");
  expect(spies.exportVariable).toHaveBeenCalledWith(CLI_CONFIG_REGISTRY, "ghcr.io");
  expect(spies.setFailed).not.toHaveBeenCalled();
});

test("uses the declared bun.lock version when the resolved package entry is missing", async () => {
  process.env.GITHUB_WORKSPACE = createWorkspace({
    "bun.lock": createBunLock("2.44.1", { includePackageEntry: false, useDevDependency: true }),
  });
  const cliDir = createFakeCli("supabase 2.44.1");
  const spies = createActionSpies("", cliDir, "/download/v2.44.1/supabase_");
  const { run } = await getMainModule();

  await run();

  expect(spies.setOutput).toHaveBeenCalledWith("version", "supabase 2.44.1");
  expect(spies.exportVariable).toHaveBeenCalledWith(CLI_CONFIG_REGISTRY, "ghcr.io");
  expect(spies.setFailed).not.toHaveBeenCalled();
});

test("falls through bun.lock without supabase and uses a pnpm string dependency version", async () => {
  process.env.GITHUB_WORKSPACE = createWorkspace({
    "bun.lock": createBunLock("2.47.0", { includeDependency: false }),
    "pnpm-lock.yaml": createPnpmLock("2.47.0", { asString: true }),
  });
  const cliDir = createFakeCli("supabase 2.47.0");
  const spies = createActionSpies("", cliDir, "/download/v2.47.0/supabase_");
  const { run } = await getMainModule();

  await run();

  expect(spies.setOutput).toHaveBeenCalledWith("version", "supabase 2.47.0");
  expect(spies.exportVariable).toHaveBeenCalledWith(CLI_CONFIG_REGISTRY, "ghcr.io");
  expect(spies.setFailed).not.toHaveBeenCalled();
});

test("falls through malformed pnpm lockfiles and uses the next supported root lockfile", async () => {
  process.env.GITHUB_WORKSPACE = createWorkspace({
    "pnpm-lock.yaml": "not: [valid",
    "package-lock.json": createPackageLock("2.48.0"),
  });
  const cliDir = createFakeCli("supabase 2.48.0");
  const spies = createActionSpies("", cliDir, "/download/v2.48.0/supabase_");
  const { run } = await getMainModule();

  await run();

  expect(spies.setOutput).toHaveBeenCalledWith("version", "supabase 2.48.0");
  expect(spies.exportVariable).toHaveBeenCalledWith(CLI_CONFIG_REGISTRY, "ghcr.io");
  expect(spies.setFailed).not.toHaveBeenCalled();
});

test("falls through unreadable bun.lock paths and malformed package-lock files to latest", async () => {
  const workspace = createWorkspace({
    "package-lock.json": "{ invalid",
  });
  mkdirSync(path.join(workspace, "bun.lock"), { recursive: true });
  process.env.GITHUB_WORKSPACE = workspace;
  const cliDir = createFakeCli("supabase 2.84.2");
  const spies = createActionSpies("", cliDir, "/latest/download/");
  const { run } = await getMainModule();

  await run();

  expect(spies.setOutput).toHaveBeenCalledWith("version", "supabase 2.84.2");
  expect(spies.exportVariable).toHaveBeenCalledWith(CLI_CONFIG_REGISTRY, "ghcr.io");
  expect(spies.setFailed).not.toHaveBeenCalled();
});

test("falls back to latest when a pnpm dependency entry has no concrete version", async () => {
  process.env.GITHUB_WORKSPACE = createWorkspace({
    "pnpm-lock.yaml": createPnpmLock("2.49.0", { includeVersion: false }),
  });
  const cliDir = createFakeCli("supabase 2.84.2");
  const spies = createActionSpies("", cliDir, "/latest/download/");
  const { run } = await getMainModule();

  await run();

  expect(spies.setOutput).toHaveBeenCalledWith("version", "supabase 2.84.2");
  expect(spies.exportVariable).toHaveBeenCalledWith(CLI_CONFIG_REGISTRY, "ghcr.io");
  expect(spies.setFailed).not.toHaveBeenCalled();
});

test("explicit version overrides detected root lockfiles", async () => {
  process.env.GITHUB_WORKSPACE = createWorkspace({
    "bun.lock": createBunLock("2.45.0"),
  });
  const cliDir = createFakeCli("supabase 1.0.0");
  const spies = createActionSpies("1.0.0", cliDir, "/download/v1.0.0/supabase_1.0.0_");
  const { run } = await getMainModule();

  await run();

  expect(spies.setOutput).toHaveBeenCalledWith("version", "supabase 1.0.0");
  expect(spies.exportVariable).not.toHaveBeenCalled();
  expect(spies.setFailed).not.toHaveBeenCalled();
});

test("fails when the installed CLI does not report a version", async () => {
  process.env.GITHUB_WORKSPACE = createWorkspace({
    "package-lock.json": createPackageLock("2.46.0"),
  });
  const cliDir = createFakeCli("");
  const spies = createActionSpies("", cliDir, "/download/v2.46.0/supabase_");
  const { run } = await getMainModule();

  await run();

  expect(spies.setFailed).toHaveBeenCalledWith(
    "Could not determine installed Supabase CLI version",
  );
  expect(spies.setOutput).not.toHaveBeenCalled();
  expect(spies.addPath).not.toHaveBeenCalled();
  expect(spies.exportVariable).not.toHaveBeenCalled();
});
