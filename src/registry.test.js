/**
 * Tests for registry.js - job file loading
 */
import { test } from 'uvu'
import * as assert from 'uvu/assert'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import { fileURLToPath } from 'url'
import { loadJobsFromFile, qualifyJobId, parseQualifiedId } from './registry.js'

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

// qualifyJobId tests
test('qualifyJobId: no namespace returns jobId unchanged', () => {
  assert.equal(qualifyJobId('my-job', null), 'my-job')
  assert.equal(qualifyJobId('my-job', undefined), 'my-job')
  assert.equal(qualifyJobId('tick', null), 'tick')
})

test('qualifyJobId: with namespace returns namespace/jobId', () => {
  assert.equal(qualifyJobId('tick', 'pm'), 'pm/tick')
  assert.equal(qualifyJobId('my-job', 'app'), 'app/my-job')
  assert.equal(qualifyJobId('backup', 'prod'), 'prod/backup')
})

// parseQualifiedId tests
test('parseQualifiedId: simple id returns null namespace', () => {
  const result = parseQualifiedId('my-job')
  assert.equal(result.namespace, null)
  assert.equal(result.jobId, 'my-job')
})

test('parseQualifiedId: qualified id returns namespace and jobId', () => {
  const result = parseQualifiedId('pm/tick')
  assert.equal(result.namespace, 'pm')
  assert.equal(result.jobId, 'tick')
})

test('parseQualifiedId: handles job ids with hyphens', () => {
  const result = parseQualifiedId('app/my-long-job-name')
  assert.equal(result.namespace, 'app')
  assert.equal(result.jobId, 'my-long-job-name')
})

test('parseQualifiedId: roundtrip with qualifyJobId', () => {
  const qualified = qualifyJobId('tick', 'pm')
  const parsed = parseQualifiedId(qualified)
  assert.equal(parsed.namespace, 'pm')
  assert.equal(parsed.jobId, 'tick')
})

// Load failure tests
test('loadJobsFromFile: returns error for broken import', async () => {
  const tmpFile = path.join(os.tmpdir(), `test-broken-${Date.now()}.js`)
  await fs.writeFile(tmpFile, `
    import { doesNotExist } from './nonexistent.js'
    export const jobs = []
  `)

  try {
    const result = await loadJobsFromFile(tmpFile, 'testns')
    assert.is(result.file, tmpFile)
    assert.is(result.namespace, 'testns')
    assert.is(result.jobs.length, 0)
    assert.ok(result.error, 'should have error field')
    assert.ok(result.error.includes('Cannot find module'), 'error should mention missing module')
  } finally {
    await fs.unlink(tmpFile)
  }
})

test('loadJobsFromFile: returns error for syntax error', async () => {
  const tmpFile = path.join(os.tmpdir(), `test-syntax-${Date.now()}.js`)
  await fs.writeFile(tmpFile, `
    export const jobs = [
      { id: 'broken // missing closing brace
    ]
  `)

  try {
    const result = await loadJobsFromFile(tmpFile, null)
    assert.is(result.file, tmpFile)
    assert.is(result.namespace, null)
    assert.is(result.jobs.length, 0)
    assert.ok(result.error, 'should have error field')
  } finally {
    await fs.unlink(tmpFile)
  }
})

test.run()
