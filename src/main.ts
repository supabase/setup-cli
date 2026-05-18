import { $, semver } from "bun";
import * as core from "@actions/core";
import * as tc from "@actions/tool-cache";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const CLI_CONFIG_REGISTRY = "SUPABASE_INTERNAL_IMAGE_REGISTRY";
const REGISTRY_VERSION = "1.28.0";
// Starting with this release, the CLI publishes only version-prefixed tarballs
// (e.g. supabase_2.99.0_linux_amd64.tar.gz); the unversioned aliases that used
// to live alongside them are no longer uploaded. See supabase/cli#5257.
const VERSIONED_ARCHIVE_VERSION = "2.99.0";
const DEFAULT_VERSION = "latest";
const LATEST_RELEASE_URL = "https://github.com/supabase/cli/releases/latest";

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

type PnpmLock = {
  importers?: {
    ".": {
      dependencies?: Record<string, PnpmDependency>;
      devDependencies?: Record<string, PnpmDependency>;
    };
  };
};

type PackageLock = {
  packages?: Record<string, { version?: string }>;
  dependencies?: Record<string, { version?: string }>;
};

function getArchivePlatform(platform: NodeJS.Platform): string {
  return platform === "win32" ? "windows" : platform;
}

function getArchiveArch(arch: NodeJS.Architecture): string {
  return arch === "x64" ? "amd64" : arch;
}

function extractConcreteVersion(raw: string | undefined): string | null {
  if (!raw) {
    return null;
  }

  const match = raw.match(/\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?/);
  return match?.[0] ?? null;
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

function detectVersionFromBunLock(workspaceRoot: string): string | null {
  const text = readWorkspaceLockfile(workspaceRoot, "bun.lock");

  if (!text) {
    return null;
  }

  try {
    const lockfile = JSON.parse(text.replace(/,\s*([}\]])/g, "$1")) as BunLock;
    const rootWorkspace = lockfile.workspaces?.[""];
    const declaredVersion =
      rootWorkspace?.dependencies?.supabase ?? rootWorkspace?.devDependencies?.supabase;

    if (!declaredVersion) {
      return null;
    }

    const resolvedPackage = lockfile.packages?.supabase;
    if (Array.isArray(resolvedPackage) && typeof resolvedPackage[0] === "string") {
      return extractConcreteVersion(resolvedPackage[0]);
    }

    return extractConcreteVersion(declaredVersion);
  } catch {
    return null;
  }
}

function detectVersionFromPnpmLock(workspaceRoot: string): string | null {
  const text = readWorkspaceLockfile(workspaceRoot, "pnpm-lock.yaml");

  if (!text) {
    return null;
  }

  try {
    const lockfile = Bun.YAML.parse(text) as PnpmLock;
    const rootImporter = lockfile.importers?.["."];
    const dependency =
      rootImporter?.dependencies?.supabase ?? rootImporter?.devDependencies?.supabase;

    if (typeof dependency === "string") {
      return extractConcreteVersion(dependency);
    }

    return extractConcreteVersion(dependency?.version);
  } catch {
    return null;
  }
}

function detectVersionFromPackageLock(workspaceRoot: string): string | null {
  const text = readWorkspaceLockfile(workspaceRoot, "package-lock.json");

  if (!text) {
    return null;
  }

  try {
    const lockfile = JSON.parse(text) as PackageLock;

    return (
      extractConcreteVersion(lockfile.packages?.["node_modules/supabase"]?.version) ??
      extractConcreteVersion(lockfile.dependencies?.supabase?.version)
    );
  } catch {
    return null;
  }
}

function resolveVersion(inputVersion: string): string {
  const requestedVersion = inputVersion.trim();

  if (requestedVersion) {
    return requestedVersion;
  }

  const workspaceRoot = process.env.GITHUB_WORKSPACE?.trim();

  if (!workspaceRoot) {
    return DEFAULT_VERSION;
  }

  return (
    detectVersionFromBunLock(workspaceRoot) ??
    detectVersionFromPnpmLock(workspaceRoot) ??
    detectVersionFromPackageLock(workspaceRoot) ??
    DEFAULT_VERSION
  );
}

export async function resolveLatestVersion(): Promise<string> {
  const response = await fetch(LATEST_RELEASE_URL, { method: "HEAD", redirect: "manual" });
  const location = response.headers.get("location");
  const version = extractConcreteVersion(location ?? undefined);

  if (!version) {
    throw new Error(
      `Could not resolve latest Supabase CLI version (status ${response.status}, location ${location ?? "<none>"})`,
    );
  }

  return version;
}

export function getDownloadUrl(version: string): string {
  const platform = getArchivePlatform(process.platform);
  const arch = getArchiveArch(process.arch);
  const versionedFilename = `supabase_${version}_${platform}_${arch}.tar.gz`;
  const unversionedFilename = `supabase_${platform}_${arch}.tar.gz`;

  // v2.99.0+ and the earliest releases (pre-v1.28.0) only publish version-prefixed
  // tarballs; the intermediate releases publish unversioned aliases.
  if (
    semver.order(version, REGISTRY_VERSION) === -1 ||
    semver.order(version, VERSIONED_ARCHIVE_VERSION) >= 0
  ) {
    return `https://github.com/supabase/cli/releases/download/v${version}/${versionedFilename}`;
  }

  return `https://github.com/supabase/cli/releases/download/v${version}/${unversionedFilename}`;
}

export async function determineInstalledVersion(cliPath: string): Promise<string> {
  const version = (await $`${path.join(cliPath, "supabase")} --version`.text()).trim();
  if (!version) {
    throw new Error("Could not determine installed Supabase CLI version");
  }

  return version;
}

export async function run(): Promise<void> {
  try {
    const requestedVersion = resolveVersion(core.getInput("version"));
    const version =
      requestedVersion.toLowerCase() === "latest" ? await resolveLatestVersion() : requestedVersion;
    const tarball = await tc.downloadTool(getDownloadUrl(version));
    const cliPath = await tc.extractTar(tarball);
    const installedVersion = await determineInstalledVersion(cliPath);
    core.setOutput("version", installedVersion);
    core.addPath(cliPath);

    if (semver.order(version, REGISTRY_VERSION) >= 0) {
      core.exportVariable(CLI_CONFIG_REGISTRY, "ghcr.io");
    }
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : String(error));
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await run();
}
