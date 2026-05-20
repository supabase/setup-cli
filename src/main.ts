import * as core from '@actions/core'
import * as tc from '@actions/tool-cache'
import { gte } from 'semver'
import {
  getDownloadArchive,
  determineInstalledVersion,
  getCliPath
} from './utils.js'

export const CLI_CONFIG_REGISTRY = 'SUPABASE_INTERNAL_IMAGE_REGISTRY'

/**
 * The main function for the action.
 *
 * @returns Resolves when the action is complete.
 */
export async function run(): Promise<void> {
  try {
    // Get version of tool to be installed
    const version = core.getInput('version')
    const githubToken = core.getInput('github-token')

    // Download the specific version of the tool, e.g. as a tarball/zipball
    const download = await getDownloadArchive(
      version,
      undefined,
      undefined,
      undefined,
      githubToken
    )
    const pathToArchive = await tc.downloadTool(download.url)

    // Extract the tarball/zipball onto host runner
    const extractedPath =
      download.format === 'zip'
        ? await tc.extractZip(pathToArchive)
        : await tc.extractTar(pathToArchive)
    const pathToCLI = getCliPath(extractedPath, download.format)

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
