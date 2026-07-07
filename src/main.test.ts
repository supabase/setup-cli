import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { afterEach, expect, mock, spyOn, test } from "bun:test";
import * as core from "@actions/core";

const CLI_CONFIG_REGISTRY = "SUPABASE_INTERNAL_IMAGE_REGISTRY";
const originalPath = process.env.PATH;
const originalNpmUserconfig = process.env.NPM_CONFIG_USERCONFIG;
const originalRunnerTemp = process.env.RUNNER_TEMP;
const originalWorkspace = process.env.GITHUB_WORKSPACE;
const tempDirs = new Set<string>();
let mainModule: typeof import("./main.ts") | null = null;

afterEach(() => {
  mock.restore();
  process.env.PATH = originalPath;
  if (originalNpmUserconfig === undefined) {
    delete process.env.NPM_CONFIG_USERCONFIG;
  } else {
    process.env.NPM_CONFIG_USERCONFIG = originalNpmUserconfig;
  }
  process.env.RUNNER_TEMP = originalRunnerTemp;
  process.env.GITHUB_WORKSPACE = originalWorkspace;
  delete process.env.FAKE_CLI_VERSION;
  delete process.env.FAKE_NPM_BIN;
  delete process.env.FAKE_NPM_INTEGRITY;
  delete process.env.FAKE_NPM_CWD_LOG;
  delete process.env.FAKE_NPM_ENV_LOG;
  delete process.env.FAKE_NPM_LOG;
  delete process.env.FAKE_NPM_PACKAGE_VERSION;
  delete process.env.FAKE_NPM_PREFIX_CONFIG_LOG;
  delete process.env.FAKE_NPM_SCRIPTS;
  delete process.env.SETUP_CLI_TEST_WORKSPACE;
  delete process.env.SUPABASE_SETUP_CLI_NPM;

  for (const dir of tempDirs) {
    rmSync(dir, { force: true, recursive: true });
  }
  tempDirs.clear();
});

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.add(dir);
  return dir;
}

function createWorkspace(files: Record<string, string>): string {
  const dir = createTempDir("setup-cli-workspace-");

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
    integrity?: string;
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
      "${options.integrity ?? "sha512-bun"}"
    ]`
    : ""
}
  }
}
`;
}

