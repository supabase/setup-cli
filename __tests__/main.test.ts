import {getDownloadUrl} from '../src/utils'
import * as os from 'os'
import * as process from 'process'
import * as cp from 'child_process'
import * as path from 'path'
import {expect, test} from '@jest/globals'

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
test('test runs', () => {
  process.env['RUNNER_TEMP'] = os.tmpdir()
  process.env['INPUT_VERSION'] = '1.0.0'
  const np = process.execPath
  const ip = path.join(__dirname, '..', 'lib', 'main.js')
  const options: cp.ExecFileSyncOptions = {
    env: process.env
  }
  console.log(cp.execFileSync(np, [ip], options).toString())
})
