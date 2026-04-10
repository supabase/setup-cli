import * as cache from "@actions/cache";
import * as core from "@actions/core";
import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const CLI_CONFIG_REGISTRY = "SUPABASE_INTERNAL_IMAGE_REGISTRY";
const CACHE_ARCHIVE = "supabase-cli-docker-images.tar";
const CACHE_DIR = "setup-supabase-cli";
const CACHE_KEY_VERSION = "v1";
const DEFAULT_REGISTRY = "public.ecr.aws";
const GHCR_REGISTRY = "ghcr.io";
const CACHE_INPUT = "cache";
const CACHE_KEY_INPUT = "cache-key";
const CACHE_HIT_OUTPUT = "cache-hit";
const STATE_ENABLED = "cache-enabled";
const STATE_PRIMARY_KEY = "cache-primary-key";
const STATE_ARCHIVE_PATH = "cache-archive-path";
const STATE_CACHE_HIT = "cache-hit";
const CLI_PROJECT_LABEL = "com.supabase.cli.project";
const SUPABASE_IMAGE_PREFIXES = ["ghcr.io/supabase/", "public.ecr.aws/supabase/", "supabase/"];

type ExecFile = (
  file: string,
  args: string[],
  options?: { maxBuffer?: number },
) => Promise<{ stdout: string; stderr: string }>;

const execFile = promisify(execFileCallback) as ExecFile;

function sanitizeCacheKeyPart(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]/g, "-").replace(/-+/g, "-");
}

function hashFile(filePath: string): string | null {
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    return createHash("sha256").update(readFileSync(filePath)).digest("hex");
  } catch {
    return null;
  }
}

function getConfigHash(): string {
  const workspaceRoot = process.env.GITHUB_WORKSPACE?.trim();
  if (!workspaceRoot) {
    return "no-config";
  }

  return hashFile(path.join(workspaceRoot, "supabase", "config.toml")) ?? "no-config";
}

function getCacheArchivePath(): string {
  const runnerTemp = process.env.RUNNER_TEMP?.trim() || os.tmpdir();
  return path.join(runnerTemp, CACHE_DIR, CACHE_ARCHIVE);
}

export function getImageRegistry(): string {
  return process.env[CLI_CONFIG_REGISTRY]?.trim() || DEFAULT_REGISTRY;
}

export function getGhcrImageRegistry(): string {
  return GHCR_REGISTRY;
}

export function createDockerImageCacheKey(installedVersion: string, registry: string): string {
  return [
    "supabase-cli-containers",
    CACHE_KEY_VERSION,
    sanitizeCacheKeyPart(process.platform),
    sanitizeCacheKeyPart(process.arch),
    sanitizeCacheKeyPart(installedVersion),
    sanitizeCacheKeyPart(registry),
    getConfigHash(),
  ].join("-");
}

function getPrimaryCacheKey(installedVersion: string, registry: string): string {
  const cacheKeyInput = core.getInput(CACHE_KEY_INPUT).trim();
  if (cacheKeyInput) {
    return cacheKeyInput;
  }

  return createDockerImageCacheKey(installedVersion, registry);
}

async function isDockerAvailable(run: ExecFile = execFile): Promise<boolean> {
  try {
    await run("docker", ["version"]);
    return true;
  } catch {
    return false;
  }
}

async function runDocker(args: string[], run: ExecFile = execFile): Promise<string> {
  const { stdout } = await run("docker", args, { maxBuffer: 1024 * 1024 * 16 });
  return stdout;
}

function normalizeImageRefs(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.includes("<none>"));
}

function isSupabaseImageRef(ref: string): boolean {
  return SUPABASE_IMAGE_PREFIXES.some((prefix) => ref.startsWith(prefix));
}

