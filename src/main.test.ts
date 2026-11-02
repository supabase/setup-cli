import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { afterEach, expect, mock, spyOn, test } from "bun:test";
import * as core from "@actions/core";

const CLI_CONFIG_REGISTRY = "SUPABASE_INTERNAL_IMAGE_REGISTRY";
const RELEASES_URL = "https://github.com/supabase/cli/releases/download";
const RELEASE_PLATFORM = process.platform === "win32" ? "windows" : process.platform;
const RELEASE_ARCH = process.arch === "x64" ? "amd64" : process.arch;
const originalPath = process.env.PATH;
const originalNpmUserconfig = process.env.NPM_CONFIG_USERCONFIG;
const originalRunnerTemp = process.env.RUNNER_TEMP;
const originalWorkspace = process.env.GITHUB_WORKSPACE;
const originalImageRegistry = process.env.SUPABASE_INTERNAL_IMAGE_REGISTRY;
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
  if (originalRunnerTemp === undefined) {
    delete process.env.RUNNER_TEMP;
  } else {
    process.env.RUNNER_TEMP = originalRunnerTemp;
  }
  if (originalWorkspace === undefined) {
    delete process.env.GITHUB_WORKSPACE;
  } else {
    process.env.GITHUB_WORKSPACE = originalWorkspace;
  }
  if (originalImageRegistry === undefined) {
    delete process.env.SUPABASE_INTERNAL_IMAGE_REGISTRY;
  } else {
    process.env.SUPABASE_INTERNAL_IMAGE_REGISTRY = originalImageRegistry;
  }
  delete process.env.FAKE_CLI_VERSION;
  delete process.env.FAKE_NPM_BIN;
  delete process.env.FAKE_NPM_INTEGRITY;
  delete process.env.FAKE_NPM_CWD_LOG;
  delete process.env.FAKE_NPM_ENV_LOG;
  delete process.env.FAKE_NPM_LOG;
  delete process.env.FAKE_NPM_PACKAGE_VERSION;
  delete process.env.FAKE_NPM_PREFIX_CONFIG_LOG;
  delete process.env.FAKE_NPM_SCRIPTS;
  delete process.env.FAKE_NPM_VIEW_ERROR;
  delete process.env.FAKE_NPM_RANGE_RESULT;
  delete process.env.FAKE_NPM_RANGE_ERROR;
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

  if (!args.includes("bin") && process.env.FAKE_NPM_RANGE_RESULT !== undefined) {
    console.log(process.env.FAKE_NPM_RANGE_RESULT);
    process.exit(0);
  }

  if (!args.includes("bin") && process.env.FAKE_NPM_RANGE_ERROR) {
    console.error(process.env.FAKE_NPM_RANGE_ERROR);
    process.exit(1);
  }

  if (process.env.FAKE_NPM_VIEW_ERROR) {
    console.error(process.env.FAKE_NPM_VIEW_ERROR);
    process.exit(1);
  }

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

function viewRangeCall(spec: string): string[] {
  return ["view", spec, "version", "--json", "--offline=false"];
}

function viewMetadataCall(spec: string): string[] {
  return ["view", spec, "version", "bin", "scripts", "dist.integrity", "--json", "--offline=false"];
}

function createActionSpies(inputVersion: string) {
  return {
    addPath: spyOn(core, "addPath").mockImplementation(() => {}),
    exportVariable: spyOn(core, "exportVariable").mockImplementation(() => {}),
    getInput: spyOn(core, "getInput").mockReturnValue(inputVersion),
    info: spyOn(core, "info").mockImplementation(() => {}),
    setFailed: spyOn(core, "setFailed").mockImplementation(() => {}),
    setOutput: spyOn(core, "setOutput").mockImplementation(() => {}),
    warning: spyOn(core, "warning").mockImplementation(() => {}),
  };
}

function releaseUrl(version: string, filename: string): string {
  return `${RELEASES_URL}/v${version}/${filename}`;
}

