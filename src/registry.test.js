/**
 * Tests for registry.js - job file loading
 */
import { test } from 'uvu'
import * as assert from 'uvu/assert'
import path from 'path'
import { fileURLToPath } from 'url'
import { loadJobsFromFile } from './registry.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const fixtures = path.join(__dirname, 'test-fixtures')

test('loadJobsFromFile: loads ESM named export', async () => {
  const result = await loadJobsFromFile(path.join(fixtures, 'esm-jobs.mjs'))
  assert.equal(result.error, undefined)
  assert.equal(result.jobs.length, 1)
  assert.equal(result.jobs[0].id, 'esm-test')
})

test('loadJobsFromFile: loads CJS module.exports = { jobs }', async () => {
  const result = await loadJobsFromFile(path.join(fixtures, 'cjs-jobs.cjs'))
  assert.equal(result.error, undefined)
  assert.equal(result.jobs.length, 1)
  assert.equal(result.jobs[0].id, 'cjs-test')
})

test.run()
