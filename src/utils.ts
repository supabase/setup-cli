import { exec } from 'child_process'
import os from 'os'
import { lt } from 'semver'
import { promisify } from 'util'

const doExec = promisify(exec)

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

export const getDownloadUrl = async (version: string): Promise<string> => {
  const platform = mapOS(os.platform())
  const arch = mapArch(os.arch())
  const filename = `supabase_${platform}_${arch}.tar.gz`
  if (version.toLowerCase() === 'latest') {
    return `https://github.com/supabase/cli/releases/latest/download/${filename}`
  }
  if (lt(version, '1.28.0')) {
    return `https://github.com/supabase/cli/releases/download/v${version}/supabase_${version}_${platform}_${arch}.tar.gz`
  }
  return `https://github.com/supabase/cli/releases/download/v${version}/${filename}`
}

export const determineInstalledVersion = async (): Promise<string> => {
  const { stdout } = await doExec('supabase --version')

  const version = stdout.trim()
  if (!version) {
    throw new Error('Could not determine installed Supabase CLI version')
  }

  return version
}