function createReleaseArchive(cliVersion: string, binDir = ""): Uint8Array {
  const root = createTempDir("setup-cli-release-");
  const contents = path.join(root, "contents");
  const binPath = path.join(contents, binDir);
  mkdirSync(binPath, { recursive: true });

  if (process.platform === "win32") {
    writeFileSync(path.join(binPath, "supabase.cmd"), `@echo off\r\necho ${cliVersion}\r\n`);
  } else {
    writeFileSync(
      path.join(binPath, "supabase"),
      `#!/usr/bin/env bash\nprintf '%s\\n' '${cliVersion}'\n`,
      { mode: 0o755 },
    );
  }

  const archivePath = path.join(root, "archive.tar.gz");
  const tar = Bun.spawnSync(["tar", "-czf", archivePath, "-C", contents, "."]);
  if (tar.exitCode !== 0) {
    throw new Error(tar.stderr.toString());
  }

  return new Uint8Array(readFileSync(archivePath));
}

function sha256(bytes: Uint8Array): string {
  return new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
}

function serveRelease(version: string, assets: Record<string, string | Uint8Array>) {
  const requested: string[] = [];
  const responses = new Map(
    Object.entries(assets).map(([filename, body]) => [releaseUrl(version, filename), body]),
  );

  const respond = async (input: string | URL | Request) => {
    const url = input instanceof Request ? input.url : String(input);
    requested.push(url);
    const body = responses.get(url);
    return body === undefined ? new Response("Not Found", { status: 404 }) : new Response(body);
  };
  spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(respond, { preconnect: globalThis.fetch.preconnect }),
  );

  return { requested };
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

test("uses the next npm dist-tag when provided", async () => {
  const { resolvePackage } = await getMainModule();

  expect(resolvePackage("next")).toEqual({
    spec: "supabase@next",
    version: "next",
  });
});

test("uses v<N>.stable maintenance dist-tags when provided", async () => {
  const { resolvePackage } = await getMainModule();

  expect(resolvePackage("v2.stable")).toEqual({
    spec: "supabase@v2.stable",
    version: "v2.stable",
  });
  expect(resolvePackage("v10.stable")).toEqual({
    spec: "supabase@v10.stable",
    version: "v10.stable",
  });
  expect(resolvePackage(" V2.Stable ")).toEqual({
    spec: "supabase@v2.stable",
    version: "v2.stable",
  });
});

test("uses a prerelease npm package version when provided", async () => {
  const { resolvePackage } = await getMainModule();

  expect(resolvePackage("3.0.0-next.4")).toEqual({
    spec: "supabase@3.0.0-next.4",
    version: "3.0.0-next.4",
  });
});

test("rejects unsupported npm package selectors", async () => {
  const { resolvePackage } = await getMainModule();

  const message = (selector: string) =>
    `Unsupported Supabase CLI version "${selector}". Use latest, beta, next, v<N>.stable (like v2.stable), a fixed npm package version like 2.101.0, or a semver range like ^2.95 or 2.x.`;

  for (const selector of [
    "hotfix",
    "canary",
    "lastest",
    "garbage!",
    "stable",
    "v2.stable.1",
    "next2",
    "2.stable",
    "^1 ||",
    "- 2.0.0",
    "^2 -",
    "^^2",
  ]) {
    expect(() => resolvePackage(selector)).toThrow(message(selector));
  }
});

