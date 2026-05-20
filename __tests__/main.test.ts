import { getCliPath, getDownloadArchive, getDownloadUrl } from '../src/utils'
import { CLI_CONFIG_REGISTRY } from '../src/main'
import * as os from 'os'
import * as process from 'process'
import * as cp from 'child_process'
import * as path from 'path'
import * as fs from 'fs'
import * as yaml from 'js-yaml'
import * as url from 'url'
import { afterEach, expect, jest, test } from '@jest/globals'

afterEach(() => {
  jest.restoreAllMocks()
})

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
  jest.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ tag_name: 'v2.99.0' }), {
      status: 200,
      statusText: 'OK'
    })
  )

  const url = await getDownloadUrl('latest')
  expect(url).toContain('/download/v2.99.0/supabase_2.99.0_')
  expect(url).toMatch(/\.tar\.gz$|\.zip$/)
})

test('gets versioned archive url to binary from Supabase CLI v2.99.0', async () => {
  const archive = await getDownloadArchive('2.99.0', 'linux', 'x64')

  expect(archive).toEqual({
    url: 'https://github.com/supabase/cli/releases/download/v2.99.0/supabase_2.99.0_linux_amd64.tar.gz',
    format: 'tar'
  })
})

test('gets apk archive url on Linux musl from Supabase CLI v2.99.0', async () => {
  const archive = await getDownloadArchive('2.99.0', 'linux', 'x64', true)

  expect(archive).toEqual({
    url: 'https://github.com/supabase/cli/releases/download/v2.99.0/supabase_2.99.0_linux_amd64.apk',
    format: 'apk'
  })
})

test('keeps tar archives before Supabase CLI v2.99.0 on Linux musl', async () => {
  const archive = await getDownloadArchive('2.98.2', 'linux', 'x64', true)

  expect(archive).toEqual({
    url: 'https://github.com/supabase/cli/releases/download/v2.98.2/supabase_linux_amd64.tar.gz',
    format: 'tar'
  })
})

test('uses usr/bin as the CLI path for apk archives', () => {
  expect(getCliPath('/tmp/extracted', 'apk')).toBe('/tmp/extracted/usr/bin')
  expect(getCliPath('/tmp/extracted', 'tar')).toBe('/tmp/extracted')
  expect(getCliPath('/tmp/extracted', 'zip')).toBe('/tmp/extracted')
})

test('gets versioned zip archive url on Windows from Supabase CLI v2.99.0', async () => {
  const archive = await getDownloadArchive('2.99.0', 'win32', 'x64')

  expect(archive).toEqual({
    url: 'https://github.com/supabase/cli/releases/download/v2.99.0/supabase_2.99.0_windows_amd64.zip',
    format: 'zip'
  })
})

test('keeps unversioned archive url to binary before Supabase CLI v2.99.0', async () => {
  const url = await getDownloadUrl('2.98.2')

  expect(url).toContain('/download/v2.98.2/supabase_')
  expect(url).not.toContain('supabase_2.98.2_')
  expect(url).toMatch(/\.tar\.gz$/)
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