export async function collectDockerImageRefs(run: ExecFile = execFile): Promise<string[]> {
  const refs = new Set<string>();

  try {
    const output = await runDocker(
      ["ps", "-a", "--filter", `label=${CLI_PROJECT_LABEL}`, "--format", "{{.Image}}"],
      run,
    );
    for (const ref of normalizeImageRefs(output)) {
      refs.add(ref);
    }
  } catch (error) {
    core.warning(
      `Could not list Supabase CLI containers for Docker image cache: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  try {
    const output = await runDocker(["image", "ls", "--format", "{{.Repository}}:{{.Tag}}"], run);
    for (const ref of normalizeImageRefs(output).filter(isSupabaseImageRef)) {
      refs.add(ref);
    }
  } catch (error) {
    core.warning(
      `Could not list Docker images for Supabase image cache: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return [...refs].sort();
}

export async function restoreDockerImageCache(
  installedVersion: string,
  registry: string,
  run: ExecFile = execFile,
): Promise<void> {
  const enabled = core.getBooleanInput(CACHE_INPUT);
  core.setOutput(CACHE_HIT_OUTPUT, "false");
  core.saveState(STATE_ENABLED, String(enabled));

  if (!enabled) {
    return;
  }

  const archivePath = getCacheArchivePath();
  const primaryKey = getPrimaryCacheKey(installedVersion, registry);
  mkdirSync(path.dirname(archivePath), { recursive: true });
  core.saveState(STATE_PRIMARY_KEY, primaryKey);
  core.saveState(STATE_ARCHIVE_PATH, archivePath);
  core.saveState(STATE_CACHE_HIT, "false");

  if (!(await isDockerAvailable(run))) {
    core.warning("Docker is not available. Skipping Supabase Docker image cache restore.");
    return;
  }

  let matchedKey: string | undefined;
  try {
    matchedKey = await cache.restoreCache([archivePath], primaryKey);
  } catch (error) {
    core.warning(
      `Could not restore Supabase Docker image cache: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }

  if (!matchedKey) {
    core.info("No Supabase Docker image cache found.");
    return;
  }

  const cacheHit = matchedKey === primaryKey;
  core.setOutput(CACHE_HIT_OUTPUT, String(cacheHit));
  core.saveState(STATE_CACHE_HIT, String(cacheHit));

  if (!existsSync(archivePath)) {
    core.warning("Supabase Docker image cache was restored, but the archive is missing.");
    return;
  }

  try {
    await runDocker(["load", "-i", archivePath], run);
    core.info("Loaded Supabase Docker images from cache.");
  } catch (error) {
    core.warning(
      `Could not load Supabase Docker image cache: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function saveDockerImageCache(run: ExecFile = execFile): Promise<void> {
  if (core.getState(STATE_ENABLED) !== "true") {
    return;
  }

  if (core.getState(STATE_CACHE_HIT) === "true") {
    core.info("Supabase Docker image cache hit. Skipping cache save.");
    return;
  }

  const primaryKey = core.getState(STATE_PRIMARY_KEY);
  const archivePath = core.getState(STATE_ARCHIVE_PATH) || getCacheArchivePath();
  if (!primaryKey) {
    core.warning("Supabase Docker image cache key is missing. Skipping cache save.");
    return;
  }

  if (!(await isDockerAvailable(run))) {
    core.warning("Docker is not available. Skipping Supabase Docker image cache save.");
    return;
  }

  const imageRefs = await collectDockerImageRefs(run);
  if (imageRefs.length === 0) {
    core.warning("No Supabase Docker images found to cache.");
    return;
  }

  mkdirSync(path.dirname(archivePath), { recursive: true });
  try {
    await runDocker(["save", "-o", archivePath, ...imageRefs], run);
  } catch (error) {
    core.warning(
      `Could not create Supabase Docker image archive: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }

  try {
    await cache.saveCache([archivePath], primaryKey);
    core.info(`Saved ${imageRefs.length} Supabase Docker image(s) to cache.`);
  } catch (error) {
    core.warning(
      `Could not save Supabase Docker image cache: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