function createPnpmLock(
  version: string,
  options: {
    asString?: boolean;
    includeVersion?: boolean;
    integrity?: string;
    useDevDependency?: boolean;
  } = {},
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
      integrity: ${options.integrity ?? "sha512-pnpm"}
`;
}

function createPackageLock(version: string, integrity = "sha512-package-lock"): string {
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
          integrity,
          version,
        },
      },
    },
    null,
    2,
  );
}

function createFakeNpm(): string {
  const root = createTempDir("setup-cli-fake-npm-");
  const binDir = path.join(root, "bin");
  const scriptPath = path.join(root, "fake-npm.js");
  mkdirSync(binDir, { recursive: true });
  writeFileSync(
    scriptPath,
    `import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
appendFileSync(process.env.FAKE_NPM_LOG, JSON.stringify(args) + "\\n");
appendFileSync(process.env.FAKE_NPM_CWD_LOG, process.cwd() + "\\n");
appendFileSync(
  process.env.FAKE_NPM_ENV_LOG,
  JSON.stringify({ NPM_CONFIG_USERCONFIG: process.env.NPM_CONFIG_USERCONFIG ?? null }) + "\\n",
);

function recordConfig(configPath) {
  appendFileSync(
    process.env.FAKE_NPM_PREFIX_CONFIG_LOG,
    JSON.stringify(existsSync(configPath) ? readFileSync(configPath, "utf8") : null) + "\\n",
  );
}

if (args[0] === "view") {
  recordConfig(path.join(process.cwd(), ".npmrc"));

  const bin =
    process.env.FAKE_NPM_BIN === "missing"
      ? undefined
      : { supabase: process.env.FAKE_NPM_BIN ?? "dist/supabase.js" };
  const scripts = process.env.FAKE_NPM_SCRIPTS ? JSON.parse(process.env.FAKE_NPM_SCRIPTS) : {};

  console.log(
    JSON.stringify({
      version: process.env.FAKE_NPM_PACKAGE_VERSION ?? "2.101.0",
      bin,
      scripts,
      "dist.integrity": process.env.FAKE_NPM_INTEGRITY ?? "sha512-test",
    }),
  );
  process.exit(0);
}

if (args[0] !== "install") {
  console.error("Unexpected npm command: " + args.join(" "));
  process.exit(1);
}

const prefixIndex = args.indexOf("--prefix");
const prefix = prefixIndex === -1 ? undefined : args[prefixIndex + 1];
if (!prefix) {
  console.error("Missing --prefix");
  process.exit(1);
}

const binDir = path.join(prefix, "node_modules", ".bin");
mkdirSync(binDir, { recursive: true });
recordConfig(path.join(prefix, ".npmrc"));

if (process.platform === "win32") {
  writeFileSync(
    path.join(binDir, "supabase.cmd"),
    process.env.FAKE_CLI_VERSION ? "@echo off\\r\\necho " + process.env.FAKE_CLI_VERSION + "\\r\\n" : "@echo off\\r\\n",
  );
} else {
  writeFileSync(
    path.join(binDir, "supabase"),
    process.env.FAKE_CLI_VERSION
      ? "#!/usr/bin/env bash\\nprintf '%s\\\\n' '" + process.env.FAKE_CLI_VERSION.replaceAll("'", "'\\\\''") + "'\\n"
      : "#!/usr/bin/env bash\\n",
    { mode: 0o755 },
  );
}
`,
  );

  if (process.platform === "win32") {
    writeFileSync(
      path.join(binDir, "npm.cmd"),
      `@echo off\r\n"${process.execPath}" "${scriptPath}" %*\r\n`,
    );
  } else {
    writeFileSync(
      path.join(binDir, "npm"),
      `#!/usr/bin/env bash\nexec "${process.execPath}" "${scriptPath}" "$@"\n`,
      { mode: 0o755 },
    );
  }

  return binDir;
}

function installFakeNpm(
  versionOutput = "supabase 2.101.0",
  options: {
    bin?: string;
    integrity?: string;
    packageVersion?: string;
    scripts?: Record<string, string>;
  } = {},
): string {
  const binDir = createFakeNpm();
  const cwdLogPath = path.join(createTempDir("setup-cli-fake-npm-cwd-log-"), "npm-cwd.log");
  const envLogPath = path.join(createTempDir("setup-cli-fake-npm-env-log-"), "npm-env.log");
  const logPath = path.join(createTempDir("setup-cli-fake-npm-log-"), "npm.log");
  const prefixConfigLogPath = path.join(
    createTempDir("setup-cli-fake-npm-prefix-config-log-"),
    "npm-prefix-config.log",
  );
  writeFileSync(cwdLogPath, "");
  writeFileSync(envLogPath, "");
  writeFileSync(logPath, "");
  writeFileSync(prefixConfigLogPath, "");
  process.env.FAKE_CLI_VERSION = versionOutput;
  process.env.FAKE_NPM_BIN = options.bin ?? "dist/supabase.js";
  process.env.FAKE_NPM_CWD_LOG = cwdLogPath;
  process.env.FAKE_NPM_ENV_LOG = envLogPath;
  process.env.FAKE_NPM_INTEGRITY = options.integrity ?? "sha512-test";
  process.env.FAKE_NPM_LOG = logPath;
  process.env.FAKE_NPM_PACKAGE_VERSION =
    options.packageVersion ??
    versionOutput.match(/\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/)?.[0] ??
    "2.101.0";
  if (options.scripts) {
    process.env.FAKE_NPM_SCRIPTS = JSON.stringify(options.scripts);
  }
  process.env.PATH = `${binDir}${path.delimiter}${originalPath ?? ""}`;
  process.env.RUNNER_TEMP = createTempDir("setup-cli-runner-temp-");
  process.env.SUPABASE_SETUP_CLI_NPM = path.join(
    binDir,
    process.platform === "win32" ? "npm.cmd" : "npm",
  );
  process.env.FAKE_NPM_PREFIX_CONFIG_LOG = prefixConfigLogPath;

  return logPath;
}

