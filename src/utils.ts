import os from 'os'
import * as path from 'path'

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

export const getDownloadObject = (
  version: string
): {url: string; binPath: string} => {
  const platform = mapOS(os.platform())
  const arch = mapArch(os.arch())
  const filename = `supabase_${version}_${platform}_${arch}`
  const binPath = platform === 'windows' ? 'bin' : path.join(filename, 'bin')
  const url = `https://github.com/supabase/cli/releases/download/v${version}/${filename}.tar.gz`
  return {
    url,
    binPath
  }
}
