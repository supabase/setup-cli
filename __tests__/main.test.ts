import {getDownloadUrl} from '../src/utils'
import * as os from 'os'
import * as process from 'process'
import * as cp from 'child_process'
import * as path from 'path'
import {expect, test} from '@jest/globals'

test('returns download path to binary', async () => {
  const url = getDownloadUrl('0.1.0')
  expect(url).toContain(
    'https://github.com/supabase/cli/releases/download/v0.1.0/'
  )
})

// shows how the runner will run a javascript action with env / stdout protocol
test('test runs', () => {
  process.env['RUNNER_TEMP'] = os.tmpdir()
  process.env['INPUT_VERSION'] = '0.32.1'
  const np = process.execPath
  const ip = path.join(__dirname, '..', 'lib', 'main.js')
  const options: cp.ExecFileSyncOptions = {
    env: process.env
  }
  console.log(cp.execFileSync(np, [ip], options).toString())
})
