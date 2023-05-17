import * as core from '@actions/core'
import * as tc from '@actions/tool-cache'
import gte from 'semver/functions/gte'
import {getDownloadUrl, determineInstalledVersion} from './utils'

export const CLI_CONFIG_REGISTRY = 'SUPABASE_INTERNAL_IMAGE_REGISTRY'

async function run(): Promise<void> {
  try {
    // Get version of tool to be installed
    const version = core.getInput('version')

    // Download the specific version of the tool, e.g. as a tarball/zipball
    const download = await getDownloadUrl(version)
    const pathToTarball = await tc.downloadTool(download)

    // Extract the tarball/zipball onto host runner
    const pathToCLI = await tc.extractTar(pathToTarball)

    // Expose the tool by adding it to the PATH
    core.addPath(pathToCLI)

    // Expose installed tool version
    const determinedVersion = await determineInstalledVersion()
    core.setOutput('version', determinedVersion)

    // Use GHCR mirror by default
    if (version.toLowerCase() === 'latest' || gte(version, '1.28.0')) {
      core.exportVariable(CLI_CONFIG_REGISTRY, 'ghcr.io')
    }
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message)
  }
}

run()
