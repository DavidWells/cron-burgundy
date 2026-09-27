/**
 * Tests for paths.js - state/log dir resolution and test isolation
 */
import { TEST_HOME } from './test-fixtures/isolated-home.js'
import { test } from 'uvu'
import * as assert from 'uvu/assert'
import fs from 'fs'
import { STATE_FILE, markRun } from './state.js'
import { LOCK_DIR } from './lock.js'
import { LOG_DIR, JOBS_LOG_DIR, logJob } from './logger.js'
import { getRegistry, registerFile } from './registry.js'

test('CRON_BURGUNDY_HOME redirects state, locks, and logs', () => {
  assert.ok(STATE_FILE.startsWith(TEST_HOME), STATE_FILE)
  assert.ok(LOCK_DIR.startsWith(TEST_HOME), LOCK_DIR)
  assert.ok(LOG_DIR.startsWith(TEST_HOME), LOG_DIR)
})

test('writes land in CRON_BURGUNDY_HOME', async () => {
  await markRun('paths-test-job')
  await logJob('paths-test-job', 'hello')
  assert.ok(fs.existsSync(STATE_FILE))
  assert.ok(fs.existsSync(`${JOBS_LOG_DIR}/paths-test-job.log`))
})

test('registry reads and writes in CRON_BURGUNDY_HOME', async () => {
  await registerFile('/tmp/paths-test-jobs.js', 'paths-test')
  const registry = await getRegistry()
  assert.equal(registry.files.map(f => f.path), ['/tmp/paths-test-jobs.js'])
  assert.ok(fs.existsSync(`${TEST_HOME}/registry.json`))
})

test.run()
