import * as core from '@actions/core'
import * as tc from '@actions/tool-cache'
import {getDownloadUrl} from './utils'

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
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message)
  }
}

run()
