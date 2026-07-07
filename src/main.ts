import { semver } from "bun";
import * as core from "@actions/core";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const CLI_CONFIG_REGISTRY = "SUPABASE_INTERNAL_IMAGE_REGISTRY";
const REGISTRY_VERSION = "1.28.0";
const DEFAULT_VERSION = "latest";
const NPM_PACKAGE = "supabase";
const NPM_EXECUTABLE_ENV = "SUPABASE_SETUP_CLI_NPM";
const INSTALL_LIFECYCLE_SCRIPTS = ["preinstall", "install", "postinstall"] as const;
const SUPPORTED_DIST_TAGS = new Set([DEFAULT_VERSION, "beta"]);
const CONCRETE_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const CONCRETE_VERSION_EXTRACT_PATTERN = /\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?/;

type PackageResolution = {
  spec: string;
  version: string;
  integrity?: string;
};

type PackageMetadata = {
  version?: unknown;
  bin?: unknown;
  scripts?: unknown;
  "dist.integrity"?: unknown;
};

type BunLock = {
  workspaces?: {
    "": {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
  };
  packages?: Record<string, unknown>;
};

type PnpmDependency =
  | string
  | {
      version?: string;
    };

type PnpmPackage = {
  resolution?: {
    integrity?: string;
  };
};

type PnpmLock = {
  importers?: {
    ".": {
      dependencies?: Record<string, PnpmDependency>;
      devDependencies?: Record<string, PnpmDependency>;
    };
  };
  packages?: Record<string, PnpmPackage>;
};

type PackageLock = {
  packages?: Record<string, { integrity?: string; version?: string }>;
  dependencies?: Record<string, { integrity?: string; version?: string }>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function extractConcreteVersion(raw: string | undefined): string | null {
  if (!raw) {
    return null;
  }

  const match = raw.match(CONCRETE_VERSION_EXTRACT_PATTERN);
  return match?.[0] ?? null;
}

function normalizeVersion(version: string): string {
  return version.replace(/^v/i, "");
}

function normalizeSupportedVersion(version: string): string {
  const normalizedVersion = normalizeVersion(version.trim());
  const distTag = normalizedVersion.toLowerCase();

  if (SUPPORTED_DIST_TAGS.has(distTag)) {
    return distTag;
  }

  if (CONCRETE_VERSION_PATTERN.test(normalizedVersion)) {
    return normalizedVersion;
  }

  throw new Error(
    `Unsupported Supabase CLI version "${version}". Use latest, beta, or a fixed npm package version like 2.101.0.`,
  );
}

function toPackageResolution(version: string, integrity?: string): PackageResolution {
  const normalizedVersion = normalizeSupportedVersion(version);

  return {
    spec: `${NPM_PACKAGE}@${normalizedVersion}`,
    version: normalizedVersion,
    integrity,
  };
}

function readWorkspaceLockfile(workspaceRoot: string, filename: string): string | null {
  const filePath = path.join(workspaceRoot, filename);

  if (!existsSync(filePath)) {
    return null;
  }

  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function detectResolutionFromBunLock(workspaceRoot: string): PackageResolution | null {
  const text = readWorkspaceLockfile(workspaceRoot, "bun.lock");

  if (!text) {
    return null;
  }

  try {
    const lockfile = JSON.parse(text.replace(/,\s*([}\]])/g, "$1")) as BunLock;
    const rootWorkspace = lockfile.workspaces?.[""];
    const declaredVersion =
      rootWorkspace?.dependencies?.[NPM_PACKAGE] ?? rootWorkspace?.devDependencies?.[NPM_PACKAGE];

    if (!declaredVersion) {
      return null;
    }

    const resolvedPackage = lockfile.packages?.[NPM_PACKAGE];
    if (Array.isArray(resolvedPackage) && typeof resolvedPackage[0] === "string") {
      const version = extractConcreteVersion(resolvedPackage[0]);
      const integrity = typeof resolvedPackage[3] === "string" ? resolvedPackage[3] : undefined;

      return version ? toPackageResolution(version, integrity) : null;
    }

    const version = extractConcreteVersion(declaredVersion);
    return version ? toPackageResolution(version) : null;
  } catch {
    return null;
  }
}

function detectResolutionFromPnpmLock(workspaceRoot: string): PackageResolution | null {
  const text = readWorkspaceLockfile(workspaceRoot, "pnpm-lock.yaml");

  if (!text) {
    return null;
  }

  try {
    const lockfile = Bun.YAML.parse(text) as PnpmLock;
    const rootImporter = lockfile.importers?.["."];
    const dependency =
      rootImporter?.dependencies?.[NPM_PACKAGE] ?? rootImporter?.devDependencies?.[NPM_PACKAGE];
    const version =
      typeof dependency === "string"
        ? extractConcreteVersion(dependency)
        : extractConcreteVersion(dependency?.version);

    if (!version) {
      return null;
    }

    const integrity = Object.entries(lockfile.packages ?? {}).find(
      ([packageKey]) =>
        packageKey === `${NPM_PACKAGE}@${version}` ||
        packageKey.startsWith(`/${NPM_PACKAGE}@${version}`),
    )?.[1].resolution?.integrity;

    return toPackageResolution(version, integrity);
  } catch {
    return null;
  }
}

function detectResolutionFromPackageLock(workspaceRoot: string): PackageResolution | null {
  const text = readWorkspaceLockfile(workspaceRoot, "package-lock.json");

  if (!text) {
    return null;
  }

  try {
    const lockfile = JSON.parse(text) as PackageLock;
    const packageEntry = lockfile.packages?.[`node_modules/${NPM_PACKAGE}`];
    const dependencyEntry = lockfile.dependencies?.[NPM_PACKAGE];
    const version =
      extractConcreteVersion(packageEntry?.version) ??
      extractConcreteVersion(dependencyEntry?.version);

    return version
      ? toPackageResolution(version, packageEntry?.integrity ?? dependencyEntry?.integrity)
      : null;
  } catch {
    return null;
  }
}

export function resolvePackage(inputVersion: string): PackageResolution {
  const requestedVersion = inputVersion.trim();

  if (requestedVersion) {
    return toPackageResolution(requestedVersion);
  }

  const workspaceRoot = process.env.GITHUB_WORKSPACE?.trim();

  if (!workspaceRoot) {
    return toPackageResolution(DEFAULT_VERSION);
  }

  return (
    detectResolutionFromBunLock(workspaceRoot) ??
    detectResolutionFromPnpmLock(workspaceRoot) ??
    detectResolutionFromPackageLock(workspaceRoot) ??
    toPackageResolution(DEFAULT_VERSION)
  );
}

function verifyPackageIntegrity(resolution: PackageResolution, metadata: PackageMetadata): void {
  if (!resolution.integrity) {
    return;
  }

  const registryIntegrity = metadata["dist.integrity"];
  if (registryIntegrity !== resolution.integrity) {
    throw new Error(`Lockfile integrity for ${resolution.spec} does not match the npm registry`);
  }
}

async function getPackageMetadata(resolution: PackageResolution): Promise<PackageMetadata> {
  const output = await runNpm([
    "view",
    resolution.spec,
    "version",
    "bin",
    "scripts",
    "dist.integrity",
    "--json",
    "--offline=false",
  ]);
  const metadata = JSON.parse(output) as unknown;

  if (!isRecord(metadata)) {
    throw new Error(`Could not read npm metadata for ${resolution.spec}`);
  }

  return metadata;
}

function verifyPackageMetadata(resolution: PackageResolution, metadata: PackageMetadata): void {
  if (typeof metadata.version !== "string" || !CONCRETE_VERSION_PATTERN.test(metadata.version)) {
    throw new Error(`Could not resolve a fixed npm version for ${resolution.spec}`);
  }

  const bin = metadata.bin;
  const hasSupabaseBin =
    typeof bin === "string" || (isRecord(bin) && typeof bin[NPM_PACKAGE] === "string");

  if (!hasSupabaseBin) {
    throw new Error(`The npm package ${resolution.spec} does not expose a supabase executable`);
  }
}

function shouldIgnoreInstallScripts(metadata: PackageMetadata): boolean {
  const scripts = metadata.scripts;

  return !(
    isRecord(scripts) &&
    INSTALL_LIFECYCLE_SCRIPTS.some((script) => typeof scripts[script] === "string")
  );
}

function createInstallRoot(): string {
  const tempRoot = process.env.RUNNER_TEMP?.trim() || os.tmpdir();
  return mkdtempSync(path.join(tempRoot, "setup-cli-"));
}

async function runNpm(args: string[]): Promise<string> {
  const executable = process.env[NPM_EXECUTABLE_ENV]?.trim() || "npm";
  const proc = Bun.spawn([executable, ...args], {
    cwd: process.env.GITHUB_WORKSPACE?.trim() ?? process.cwd(),
    env: process.env,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    throw new Error(stderr.trim() || `npm ${args.join(" ")} failed`);
  }

  return stdout;
}

export async function installCli(resolution: PackageResolution): Promise<string> {
  const installRoot = createInstallRoot();

  const metadata = await getPackageMetadata(resolution);
  verifyPackageMetadata(resolution, metadata);
  verifyPackageIntegrity(resolution, metadata);

  await runNpm([
    "install",
    "--prefix",
    installRoot,
    "--omit=dev",
    "--include=optional",
    "--no-audit",
    "--no-fund",
    "--no-package-lock",
    "--offline=false",
    "--bin-links=true",
    `--ignore-scripts=${shouldIgnoreInstallScripts(metadata)}`,
    resolution.spec,
  ]);

  return path.join(installRoot, "node_modules", ".bin");
}

function getCliExecutablePath(cliPath: string): string {
  if (process.platform !== "win32") {
    return path.join(cliPath, "supabase");
  }

  const cmdPath = path.join(cliPath, "supabase.cmd");
  if (existsSync(cmdPath)) {
    return cmdPath;
  }

  const exePath = path.join(cliPath, "supabase.exe");
  if (existsSync(exePath)) {
    return exePath;
  }

  return path.join(cliPath, "supabase");
}

export async function determineInstalledVersion(cliPath: string): Promise<string> {
  const executable = getCliExecutablePath(cliPath);
  const proc = Bun.spawn([executable, "--version"], {
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    throw new Error(stderr.trim() || "Could not determine installed Supabase CLI version");
  }

  const version = stdout.trim();
  if (!version) {
    throw new Error("Could not determine installed Supabase CLI version");
  }

  return version;
}

function shouldUseGhcrRegistry(requestedVersion: string, installedVersion: string): boolean {
  if (requestedVersion.toLowerCase() === DEFAULT_VERSION) {
    return true;
  }

  const concreteVersion = extractConcreteVersion(installedVersion);
  return concreteVersion !== null && semver.order(concreteVersion, REGISTRY_VERSION) >= 0;
}

export async function run(): Promise<void> {
  try {
    const resolution = resolvePackage(core.getInput("version"));
    const cliPath = await installCli(resolution);
    const installedVersion = await determineInstalledVersion(cliPath);
    core.setOutput("version", installedVersion);
    core.addPath(cliPath);

    if (shouldUseGhcrRegistry(resolution.version, installedVersion)) {
      core.exportVariable(CLI_CONFIG_REGISTRY, "ghcr.io");
    }
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : String(error));
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await run();
}
