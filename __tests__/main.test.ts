import { getDownloadUrl } from '../src/utils'
import { CLI_CONFIG_REGISTRY } from '../src/main'
import * as os from 'os'
import * as process from 'process'
import * as cp from 'child_process'
import * as path from 'path'
import * as fs from 'fs'
import * as yaml from 'js-yaml'
import * as url from 'url'
import { expect, test } from '@jest/globals'

test('gets download url to binary', async () => {
  const url = await getDownloadUrl('1.28.0')
  expect(
    url.startsWith(
      'https://github.com/supabase/cli/releases/download/v1.28.0/supabase_'
    )
  ).toBeTruthy()
  expect(url.endsWith('.tar.gz')).toBeTruthy()
  expect(url).not.toContain('_1.28.0_')
})

test('gets legacy download url to binary', async () => {
  const url = await getDownloadUrl('0.1.0')
  expect(
    url.startsWith(
      `https://github.com/supabase/cli/releases/download/v0.1.0/supabase_0.1.0_`
    )
  ).toBeTruthy()
  expect(url.endsWith('.tar.gz')).toBeTruthy()
})

test('gets download url to latest version', async () => {
  const url = await getDownloadUrl('latest')
  expect(url).toMatch(
    'https://github.com/supabase/cli/releases/latest/download/'
  )
})

// shows how the runner will run a javascript action with env / stdout protocol
test('runs main action', () => {
  const { env, execPath } = process
  const repo = path.dirname(path.dirname(url.fileURLToPath(import.meta.url)))
  const config = path.join(repo, 'action.yml')
  const action = yaml.load(fs.readFileSync(config, 'utf8')) as {
    inputs: { version: { default: string } }
  }
  const ip = path.join(repo, 'dist', 'index.js')
  const stdout = cp
    .execFileSync(execPath, [ip], {
      env: {
        ...env,
        RUNNER_TEMP: os.tmpdir(),
        INPUT_VERSION: action.inputs.version.default
      }
    })
    .toString()
  expect
    .stringContaining(`::set-env name=${CLI_CONFIG_REGISTRY}::`)
    .asymmetricMatch(stdout)
})
