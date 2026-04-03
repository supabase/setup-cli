import { $, semver } from "bun";
import * as core from "@actions/core";
import * as tc from "@actions/tool-cache";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const CLI_CONFIG_REGISTRY = "SUPABASE_INTERNAL_IMAGE_REGISTRY";
const REGISTRY_VERSION = "1.28.0";

function getArchivePlatform(platform: NodeJS.Platform): string {
  return platform === "win32" ? "windows" : platform;
}

function getArchiveArch(arch: NodeJS.Architecture): string {
  return arch === "x64" ? "amd64" : arch;
}

export function getDownloadUrl(version: string): string {
  const platform = getArchivePlatform(process.platform);
  const arch = getArchiveArch(process.arch);
  const filename = `supabase_${platform}_${arch}.tar.gz`;

  if (version.toLowerCase() === "latest") {
    return `https://github.com/supabase/cli/releases/latest/download/${filename}`;
  }

  if (semver.order(version, REGISTRY_VERSION) === -1) {
    return `https://github.com/supabase/cli/releases/download/v${version}/supabase_${version}_${platform}_${arch}.tar.gz`;
  }

  return `https://github.com/supabase/cli/releases/download/v${version}/${filename}`;
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
    const version = core.getInput("version");
    const tarball = await tc.downloadTool(getDownloadUrl(version));
    const cliPath = await tc.extractTar(tarball);
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
  void run();
}