test("accepts npm semver ranges as version selectors", async () => {
  const { resolvePackage } = await getMainModule();

  for (const range of [
    "^2.95",
    "~2.98.0",
    "2.x",
    "2.98.*",
    "2",
    "v2",
    "2.90.0 - 2.98.0",
    ">=2.98 <2.99",
    "^1 || ^2",
  ]) {
    expect(resolvePackage(` ${range} `)).toEqual({ spec: `supabase@${range}`, version: range });
  }
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

  const { cliPath, source } = await installCli({
    spec: "supabase@2.101.0",
    version: "2.101.0",
  });

  expect(source).toBe("npm");
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

test("fails without a GitHub release fallback when lockfile integrity does not match the registry", async () => {
  installFakeNpm("supabase 2.101.0", { integrity: "sha512-registry" });
  const release = serveRelease("2.101.0", {});
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
  expect(release.requested).toEqual([]);
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
  expect(spies.setOutput).toHaveBeenCalledWith("install-source", "npm");
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

test("pins legacy installed CLI versions to GHCR", async () => {
  installFakeNpm("supabase 2.107.0");
  const spies = createActionSpies("2.107.0");
  const { run } = await getMainModule();

  await run();

  expect(spies.exportVariable).toHaveBeenCalledWith(CLI_CONFIG_REGISTRY, "ghcr.io");
  expect(spies.setFailed).not.toHaveBeenCalled();
});

test("uses the CLI registry fallback for installed versions that support it", async () => {
  installFakeNpm("supabase 2.108.0");
  const spies = createActionSpies("latest");
  const { run } = await getMainModule();

  await run();

  expect(spies.exportVariable).not.toHaveBeenCalled();
  expect(spies.setFailed).not.toHaveBeenCalled();
});

test("preserves an explicitly configured image registry for legacy CLI versions", async () => {
  installFakeNpm("supabase 2.107.0");
  process.env.SUPABASE_INTERNAL_IMAGE_REGISTRY = "registry.example.test";
  const spies = createActionSpies("2.107.0");
  const { run } = await getMainModule();

  await run();

  expect(spies.exportVariable).not.toHaveBeenCalled();
  expect(process.env.SUPABASE_INTERNAL_IMAGE_REGISTRY).toBe("registry.example.test");
  expect(spies.setFailed).not.toHaveBeenCalled();
});

test("installs the GitHub release when the npm-installed CLI cannot run", async () => {
  installFakeNpm("", { packageVersion: "2.101.0" });
  const archiveName = `supabase_2.101.0_${RELEASE_PLATFORM}_${RELEASE_ARCH}.tar.gz`;
  const archive = createReleaseArchive("2.101.0");
  const release = serveRelease("2.101.0", {
    "checksums.txt": `${sha256(archive)}  ${archiveName}\n`,
    [archiveName]: archive,
  });
  const spies = createActionSpies("2.101.0");
  const { run } = await getMainModule();

  await run();

  expect(spies.setFailed).not.toHaveBeenCalled();
  expect(spies.setOutput).toHaveBeenCalledWith("version", "2.101.0");
  expect(spies.setOutput).toHaveBeenCalledWith("install-source", "github-release");
  expect(spies.addPath).toHaveBeenCalledTimes(1);
  expect(spies.warning).toHaveBeenCalledWith(
    expect.stringContaining("installing v2.101.0 from its GitHub release instead"),
  );
  expect(release.requested).toEqual([
    releaseUrl("2.101.0", "checksums.txt"),
    releaseUrl("2.101.0", archiveName),
  ]);
});

test("installs the GitHub release of a pinned version when npm is unreachable", async () => {
  installFakeNpm("supabase 2.101.0");
  process.env.FAKE_NPM_VIEW_ERROR = "npm error code ETIMEDOUT";
  const archiveName = `supabase_2.101.0_${RELEASE_PLATFORM}_${RELEASE_ARCH}.tar.gz`;
  const archive = createReleaseArchive("2.101.0");
  serveRelease("2.101.0", {
    "checksums.txt": `${sha256(archive)}  ${archiveName}\n`,
    [archiveName]: archive,
  });
  const spies = createActionSpies("2.101.0");
  const { run } = await getMainModule();

  await run();

  expect(spies.setFailed).not.toHaveBeenCalled();
  expect(spies.setOutput).toHaveBeenCalledWith("install-source", "github-release");
});

test("fails without a GitHub release fallback when npm cannot resolve a dist-tag", async () => {
  installFakeNpm("supabase 2.101.0");
  process.env.FAKE_NPM_VIEW_ERROR = "npm error code ETIMEDOUT";
  const release = serveRelease("2.101.0", {});
  const spies = createActionSpies("latest");
  const { run } = await getMainModule();

  await run();

  expect(spies.setFailed).toHaveBeenCalledWith("npm error code ETIMEDOUT");
  expect(release.requested).toEqual([]);
});

test("installs the highest npm version that satisfies a caret range", async () => {
  const logPath = installFakeNpm("supabase 2.98.2");
  process.env.FAKE_NPM_RANGE_RESULT = JSON.stringify(["2.95.0", "2.98.2", "2.97.10", "2.98.1"]);
  const spies = createActionSpies("^2.95");
  const { run } = await getMainModule();

  await run();

  expect(spies.setFailed).not.toHaveBeenCalled();
  expect(spies.info).toHaveBeenCalledWith('Resolved Supabase CLI version "^2.95" to 2.98.2');
  expect(spies.setOutput).toHaveBeenCalledWith("version", "supabase 2.98.2");
  expect(spies.setOutput).toHaveBeenCalledWith("install-source", "npm");
  const calls = readNpmCalls(logPath);
  expect(calls[0]).toEqual(viewRangeCall("supabase@^2.95"));
  expect(calls[1]).toEqual(viewMetadataCall("supabase@2.98.2"));
  expect(calls[2]).toContain("supabase@2.98.2");
});

test("accepts x-ranges and comparator ranges", async () => {
  for (const range of ["2.x", ">=2.98 <2.99"]) {
    const logPath = installFakeNpm("supabase 2.98.1");
    process.env.FAKE_NPM_RANGE_RESULT = JSON.stringify(["2.98.0", "2.98.1"]);
    const spies = createActionSpies(range);
    const { run } = await getMainModule();

    await run();

    expect(spies.setFailed).not.toHaveBeenCalled();
    expect(readNpmCalls(logPath)[0]).toEqual(viewRangeCall(`supabase@${range}`));
    expect(readNpmCalls(logPath)[1]).toEqual(viewMetadataCall("supabase@2.98.1"));
    expect(spies.setOutput).toHaveBeenCalledWith("install-source", "npm");
  }
});

test("resolves a range that npm reports as a single JSON string", async () => {
  const logPath = installFakeNpm("supabase 2.98.0");
  process.env.FAKE_NPM_RANGE_RESULT = JSON.stringify("2.98.0");
  const spies = createActionSpies("~2.98.0");
  const { run } = await getMainModule();

  await run();

  expect(spies.setFailed).not.toHaveBeenCalled();
  expect(readNpmCalls(logPath)[1]).toEqual(viewMetadataCall("supabase@2.98.0"));
  expect(spies.setOutput).toHaveBeenCalledWith("install-source", "npm");
});

test("fails without a GitHub release fallback when no version satisfies a range", async () => {
  installFakeNpm("supabase 2.101.0");
  process.env.FAKE_NPM_RANGE_ERROR =
    "npm error code E404\nnpm error No match found for version ^99";
  const release = serveRelease("2.101.0", {});
  const spies = createActionSpies("^99");
  const { run } = await getMainModule();

  await run();

  expect(spies.setFailed).toHaveBeenCalledWith('No published Supabase CLI version matches "^99"');
  expect(release.requested).toEqual([]);
});

test("fails when npm returns no versions for a range", async () => {
  installFakeNpm("supabase 2.101.0");
  process.env.FAKE_NPM_RANGE_RESULT = "";
  const release = serveRelease("2.101.0", {});
  const spies = createActionSpies("^99");
  const { run } = await getMainModule();

  await run();

  expect(spies.setFailed).toHaveBeenCalledWith('No published Supabase CLI version matches "^99"');
  expect(release.requested).toEqual([]);
});

test("fails without a GitHub release fallback when npm cannot resolve a range", async () => {
  installFakeNpm("supabase 2.101.0");
  process.env.FAKE_NPM_RANGE_ERROR = "npm error code ETIMEDOUT";
  const release = serveRelease("2.101.0", {});
  const spies = createActionSpies("^2.95");
  const { run } = await getMainModule();

  await run();

  expect(spies.setFailed).toHaveBeenCalledWith("npm error code ETIMEDOUT");
  expect(release.requested).toEqual([]);
});

test("rejects a GitHub release archive that does not match its checksum", async () => {
  installFakeNpm("", { packageVersion: "2.101.0" });
  const archiveName = `supabase_2.101.0_${RELEASE_PLATFORM}_${RELEASE_ARCH}.tar.gz`;
  serveRelease("2.101.0", {
    "checksums.txt": `${"0".repeat(64)}  ${archiveName}\n`,
    [archiveName]: createReleaseArchive("2.101.0"),
  });
  const spies = createActionSpies("2.101.0");
  const { run } = await getMainModule();

  await run();

  expect(spies.setFailed).toHaveBeenCalledWith(
    expect.stringContaining(`Checksum mismatch for ${archiveName}`),
  );
  expect(spies.setOutput).not.toHaveBeenCalled();
  expect(spies.addPath).not.toHaveBeenCalled();
});

test("reports both failures when the GitHub release fallback also fails", async () => {
  installFakeNpm("", { packageVersion: "2.46.0" });
  process.env.GITHUB_WORKSPACE = createWorkspace({
    "package-lock.json": createPackageLock("2.46.0", "sha512-test"),
  });
  serveRelease("2.46.0", {});
  const spies = createActionSpies("");
  const { run } = await getMainModule();

  await run();

  expect(spies.setFailed).toHaveBeenCalledWith(
    "Could not determine installed Supabase CLI version\n" +
      "The GitHub release fallback for v2.46.0 also failed: " +
      "The v2.46.0 GitHub release has no checksums.txt or supabase_2.46.0_checksums.txt",
  );
  expect(spies.setOutput).not.toHaveBeenCalled();
  expect(spies.addPath).not.toHaveBeenCalled();
  expect(spies.exportVariable).not.toHaveBeenCalled();
});

test("selects the release archive that runs on the runner", async () => {
  const { selectReleaseAsset } = await getMainModule();
  const checksums = [
    "aaa  supabase_3.0.0_linux_amd64.tar.gz",
    "bbb  supabase_3.0.0_linux_amd64.apk",
    "ccc  supabase_3.0.0_windows_arm64.tar.gz",
  ].join("\n");

  expect(
    selectReleaseAsset("3.0.0", checksums, { platform: "linux", arch: "x64", musl: false }),
  ).toEqual({
    binDir: "",
    filename: "supabase_3.0.0_linux_amd64.tar.gz",
    sha256: "aaa",
  });
  expect(
    selectReleaseAsset("3.0.0", checksums, { platform: "linux", arch: "x64", musl: true }),
  ).toEqual({
    binDir: path.join("usr", "bin"),
    filename: "supabase_3.0.0_linux_amd64.apk",
    sha256: "bbb",
  });
  expect(
    selectReleaseAsset("3.0.0", checksums, { platform: "win32", arch: "arm64", musl: false })
      .filename,
  ).toBe("supabase_3.0.0_windows_arm64.tar.gz");
});

test("selects the unversioned archive from releases that predate versioned names", async () => {
  const { selectReleaseAsset } = await getMainModule();

  expect(
    selectReleaseAsset("1.178.2", "ddd  supabase_darwin_arm64.tar.gz\n", {
      platform: "darwin",
      arch: "arm64",
      musl: false,
    }).filename,
  ).toBe("supabase_darwin_arm64.tar.gz");
});

test("rejects runners that no release archive supports", async () => {
  const { selectReleaseAsset } = await getMainModule();

  expect(() =>
    selectReleaseAsset("3.0.0", "aaa  supabase_3.0.0_linux_amd64.tar.gz", {
      platform: "freebsd",
      arch: "x64",
      musl: false,
    }),
  ).toThrow("Supabase CLI releases have no binary for freebsd x64 runners");
});
