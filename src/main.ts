import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as io from "@actions/io";
import { load as parseYaml } from "js-yaml";
import semver from "semver";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const CLI_CONFIG_REGISTRY = "SUPABASE_INTERNAL_IMAGE_REGISTRY";
const REGISTRY_VERSION = "1.28.0";
const FALLBACK_VERSION = "2.108.0";
const DEFAULT_VERSION = "latest";
const NPM_PACKAGE = "supabase";
const NPM_EXECUTABLE_ENV = "SUPABASE_SETUP_CLI_NPM";
const MUSL_ENV = "SUPABASE_SETUP_CLI_MUSL";
const GITHUB_RELEASES_URL = "https://github.com/supabase/cli/releases/download";
const NPM_REGISTRY_URL = "https://registry.npmjs.org";
const REGISTRY_TIMEOUT_MS = 60 * 1000;
const MUSL_RUNTIME_PACKAGES = ["libstdc++", "libgcc"];
const RELEASE_DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;
const RELEASE_PLATFORMS: Partial<Record<NodeJS.Platform, string>> = {
  darwin: "darwin",
  linux: "linux",
  win32: "windows",
};
const RELEASE_ARCHES: Partial<Record<NodeJS.Architecture, string>> = {
  arm64: "arm64",
  x64: "amd64",
};
const INSTALL_LIFECYCLE_SCRIPTS = ["preinstall", "install", "postinstall"] as const;
const SUPPORTED_DIST_TAGS = new Set([DEFAULT_VERSION, "beta", "next"]);
const MAINTENANCE_DIST_TAG_PATTERN = /^v\d+\.stable$/;
const CONCRETE_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const RANGE_TOKEN_PATTERN =
  /^(?:[<>]=?|=|\^|~)?(?:\d+|[xX*])(?:\.(?:\d+|[xX*])){0,2}(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const CONCRETE_VERSION_EXTRACT_PATTERN = /\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?/;

type PackageResolution = {
  spec: string;
  version: string;
  integrity?: string;
};

type Installation = {
  cliPath: string;
  installedVersion: string;
  source: "npm" | "github-release";
};

type ReleaseTarget = {
  platform: NodeJS.Platform;
  arch: NodeJS.Architecture;
  musl: boolean;
};

type ReleaseAsset = {
  filename: string;
  sha256: string;
  binDir: string;
};

type PackageMetadata = {
  version?: unknown;
  bin?: unknown;
  scripts?: unknown;
  "dist.integrity"?: unknown;
  "dist-tags"?: unknown;
  deprecated?: unknown;
};

type RegistryPackument = {
  "dist-tags"?: Record<string, string>;
  versions?: Record<
    string,
    { version?: unknown; bin?: unknown; deprecated?: unknown; dist?: { integrity?: unknown } }
  >;
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

/** Joins operators to their versions and drops `v` prefixes, which npm only accepts in lowercase. */
function normalizeRange(version: string): string {
  return version.replace(/([<>]=?|=|\^|~)\s+/g, "$1").replace(/(^|[\s<>=^~])v(?=\d|[xX*])/gi, "$1");
}

/** Recognizes npm semver ranges (^2.95, 2.x, >=2.98 <2.99, 2.90.0 - 2.98.0, ^1 || ^2) by syntax. */
function isVersionRange(version: string): boolean {
  if (CONCRETE_VERSION_PATTERN.test(version)) {
    return false;
  }

  return version.split("||").every((clause) => {
    const tokens = clause.split(/\s+/).filter(Boolean);
    return (
      tokens.length > 0 &&
      tokens[0] !== "-" &&
      tokens[tokens.length - 1] !== "-" &&
      tokens.every((token) => token === "-" || RANGE_TOKEN_PATTERN.test(token))
    );
  });
}

function normalizeSupportedVersion(version: string): string {
  const trimmedVersion = version.trim();
  const distTag = trimmedVersion.toLowerCase();

  if (MAINTENANCE_DIST_TAG_PATTERN.test(distTag)) {
    return distTag;
  }

  const normalizedVersion = normalizeVersion(trimmedVersion);

  if (SUPPORTED_DIST_TAGS.has(normalizedVersion.toLowerCase())) {
    return normalizedVersion.toLowerCase();
  }

  if (CONCRETE_VERSION_PATTERN.test(normalizedVersion)) {
    return normalizedVersion;
  }

  const range = normalizeRange(trimmedVersion);
  if (isVersionRange(range)) {
    return range;
  }

  throw new Error(
    `Unsupported Supabase CLI version "${version}". Use latest, beta, next, v<N>.stable (like v2.stable), a fixed npm package version like 2.101.0, or a semver range like ^2.95 or 2.x.`,
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
    const lockfile = parseYaml(text) as PnpmLock;
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

function isDeprecated(manifest: PackageMetadata): boolean {
  return Boolean(manifest.deprecated);
}

/** Picks a manifest like npm's installer: `latest` if it matches, else the highest non-deprecated version. */
function pickManifest(manifests: PackageMetadata[]): PackageMetadata | undefined {
  const candidates = manifests.filter(
    (manifest) =>
      typeof manifest.version === "string" && CONCRETE_VERSION_PATTERN.test(manifest.version),
  );
  const distTags = manifests.map((manifest) => manifest["dist-tags"]).find(isRecord);
  const latest = candidates.find((manifest) => manifest.version === distTags?.latest);

  if (latest && !isDeprecated(latest)) {
    return latest;
  }

  const nonDeprecated = candidates.filter((manifest) => !isDeprecated(manifest));
  const pool = nonDeprecated.length > 0 ? nonDeprecated : candidates;
  const [highest] = pool.sort((a, b) => semver.compare(b.version as string, a.version as string));

  return highest;
}

async function getPackageMetadata(resolution: PackageResolution): Promise<PackageMetadata> {
  const output = await runNpm([
    "view",
    resolution.spec,
    "version",
    "bin",
    "scripts",
    "dist.integrity",
    "deprecated",
    "dist-tags",
    "--json",
    "--offline=false",
  ]);
  const parsed = JSON.parse(output) as unknown;
  const manifests = (Array.isArray(parsed) ? parsed : [parsed]).filter(isRecord);

  const [first] = manifests;

  if (!first) {
    throw new Error(`Could not read npm metadata for ${resolution.spec}`);
  }

  // Without a concrete version, verifyPackageMetadata rejects the manifest with a clear error.
  return pickManifest(manifests) ?? first;
}

/** Resolves a version from the public npm registry, for runners without npm. */
async function getRegistryMetadata(resolution: PackageResolution): Promise<PackageMetadata> {
  const url = `${NPM_REGISTRY_URL}/${NPM_PACKAGE}`;
  const response = await fetch(url, {
    headers: { accept: "application/vnd.npm.install-v1+json" },
    signal: AbortSignal.timeout(REGISTRY_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Fetching ${url} returned HTTP ${response.status}`);
  }

  const packument = (await response.json()) as RegistryPackument;
  const distTags = packument["dist-tags"] ?? {};
  const manifests: PackageMetadata[] = Object.values(packument.versions ?? {}).map((manifest) => ({
    version: manifest.version,
    bin: manifest.bin,
    deprecated: manifest.deprecated,
    "dist.integrity": manifest.dist?.integrity,
    "dist-tags": distTags,
  }));
  const taggedVersion = distTags[resolution.version];
  const matches = manifests.filter((manifest) =>
    taggedVersion
      ? manifest.version === taggedVersion
      : typeof manifest.version === "string" &&
        CONCRETE_VERSION_PATTERN.test(manifest.version) &&
        semver.satisfies(manifest.version, resolution.version),
  );
  const picked = pickManifest(matches);

  if (!picked) {
    throw new Error(`No published Supabase CLI version matches "${resolution.version}"`);
  }

  return picked;
}

function verifyPackageMetadata(resolution: PackageResolution, metadata: PackageMetadata): string {
  if (typeof metadata.version !== "string" || !CONCRETE_VERSION_PATTERN.test(metadata.version)) {
    throw new Error(`Could not resolve a fixed npm version for ${resolution.spec}`);
  }

  const bin = metadata.bin;
  const hasSupabaseBin =
    typeof bin === "string" || (isRecord(bin) && typeof bin[NPM_PACKAGE] === "string");

  if (!hasSupabaseBin) {
    throw new Error(`The npm package ${resolution.spec} does not expose a supabase executable`);
  }

  return metadata.version;
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function runProcess(
  command: string[],
  options: { cwd?: string; failure: string },
): Promise<string> {
  const [executable, ...args] = command as [string, ...string[]];
  // @actions/exec resolves `.cmd` shims and quotes arguments like `^2 || ^3` safely on Windows.
  const { exitCode, stdout, stderr } = await exec.getExecOutput(executable, args, {
    cwd: options.cwd,
    env: process.env as Record<string, string>,
    ignoreReturnCode: true,
    silent: true,
  });

  if (exitCode !== 0) {
    throw new Error(stderr.trim() || options.failure);
  }

  return stdout;
}

function npmExecutable(): string {
  return process.env[NPM_EXECUTABLE_ENV]?.trim() || "npm";
}

async function hasNpm(): Promise<boolean> {
  return (await io.which(npmExecutable(), false)) !== "";
}

async function runNpm(args: string[]): Promise<string> {
  return runProcess([npmExecutable(), ...args], {
    cwd: process.env.GITHUB_WORKSPACE?.trim() ?? process.cwd(),
    failure: `npm ${args.join(" ")} failed`,
  });
}

async function installNpmPackage(
  resolution: PackageResolution,
  metadata: PackageMetadata,
): Promise<string> {
  const installRoot = createInstallRoot();

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

function parseChecksums(text: string): Map<string, string> {
  const checksums = new Map<string, string>();

  for (const line of text.split("\n")) {
    const [sha256, filename] = line.trim().split(/\s+/);
    if (sha256 && filename) {
      checksums.set(filename.replace(/^\*/, ""), sha256.toLowerCase());
    }
  }

  return checksums;
}

export function selectReleaseAsset(
  version: string,
  checksumsText: string,
  target: ReleaseTarget,
): ReleaseAsset {
  const platform = RELEASE_PLATFORMS[target.platform];
  const arch = RELEASE_ARCHES[target.arch];

  if (!platform || !arch) {
    throw new Error(
      `Supabase CLI releases have no binary for ${target.platform} ${target.arch} runners`,
    );
  }

  const tarballs = [
    `supabase_${version}_${platform}_${arch}.tar.gz`,
    `supabase_${platform}_${arch}.tar.gz`,
  ];
  // Release tarballs may carry a glibc build; the apk carries the musl one.
  const candidates =
    target.musl && platform === "linux"
      ? [`supabase_${version}_${platform}_${arch}.apk`, ...tarballs]
      : tarballs;
  const checksums = parseChecksums(checksumsText);

  for (const filename of candidates) {
    const sha256 = checksums.get(filename);
    if (sha256) {
      return {
        filename,
        sha256,
        binDir: filename.endsWith(".apk") ? path.join("usr", "bin") : "",
      };
    }
  }

  throw new Error(`The v${version} release has no checksum for ${candidates.join(" or ")}`);
}

async function fetchReleaseAsset(version: string, filename: string): Promise<Response> {
  const url = `${GITHUB_RELEASES_URL}/v${version}/${filename}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(RELEASE_DOWNLOAD_TIMEOUT_MS) });

  if (!response.ok && response.status !== 404) {
    throw new Error(`Downloading ${url} returned HTTP ${response.status}`);
  }

  return response;
}

async function downloadReleaseChecksums(version: string): Promise<string> {
  const filenames = ["checksums.txt", `supabase_${version}_checksums.txt`];

  for (const filename of filenames) {
    const response = await fetchReleaseAsset(version, filename);
    if (response.ok) {
      return response.text();
    }
  }

  throw new Error(`The v${version} GitHub release has no ${filenames.join(" or ")}`);
}

async function extractArchive(archivePath: string, destination: string): Promise<void> {
  // Git Bash's GNU tar reads `C:\...` as a remote host, so Windows uses its bundled bsdtar.
  const tar =
    process.platform === "win32"
      ? path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe")
      : "tar";

  await runProcess([tar, "-xzf", archivePath, "-C", destination], {
    failure: `Could not extract ${path.basename(archivePath)}`,
  });
}

async function installGitHubRelease(version: string): Promise<string> {
  const asset = selectReleaseAsset(version, await downloadReleaseChecksums(version), {
    platform: process.platform,
    arch: process.arch,
    musl: isMusl(),
  });
  const response = await fetchReleaseAsset(version, asset.filename);
  if (!response.ok) {
    throw new Error(`The v${version} GitHub release has no ${asset.filename}`);
  }

  const archive = new Uint8Array(await response.arrayBuffer());
  const sha256 = createHash("sha256").update(archive).digest("hex");

  if (sha256 !== asset.sha256) {
    throw new Error(
      `Checksum mismatch for ${asset.filename}: the release lists ${asset.sha256}, but the download is ${sha256}`,
    );
  }

  const installRoot = createInstallRoot();
  const archivePath = path.join(installRoot, asset.filename);
  await writeFile(archivePath, archive);
  await extractArchive(archivePath, installRoot);
  rmSync(archivePath, { force: true });

  return path.join(installRoot, asset.binDir);
}

async function installGitHubReleaseInstead(
  resolution: PackageResolution,
  version: string | null,
  npmError: unknown,
): Promise<Installation> {
  const npmFailure = errorMessage(npmError);

  if (!version) {
    if (/No match found for version/.test(npmFailure)) {
      throw new Error(`No published Supabase CLI version matches "${resolution.version}"`);
    }
    throw npmError;
  }

  core.warning(
    `npm could not install ${resolution.spec}, so installing v${version} from its GitHub release instead: ${npmFailure}`,
  );

  try {
    const cliPath = await installGitHubRelease(version);
    const installedVersion = await determineInstalledVersion(cliPath);
    return { cliPath, installedVersion, source: "github-release" };
  } catch (error) {
    throw new Error(
      `${npmFailure}\nThe GitHub release fallback for v${version} also failed: ${errorMessage(error)}`,
    );
  }
}

async function installWithoutNpm(requested: PackageResolution): Promise<Installation> {
  const metadata = await getRegistryMetadata(requested);
  const version = verifyPackageMetadata(requested, metadata);
  verifyPackageIntegrity(requested, metadata);
  core.info(`npm is not available, so installing Supabase CLI v${version} from its GitHub release`);

  const cliPath = await installGitHubRelease(version);
  const installedVersion = await determineInstalledVersion(cliPath);
  return { cliPath, installedVersion, source: "github-release" };
}

/** Installs from npm, falling back to the GitHub release when npm cannot produce a working CLI. */
export async function installCli(requested: PackageResolution): Promise<Installation> {
  if (!(await hasNpm())) {
    return installWithoutNpm(requested);
  }

  let metadata: PackageMetadata;
  try {
    metadata = await getPackageMetadata(requested);
  } catch (error) {
    const version = CONCRETE_VERSION_PATTERN.test(requested.version) ? requested.version : null;
    return installGitHubReleaseInstead(requested, version, error);
  }

  const version = verifyPackageMetadata(requested, metadata);
  verifyPackageIntegrity(requested, metadata);

  if (version !== requested.version) {
    core.info(`Resolved Supabase CLI version "${requested.version}" to ${version}`);
  }

  const resolution = { ...requested, spec: `${NPM_PACKAGE}@${version}`, version };

  try {
    const cliPath = await installNpmPackage(resolution, metadata);
    const installedVersion = await determineInstalledVersion(cliPath);
    return { cliPath, installedVersion, source: "npm" };
  } catch (error) {
    return installGitHubReleaseInstead(resolution, version, error);
  }
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
  const failure = "Could not determine installed Supabase CLI version";
  const version = (
    await runProcess([getCliExecutablePath(cliPath), "--version"], { failure })
  ).trim();

  if (!version) {
    throw new Error(failure);
  }

  return version;
}

/** Detects Linux musl (Alpine), whose CLI release ships as an `.apk`. */
export function isMusl(): boolean {
  const override = process.env[MUSL_ENV]?.trim();
  if (override) {
    return override === "true";
  }

  if (process.platform !== "linux") {
    return false;
  }

  if (existsSync("/etc/alpine-release")) {
    return true;
  }

  const report = process.report.getReport() as { header?: { glibcVersionRuntime?: string } };
  return !report.header?.glibcVersionRuntime;
}

/** The musl CLI binary links against libstdc++ and libgcc, which minimal images lack. */
async function ensureMuslRuntimeLibraries(): Promise<void> {
  if (!isMusl()) {
    return;
  }

  const apk = await io.which("apk", false);
  if (!apk) {
    throw new Error(
      `Linux musl containers need ${MUSL_RUNTIME_PACKAGES.join(" and ")} to run Supabase CLI. Install them before supabase/setup-cli.`,
    );
  }

  const missing: string[] = [];
  for (const pkg of MUSL_RUNTIME_PACKAGES) {
    const { exitCode } = await exec.getExecOutput(apk, ["info", "-e", pkg], {
      ignoreReturnCode: true,
      silent: true,
    });
    if (exitCode !== 0) {
      missing.push(pkg);
    }
  }

  if (missing.length === 0) {
    return;
  }

  const packages = missing.join(" ");
  if (process.getuid?.() !== 0) {
    throw new Error(
      `Alpine/musl containers need ${packages} to run Supabase CLI. Add 'apk add --no-cache ${packages}' before supabase/setup-cli, or run this job container as root.`,
    );
  }

  await runProcess([apk, "add", "--no-cache", ...missing], {
    failure: `apk add --no-cache ${packages} failed`,
  });
}

function shouldUseGhcrRegistry(installedVersion: string): boolean {
  const concreteVersion = extractConcreteVersion(installedVersion);
  return (
    concreteVersion !== null &&
    semver.gte(concreteVersion, REGISTRY_VERSION) &&
    semver.lt(concreteVersion, FALLBACK_VERSION)
  );
}

export async function run(): Promise<void> {
  try {
    const resolution = resolvePackage(core.getInput("version"));
    await ensureMuslRuntimeLibraries();
    const { cliPath, installedVersion, source } = await installCli(resolution);
    core.setOutput("version", installedVersion);
    core.setOutput("install-source", source);
    core.addPath(cliPath);

    if (shouldUseGhcrRegistry(installedVersion) && !process.env[CLI_CONFIG_REGISTRY]) {
      core.exportVariable(CLI_CONFIG_REGISTRY, "ghcr.io");
    }
  } catch (error) {
    core.setFailed(errorMessage(error));
  }
}
