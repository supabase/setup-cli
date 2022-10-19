import os from 'os'
import * as httpm from '@actions/http-client'
import {BearerCredentialHandler} from '@actions/http-client/lib/auth'

interface GitHubTag {
  tag_name: string
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

export const getDownloadUrl = async (version: string): Promise<string> => {
  const platform = mapOS(os.platform())
  const arch = mapArch(os.arch())
  const resolvedVersion = await resolveVersion(version)
  const filename = `supabase_${resolvedVersion}_${platform}_${arch}`

  return `https://github.com/supabase/cli/releases/download/v${resolvedVersion}/${filename}.tar.gz`
}

// Ref: https://github.com/actions/toolkit/blob/main/packages/cache/src/internal/cacheHttpClient.ts#L62
const http: httpm.HttpClient = new httpm.HttpClient('setup-cli', [
  new BearerCredentialHandler(process.env['GH_TOKEN'] || '')
])

const resolveVersion = async (version: string): Promise<string> => {
  if (version !== 'latest') {
    return version
  }

  const url = 'https://api.github.com/repos/supabase/cli/releases/latest'
  const tag = (await http.getJson<GitHubTag>(url)).result?.tag_name
  if (!tag) {
    throw new Error('Cannot fetch tag info')
  }

  return tag.substring(1)
}
