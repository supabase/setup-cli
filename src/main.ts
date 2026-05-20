import { $, semver } from "bun";
import * as core from "@actions/core";
import * as tc from "@actions/tool-cache";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const CLI_CONFIG_REGISTRY = "SUPABASE_INTERNAL_IMAGE_REGISTRY";
const REGISTRY_VERSION = "1.28.0";
const VERSIONED_ARCHIVE_VERSION = "2.99.0";
const DEFAULT_VERSION = "latest";
const GITHUB_RELEASES_API = "https://api.github.com/repos/supabase/cli/releases/latest";
const GITHUB_TOKEN_ENV = "SUPABASE_CLI_GITHUB_TOKEN";

type ArchiveFormat = "tar" | "zip";

type DownloadArchive = {
  url: string;
  format: ArchiveFormat;
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

function normalizeVersion(version: string): string {
  return version.replace(/^v/i, "");
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

async function resolveLatestVersion(): Promise<string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const githubToken = process.env[GITHUB_TOKEN_ENV]?.trim();

  if (githubToken) {
    headers.Authorization = `Bearer ${githubToken}`;
  }

  const response = await fetch(GITHUB_RELEASES_API, { headers });
  if (!response.ok) {
    throw new Error(`Failed to resolve latest Supabase CLI release: ${response.statusText}`);
  }

  const release = (await response.json()) as { tag_name?: unknown };
  if (typeof release.tag_name !== "string") {
    throw new Error("Failed to resolve latest Supabase CLI release: missing tag name");
  }

  return normalizeVersion(release.tag_name);
}

function getArchiveFormat(version: string, platform: NodeJS.Platform): ArchiveFormat {
  if (platform === "win32" && semver.order(version, VERSIONED_ARCHIVE_VERSION) >= 0) {
    return "zip";
  }

  return "tar";
}

function getArchiveFilename(
  version: string,
  platform: NodeJS.Platform,
  arch: NodeJS.Architecture,
): string {
  const archivePlatform = getArchivePlatform(platform);
  const archiveArch = getArchiveArch(arch);

  if (semver.order(version, REGISTRY_VERSION) === -1) {
    return `supabase_${version}_${archivePlatform}_${archiveArch}.tar.gz`;
  }

  if (semver.order(version, VERSIONED_ARCHIVE_VERSION) >= 0) {
    const extension = platform === "win32" ? "zip" : "tar.gz";
    return `supabase_${version}_${archivePlatform}_${archiveArch}.${extension}`;
  }

  return `supabase_${archivePlatform}_${archiveArch}.tar.gz`;
}

export async function getDownloadArchive(
  version: string,
  platform = process.platform,
  arch = process.arch,
): Promise<DownloadArchive> {
  const resolvedVersion =
    version.toLowerCase() === "latest" ? await resolveLatestVersion() : normalizeVersion(version);
  const filename = getArchiveFilename(resolvedVersion, platform, arch);

  return {
    url: `https://github.com/supabase/cli/releases/download/v${resolvedVersion}/${filename}`,
    format: getArchiveFormat(resolvedVersion, platform),
  };
}

function getCliExecutablePath(cliPath: string): string {
  if (process.platform !== "win32") {
    return path.join(cliPath, "supabase");
  }

  const exePath = path.join(cliPath, "supabase.exe");
  if (existsSync(exePath)) {
    return exePath;
  }

  const cmdPath = path.join(cliPath, "supabase.cmd");
  if (existsSync(cmdPath)) {
    return cmdPath;
  }

  return path.join(cliPath, "supabase");
}

export async function determineInstalledVersion(cliPath: string): Promise<string> {
  const version = (await $`${getCliExecutablePath(cliPath)} --version`.text()).trim();
  if (!version) {
    throw new Error("Could not determine installed Supabase CLI version");
  }

  return version;
}

export async function run(): Promise<void> {
  try {
    const version = resolveVersion(core.getInput("version"));
    const archive = await getDownloadArchive(version);
    const archivePath = await tc.downloadTool(archive.url);
    const cliPath =
      archive.format === "zip"
        ? await tc.extractZip(archivePath)
        : await tc.extractTar(archivePath);
    const installedVersion = await determineInstalledVersion(cliPath);
    core.setOutput("version", installedVersion);
    core.addPath(cliPath);

    if (version.toLowerCase() === "latest" || semver.order(version, REGISTRY_VERSION) >= 0) {
      core.exportVariable(CLI_CONFIG_REGISTRY, "ghcr.io");
    }
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : String(error));
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await run();
}