function readNpmCalls(logPath: string): string[][] {
  return readFileSync(logPath, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as string[]);
}

function readNpmCwds(): string[] {
  return readFileSync(process.env.FAKE_NPM_CWD_LOG ?? "", "utf8")
    .trim()
    .split("\n")
    .filter(Boolean);
}

function readNpmEnvs(): Array<{ NPM_CONFIG_USERCONFIG: string | null }> {
  return readFileSync(process.env.FAKE_NPM_ENV_LOG ?? "", "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { NPM_CONFIG_USERCONFIG: string | null });
}

function readNpmPrefixConfigs(): Array<string | null> {
  return readFileSync(process.env.FAKE_NPM_PREFIX_CONFIG_LOG ?? "", "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as string | null);
}

function viewMetadataCall(spec: string): string[] {
  return ["view", spec, "version", "bin", "scripts", "dist.integrity", "--json", "--offline=false"];
}

function createActionSpies(inputVersion: string) {
  return {
    addPath: spyOn(core, "addPath").mockImplementation(() => {}),
    exportVariable: spyOn(core, "exportVariable").mockImplementation(() => {}),
    getInput: spyOn(core, "getInput").mockReturnValue(inputVersion),
    setFailed: spyOn(core, "setFailed").mockImplementation(() => {}),
    setOutput: spyOn(core, "setOutput").mockImplementation(() => {}),
  };
}

async function getMainModule(): Promise<typeof import("./main.ts")> {
  if (!mainModule) {
    mainModule = await import("./main.ts");
  }

  return mainModule;
}

test("uses an explicit npm package version when provided", async () => {
  const { resolvePackage } = await getMainModule();

  expect(resolvePackage("v2.101.0")).toEqual({
    spec: "supabase@2.101.0",
    version: "2.101.0",
  });
});

test("uses an explicit npm dist-tag when provided", async () => {
  const { resolvePackage } = await getMainModule();

  expect(resolvePackage("beta")).toEqual({
    spec: "supabase@beta",
    version: "beta",
  });
});

test("rejects unsupported npm package selectors", async () => {
  const { resolvePackage } = await getMainModule();

  expect(() => resolvePackage("hotfix")).toThrow(
    'Unsupported Supabase CLI version "hotfix". Use latest, beta, or a fixed npm package version like 2.101.0.',
  );
});

test("uses the root bun.lock resolution when version is omitted", async () => {
  process.env.GITHUB_WORKSPACE = createWorkspace({
    "bun.lock": createBunLock("2.41.0", { integrity: "sha512-bun-lock" }),
  });
  const { resolvePackage } = await getMainModule();

  expect(resolvePackage("")).toEqual({
    integrity: "sha512-bun-lock",
    spec: "supabase@2.41.0",
    version: "2.41.0",
  });
});

test("uses the root pnpm-lock.yaml resolution when version is omitted", async () => {
  process.env.GITHUB_WORKSPACE = createWorkspace({
    "pnpm-lock.yaml": createPnpmLock("2.42.0", { integrity: "sha512-pnpm-lock" }),
  });
  const { resolvePackage } = await getMainModule();

  expect(resolvePackage("")).toEqual({
    integrity: "sha512-pnpm-lock",
    spec: "supabase@2.42.0",
    version: "2.42.0",
  });
});

test("uses the root package-lock.json resolution when version is omitted", async () => {
  process.env.GITHUB_WORKSPACE = createWorkspace({
    "package-lock.json": createPackageLock("2.43.0", "sha512-package-lock"),
  });
  const { resolvePackage } = await getMainModule();

  expect(resolvePackage("")).toEqual({
    integrity: "sha512-package-lock",
    spec: "supabase@2.43.0",
    version: "2.43.0",
  });
});

test("falls through malformed lockfiles and uses the next supported root lockfile", async () => {
  process.env.GITHUB_WORKSPACE = createWorkspace({
    "bun.lock": "{ not valid",
    "package-lock.json": createPackageLock("2.44.0"),
  });
  const { resolvePackage } = await getMainModule();

  expect(resolvePackage("")).toEqual({
    integrity: "sha512-package-lock",
    spec: "supabase@2.44.0",
    version: "2.44.0",
  });
});

test("falls back to latest when version is omitted and no supported root lockfile is present", async () => {
  process.env.GITHUB_WORKSPACE = createWorkspace({
    "README.md": "# app\n",
  });
  const { resolvePackage } = await getMainModule();

  expect(resolvePackage("")).toEqual({
    spec: "supabase@latest",
    version: "latest",
  });
});

test("falls back to latest when version is omitted and no workspace is available", async () => {
  delete process.env.GITHUB_WORKSPACE;
  const { resolvePackage } = await getMainModule();

  expect(resolvePackage("")).toEqual({
    spec: "supabase@latest",
    version: "latest",
  });
});

test("uses the declared bun.lock version when the resolved package entry is missing", async () => {
  process.env.GITHUB_WORKSPACE = createWorkspace({
    "bun.lock": createBunLock("2.44.1", { includePackageEntry: false, useDevDependency: true }),
  });
  const { resolvePackage } = await getMainModule();

  expect(resolvePackage("")).toEqual({
    spec: "supabase@2.44.1",
    version: "2.44.1",
  });
});

test("falls through bun.lock without supabase and uses a pnpm string dependency version", async () => {
  process.env.GITHUB_WORKSPACE = createWorkspace({
    "bun.lock": createBunLock("2.47.0", { includeDependency: false }),
    "pnpm-lock.yaml": createPnpmLock("2.47.0", { asString: true }),
  });
  const { resolvePackage } = await getMainModule();

  expect(resolvePackage("")).toEqual({
    integrity: "sha512-pnpm",
    spec: "supabase@2.47.0",
    version: "2.47.0",
  });
});

test("falls back to latest when a pnpm dependency entry has no concrete version", async () => {
  process.env.GITHUB_WORKSPACE = createWorkspace({
    "pnpm-lock.yaml": createPnpmLock("2.49.0", { includeVersion: false }),
  });
  const { resolvePackage } = await getMainModule();

  expect(resolvePackage("")).toEqual({
    spec: "supabase@latest",
    version: "latest",
  });
});

test("installs the CLI with npm into an isolated prefix", async () => {
  const logPath = installFakeNpm();
  const { installCli } = await getMainModule();

  const cliPath = await installCli({
    spec: "supabase@2.101.0",
    version: "2.101.0",
  });

  expect(cliPath).toContain(`${path.sep}node_modules${path.sep}.bin`);
  expect(readNpmCalls(logPath)).toEqual([
    viewMetadataCall("supabase@2.101.0"),
    [
      "install",
      "--prefix",
      expect.any(String),
      "--omit=dev",
      "--include=optional",
      "--no-audit",
      "--no-fund",
      "--no-package-lock",
      "--offline=false",
      "--bin-links=true",
      "--ignore-scripts=true",
      "supabase@2.101.0",
    ],
  ]);
});

test("runs npm with caller workspace config and action-owned overrides", async () => {
  const workspace = createWorkspace({
    ".npmrc": [
      "registry=https://registry.example.test",
      "@internal:registry=https://registry.internal.example.test",
      "//registry.example.test/:_authToken=${NPM_TOKEN}",
      "//registry.example.test/:certfile=certs/client.pem",
      "//registry.example.test/:keyfile=certs/client-key.pem",
      "always-auth",
      'cafile="certs/project-ca.pem"',
      'userconfig="${SETUP_CLI_TEST_WORKSPACE}/.npmrc-ci"',
      "globalconfig=.npmrc-global",
      "bin-links=false",
      "offline=true",
      "package-lock=true",
    ].join("\n"),
    ".npmrc-ci": [
      "registry=https://delegated-registry.example.test",
      "//registry.example.test/:_password=delegated",
      "cafile=certs/delegated-ca.pem",
      "bin-links=false",
      "offline=true",
    ].join("\n"),
    ".npmrc-global": [
      "registry=https://global-registry.example.test",
      "//registry.example.test/:username=global",
    ].join("\n"),
    "certs/client-key.pem": "client-key",
    "certs/client.pem": "client",
    "certs/delegated-ca.pem": "delegated-ca",
    "certs/project-ca.pem": "project-ca",
  });
  process.env.SETUP_CLI_TEST_WORKSPACE = workspace;
  const userconfigPath = path.join(createTempDir("setup-cli-userconfig-"), ".npmrc");
  writeFileSync(userconfigPath, "//registry.example.test/:username=existing\n");
  process.env.NPM_CONFIG_USERCONFIG = userconfigPath;
  process.env.GITHUB_WORKSPACE = workspace;
  const logPath = installFakeNpm();
  const { installCli } = await getMainModule();

  await installCli({
    spec: "supabase@2.101.0",
    version: "2.101.0",
  });

  const realWorkspace = realpathSync(workspace);
  const npmCwds = readNpmCwds().map((cwd) => realpathSync(cwd));
  expect(npmCwds).toEqual([realWorkspace, realWorkspace]);
  expect(readNpmEnvs().map((env) => env.NPM_CONFIG_USERCONFIG)).toEqual([
    userconfigPath,
    userconfigPath,
  ]);
  expect(readNpmPrefixConfigs()).toEqual([
    readFileSync(path.join(workspace, ".npmrc"), "utf8"),
    null,
  ]);
  expect(readNpmCalls(logPath)).toEqual([
    viewMetadataCall("supabase@2.101.0"),
    [
      "install",
      "--prefix",
      expect.any(String),
      "--omit=dev",
      "--include=optional",
      "--no-audit",
      "--no-fund",
      "--no-package-lock",
      "--offline=false",
      "--bin-links=true",
      "--ignore-scripts=true",
      "supabase@2.101.0",
    ],
  ]);
});

test("allows install scripts for legacy npm packages that declare a preinstall", async () => {
  const logPath = installFakeNpm("supabase 1.15.1", {
    bin: "bin/supabase",
    scripts: { preinstall: "node scripts/preinstall.js" },
  });
  const { installCli } = await getMainModule();

  await installCli({
    spec: "supabase@1.15.1",
    version: "1.15.1",
  });

  expect(readNpmCalls(logPath)).toEqual([
    viewMetadataCall("supabase@1.15.1"),
    [
      "install",
      "--prefix",
      expect.any(String),
      "--omit=dev",
      "--include=optional",
      "--no-audit",
      "--no-fund",
      "--no-package-lock",
      "--offline=false",
      "--bin-links=true",
      "--ignore-scripts=false",
      "supabase@1.15.1",
    ],
  ]);
});

test("allows install scripts for npm packages that declare a postinstall", async () => {
  const logPath = installFakeNpm("supabase 1.178.2", {
    bin: "bin/supabase",
    scripts: { postinstall: "node scripts/postinstall.js" },
  });
  const { installCli } = await getMainModule();

  await installCli({
    spec: "supabase@1.178.2",
    version: "1.178.2",
  });

  expect(readNpmCalls(logPath)).toEqual([
    viewMetadataCall("supabase@1.178.2"),
    [
      "install",
      "--prefix",
      expect.any(String),
      "--omit=dev",
      "--include=optional",
      "--no-audit",
      "--no-fund",
      "--no-package-lock",
      "--offline=false",
      "--bin-links=true",
      "--ignore-scripts=false",
      "supabase@1.178.2",
    ],
  ]);
});

test("verifies lockfile integrity before installing", async () => {
  const logPath = installFakeNpm("supabase 2.101.0", { integrity: "sha512-lock" });
  const { installCli } = await getMainModule();

  await installCli({
    integrity: "sha512-lock",
    spec: "supabase@2.101.0",
    version: "2.101.0",
  });

  expect(readNpmCalls(logPath)).toEqual([
    viewMetadataCall("supabase@2.101.0"),
    [
      "install",
      "--prefix",
      expect.any(String),
      "--omit=dev",
      "--include=optional",
      "--no-audit",
      "--no-fund",
      "--no-package-lock",
      "--offline=false",
      "--bin-links=true",
      "--ignore-scripts=true",
      "supabase@2.101.0",
    ],
  ]);
});

test("fails when lockfile integrity does not match the registry", async () => {
  installFakeNpm("supabase 2.101.0", { integrity: "sha512-registry" });
  const { installCli } = await getMainModule();

  try {
    await installCli({
      integrity: "sha512-lock",
      spec: "supabase@2.101.0",
      version: "2.101.0",
    });
    throw new Error("Expected installCli to reject");
  } catch (error) {
    expect(error).toEqual(
      new Error("Lockfile integrity for supabase@2.101.0 does not match the npm registry"),
    );
  }
});

test("fails when the npm package does not expose a Supabase CLI executable", async () => {
  installFakeNpm("supabase 2.101.0", { bin: "missing" });
  const { installCli } = await getMainModule();

  try {
    await installCli({
      spec: "supabase@2.101.0",
      version: "2.101.0",
    });
    throw new Error("Expected installCli to reject");
  } catch (error) {
    expect(error).toEqual(
      new Error("The npm package supabase@2.101.0 does not expose a supabase executable"),
    );
  }
});

test("runs the action with a package-lock resolution", async () => {
  const logPath = installFakeNpm("supabase 2.43.0", { integrity: "sha512-package-lock" });
  process.env.GITHUB_WORKSPACE = createWorkspace({
    "package-lock.json": createPackageLock("2.43.0", "sha512-package-lock"),
  });
  const spies = createActionSpies("");
  const { run } = await getMainModule();

  await run();

  expect(readNpmCalls(logPath)[0]).toEqual(viewMetadataCall("supabase@2.43.0"));
  expect(spies.setOutput).toHaveBeenCalledWith("version", "supabase 2.43.0");
  expect(spies.addPath).toHaveBeenCalledWith(expect.stringContaining("node_modules"));
  expect(spies.exportVariable).toHaveBeenCalledWith(CLI_CONFIG_REGISTRY, "ghcr.io");
  expect(spies.setFailed).not.toHaveBeenCalled();
});

test("explicit version overrides detected root lockfiles", async () => {
  installFakeNpm("supabase 1.1.6");
  process.env.GITHUB_WORKSPACE = createWorkspace({
    "bun.lock": createBunLock("2.45.0"),
  });
  const spies = createActionSpies("1.1.6");
  const { run } = await getMainModule();

  await run();

  expect(spies.setOutput).toHaveBeenCalledWith("version", "supabase 1.1.6");
  expect(spies.exportVariable).not.toHaveBeenCalled();
  expect(spies.setFailed).not.toHaveBeenCalled();
});

test("fails when the installed CLI does not report a version", async () => {
  installFakeNpm("");
  process.env.GITHUB_WORKSPACE = createWorkspace({
    "package-lock.json": createPackageLock("2.46.0", "sha512-test"),
  });
  const spies = createActionSpies("");
  const { run } = await getMainModule();

  await run();

  expect(spies.setFailed).toHaveBeenCalledWith(
    "Could not determine installed Supabase CLI version",
  );
  expect(spies.setOutput).not.toHaveBeenCalled();
  expect(spies.addPath).not.toHaveBeenCalled();
  expect(spies.exportVariable).not.toHaveBeenCalled();
});
