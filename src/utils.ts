import { exec } from 'child_process'
import { existsSync } from 'fs'
import os from 'os'
import { gte, lt } from 'semver'
import { promisify } from 'util'

const doExec = promisify(exec)
const VERSIONED_ARCHIVE_VERSION = '2.99.0'
const LATEST_RELEASE_URL =
  'https://api.github.com/repos/supabase/cli/releases/latest'

export type ArchiveFormat = 'apk' | 'tar' | 'zip'

export type DownloadArchive = {
  url: string
  format: ArchiveFormat
}

// arch in [arm, arm64, x64...] (https://nodejs.org/docs/latest-v16.x/api/os.html#osarch)
// return value in [amd64, arm64, arm]
const mapArch = (arch: string): string => {
  const mappings: Record<string, string> = {
    x64: 'amd64'
  }
  return mappings[arch] || arch
}

// os in [darwin, linux, win32...] (https://nodejs.org/docs/latest-v16.x/api/os.html#osplatform)
// return value in [darwin, linux, windows]
const mapOS = (platform: string): string => {
  const mappings: Record<string, string> = {
    win32: 'windows'
  }
  return mappings[platform] || platform
}

const normalizeVersion = (version: string): string => version.replace(/^v/i, '')

const resolveLatestVersion = async (githubToken?: string): Promise<string> => {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
  }
  const token = githubToken?.trim()

  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  const response = await fetch(LATEST_RELEASE_URL, { headers })
  if (!response.ok) {
    throw new Error(
      `Failed to resolve latest Supabase CLI release: ${response.statusText}`
    )
  }

  const release = (await response.json()) as { tag_name?: unknown }
  if (typeof release.tag_name !== 'string') {
    throw new Error(
      'Failed to resolve latest Supabase CLI release: missing tag name'
    )
  }

  return normalizeVersion(release.tag_name)
}

const detectMuslLinux = async (platform = os.platform()): Promise<boolean> => {
  if (platform !== 'linux') {
    return false
  }

  if (existsSync('/etc/alpine-release')) {
    return true
  }

  try {
    const { stdout, stderr } = await doExec('ldd --version')
    return `${stdout}\n${stderr}`.toLowerCase().includes('musl')
  } catch (error) {
    const output = error instanceof Error ? error.message : String(error)
    return output.toLowerCase().includes('musl')
  }
}

const getArchiveFormat = (
  version: string,
  platform: string,
  isMuslLinux: boolean
): ArchiveFormat => {
  if (
    platform === 'linux' &&
    isMuslLinux &&
    gte(version, VERSIONED_ARCHIVE_VERSION)
  ) {
    return 'apk'
  }

  if (platform === 'win32' && gte(version, VERSIONED_ARCHIVE_VERSION)) {
    return 'zip'
  }

  return 'tar'
}

const getArchiveFilename = (
  version: string,
  platform: string,
  arch: string,
  format: ArchiveFormat
): string => {
  const archivePlatform = mapOS(platform)
  const archiveArch = mapArch(arch)
  if (lt(version, '1.28.0')) {
    return `supabase_${version}_${archivePlatform}_${archiveArch}.tar.gz`
  }

  if (platform === 'linux' && format === 'apk') {
    return `supabase_${version}_${archivePlatform}_${archiveArch}.apk`
  }

  if (gte(version, VERSIONED_ARCHIVE_VERSION)) {
    const extension = platform === 'win32' ? 'zip' : 'tar.gz'
    return `supabase_${version}_${archivePlatform}_${archiveArch}.${extension}`
  }

  return `supabase_${archivePlatform}_${archiveArch}.tar.gz`
}

export const getDownloadArchive = async (
  version: string,
  platform = os.platform(),
  arch = os.arch(),
  isMuslLinux?: boolean,
  githubToken?: string
): Promise<DownloadArchive> => {
  const resolvedVersion =
    version.toLowerCase() === 'latest'
      ? await resolveLatestVersion(githubToken)
      : normalizeVersion(version)
  const format = getArchiveFormat(
    resolvedVersion,
    platform,
    isMuslLinux ?? (await detectMuslLinux(platform))
  )
  const filename = getArchiveFilename(resolvedVersion, platform, arch, format)

  return {
    url: `https://github.com/supabase/cli/releases/download/v${resolvedVersion}/${filename}`,
    format
  }
}

export const getCliPath = (
  extractedPath: string,
  archiveFormat: ArchiveFormat
): string => {
  return archiveFormat === 'apk' ? `${extractedPath}/usr/bin` : extractedPath
}

export const installAlpineRuntimeDependencies = async (
  archiveFormat: ArchiveFormat
): Promise<void> => {
  if (archiveFormat !== 'apk') {
    return
  }

  try {
    await doExec('command -v apk')
  } catch {
    throw new Error(
      'Linux musl containers need libstdc++ and libgcc to run Supabase CLI. Install them before supabase/setup-cli.'
    )
  }

  try {
    await doExec('apk info -e libstdc++ libgcc')
    return
  } catch {
    const { stdout } = await doExec('id -u')
    if (stdout.trim() !== '0') {
      throw new Error(
        "Alpine/musl containers need libstdc++ and libgcc to run Supabase CLI. Add 'apk add --no-cache libstdc++ libgcc' before supabase/setup-cli, or run this job container as root."
      )
    }
  }

  // The Supabase CLI shim in the apk dynamically links these Alpine runtime libraries.
  await doExec('apk add --no-cache libstdc++ libgcc')
}

export const getDownloadUrl = async (
  version: string,
  githubToken?: string
): Promise<string> => {
  const archive = await getDownloadArchive(
    version,
    os.platform(),
    os.arch(),
    undefined,
    githubToken
  )
  return archive.url
}

export const determineInstalledVersion = async (): Promise<string> => {
  const { stdout } = await doExec('supabase --version')

  const version = stdout.trim()
  if (!version) {
    throw new Error('Could not determine installed Supabase CLI version')
  }

  return version
}
