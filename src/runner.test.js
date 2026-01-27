/**
 * Tests for runner.js - job execution logic
 */
import { test } from 'uvu'
import * as assert from 'uvu/assert'
import fs from 'fs/promises'
import { runAllDue, runJobNow, checkMissed } from './runner.js'
import { getLastRun, markRun, pause, resume, STATE_FILE } from './state.js'
import { clearLock, LOCK_DIR } from './lock.js'

// Generate unique test job ID to avoid conflicts
const testId = () => `test-runner-${Date.now()}-${Math.random().toString(36).slice(2)}`

// Helper to clean up test entries from state
async function cleanupTestEntry(jobId) {
  try {
    const data = await fs.readFile(STATE_FILE, 'utf8')
    const state = JSON.parse(data)
    delete state[jobId]
    delete state[`${jobId}:nextRun`]
    // Remove from _paused array if present
    if (Array.isArray(state._paused)) {
      state._paused = state._paused.filter(id => id !== jobId)
      if (state._paused.length === 0) delete state._paused
    }
    await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2))
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
  }
  // Also clean up lock file if exists
  await clearLock(jobId)
}

// ========================
// runAllDue tests
// ========================

test('runAllDue: runs job that has never run', async () => {
  const jobId = testId()
  let executed = false

  const jobs = [{
    id: jobId,
    interval: 60000,
    run: async () => { executed = true }
  }]

  try {
    const result = await runAllDue(jobs)
    assert.ok(executed, 'job should have executed')
    assert.ok(result.ran.includes(jobId), 'job should be in ran array')
    assert.equal(result.skipped.length, 0, 'should have no skipped jobs')
  } finally {
    await cleanupTestEntry(jobId)
  }
})

test('runAllDue: skips job that ran recently', async () => {
  const jobId = testId()
  let executed = false

  const jobs = [{
    id: jobId,
    interval: 60000, // 1 minute
    run: async () => { executed = true }
  }]

  try {
    // Mark as just run
    await markRun(jobId)

    const result = await runAllDue(jobs)
    assert.not.ok(executed, 'job should not have executed')
    assert.ok(result.skipped.includes(jobId), 'job should be in skipped array')
    assert.equal(result.ran.length, 0, 'should have no ran jobs')
  } finally {
    await cleanupTestEntry(jobId)
  }
})

test('runAllDue: skips disabled jobs', async () => {
  const jobId = testId()
  let executed = false

  const jobs = [{
    id: jobId,
    interval: 60000,
    enabled: false,
    run: async () => { executed = true }
  }]

  try {
    const result = await runAllDue(jobs)
    assert.not.ok(executed, 'disabled job should not execute')
    assert.ok(result.disabled.includes(jobId), 'job should be in disabled array')
    assert.equal(result.ran.length, 0)
  } finally {
    await cleanupTestEntry(jobId)
  }
})

test('runAllDue: skips paused jobs', async () => {
  const jobId = testId()
  let executed = false

  const jobs = [{
    id: jobId,
    interval: 60000,
    run: async () => { executed = true }
  }]

  try {
    await pause(jobId)

    const result = await runAllDue(jobs)
    assert.not.ok(executed, 'paused job should not execute')
    assert.ok(result.paused.includes(jobId), 'job should be in paused array')
  } finally {
    await resume(jobId)
    await cleanupTestEntry(jobId)
  }
})

test('runAllDue: handles multiple jobs', async () => {
  const jobId1 = testId()
  const jobId2 = testId()
  const jobId3 = testId()
  let executed1 = false
  let executed2 = false
  let executed3 = false

  const jobs = [
    { id: jobId1, interval: 60000, run: async () => { executed1 = true } },
    { id: jobId2, interval: 60000, enabled: false, run: async () => { executed2 = true } },
    { id: jobId3, interval: 60000, run: async () => { executed3 = true } }
  ]

  try {
    const result = await runAllDue(jobs)

    assert.ok(executed1, 'first job should execute')
    assert.not.ok(executed2, 'disabled job should not execute')
    assert.ok(executed3, 'third job should execute')

    assert.equal(result.ran.length, 2)
    assert.equal(result.disabled.length, 1)
  } finally {
    await cleanupTestEntry(jobId1)
    await cleanupTestEntry(jobId2)
    await cleanupTestEntry(jobId3)
  }
})

test('runAllDue: records failed jobs separately', async () => {
  const jobId = testId()

  const jobs = [{
    id: jobId,
    interval: 60000,
    run: async () => { throw new Error('test error') }
  }]

  try {
    const result = await runAllDue(jobs)
    assert.ok(result.failed.includes(jobId), 'failed job should be in failed array')
    assert.not.ok(result.skipped.includes(jobId), 'failed job should not be in skipped array')
  } finally {
    await cleanupTestEntry(jobId)
  }
})

// ========================
// runJobNow tests
// ========================

test('runJobNow: executes job immediately', async () => {
  const jobId = testId()
  let executed = false

  const job = {
    id: jobId,
    interval: 60000,
    run: async () => { executed = true }
  }

  try {
    await runJobNow(job)
    assert.ok(executed, 'job should have executed')

    const lastRun = await getLastRun(jobId)
    assert.ok(lastRun instanceof Date, 'should have recorded last run')
  } finally {
    await cleanupTestEntry(jobId)
  }
})

test('runJobNow: passes context to job function', async () => {
  const jobId = testId()
  let receivedCtx = null

  const job = {
    id: jobId,
    interval: 60000,
    run: async (ctx) => { receivedCtx = ctx }
  }

  try {
    await runJobNow(job)
    assert.ok(receivedCtx, 'should receive context')
    assert.ok(receivedCtx.logger, 'should have logger')
    assert.ok(receivedCtx.utils, 'should have utils')
  } finally {
    await cleanupTestEntry(jobId)
  }
})

test('runJobNow: skips paused job when scheduled', async () => {
  const jobId = testId()
  let executed = false

  const job = {
    id: jobId,
    interval: 60000,
    run: async () => { executed = true }
  }

  try {
    await pause(jobId)
    await runJobNow(job, { scheduled: true })
    assert.not.ok(executed, 'paused job should not execute when scheduled')
  } finally {
    await resume(jobId)
    await cleanupTestEntry(jobId)
  }
})

test('runJobNow: throws on job failure', async () => {
  const jobId = testId()

  const job = {
    id: jobId,
    interval: 60000,
    run: async () => { throw new Error('test error') }
  }

  try {
    await runJobNow(job)
    assert.unreachable('should have thrown')
  } catch (err) {
    assert.ok(err.message.includes('test error'), 'should throw job error')
  } finally {
    await cleanupTestEntry(jobId)
  }
})

// ========================
// checkMissed tests
// ========================

test('checkMissed: runs jobs that are overdue', async () => {
  const jobId = testId()
  let executed = false

  const jobs = [{
    id: jobId,
    interval: 1000, // 1 second interval
    run: async () => { executed = true }
  }]

  try {
    // Mark as run 2 seconds ago (overdue by 1 second)
    const twoSecondsAgo = new Date(Date.now() - 2000)
    const data = await fs.readFile(STATE_FILE, 'utf8').catch(() => '{}')
    const state = JSON.parse(data)
    state[jobId] = twoSecondsAgo.toISOString()
    await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2))

    const result = await checkMissed(jobs)
    assert.ok(executed, 'overdue job should execute')
    assert.ok(result.ran.includes(jobId), 'job should be in ran array')
  } finally {
    await cleanupTestEntry(jobId)
  }
})

test('checkMissed: skips jobs that are not overdue', async () => {
  const jobId = testId()
  let executed = false

  const jobs = [{
    id: jobId,
    interval: 60000, // 1 minute interval
    run: async () => { executed = true }
  }]

  try {
    // Mark as just run
    await markRun(jobId)

    const result = await checkMissed(jobs)
    assert.not.ok(executed, 'not overdue job should not execute')
    assert.ok(result.skipped.includes(jobId), 'job should be in skipped array')
  } finally {
    await cleanupTestEntry(jobId)
  }
})

test('checkMissed: skips disabled jobs', async () => {
  const jobId = testId()
  let executed = false

  const jobs = [{
    id: jobId,
    interval: 60000,
    enabled: false,
    run: async () => { executed = true }
  }]

  try {
    const result = await checkMissed(jobs)
    assert.not.ok(executed, 'disabled job should not execute')
    // Disabled jobs are filtered out before check, so they won't appear in results
    assert.equal(result.ran.length, 0)
  } finally {
    await cleanupTestEntry(jobId)
  }
})

test('checkMissed: skips paused jobs', async () => {
  const jobId = testId()
  let executed = false

  const jobs = [{
    id: jobId,
    interval: 1000,
    run: async () => { executed = true }
  }]

  try {
    await pause(jobId)

    const result = await checkMissed(jobs)
    assert.not.ok(executed, 'paused job should not execute')
    assert.ok(result.skipped.includes(jobId), 'paused job should be in skipped array')
  } finally {
    await resume(jobId)
    await cleanupTestEntry(jobId)
  }
})

// ========================
// Qualified ID tests
// ========================

test('runAllDue: uses _qualifiedId for state operations', async () => {
  const baseId = testId()
  const qualifiedId = `ns/${baseId}`
  let executed = false

  const jobs = [{
    id: baseId,
    _qualifiedId: qualifiedId,
    interval: 60000,
    run: async () => { executed = true }
  }]

  try {
    const result = await runAllDue(jobs)
    assert.ok(executed, 'job should have executed')
    assert.ok(result.ran.includes(qualifiedId), 'ran array should use qualified ID')

    // State should be recorded under qualified ID
    const lastRun = await getLastRun(qualifiedId)
    assert.ok(lastRun instanceof Date, 'should have recorded last run under qualified ID')
  } finally {
    await cleanupTestEntry(qualifiedId)
  }
})

test('runAllDue: two jobs with same base ID but different namespaces run independently', async () => {
  const baseId = testId()
  const qid1 = `ns1/${baseId}`
  const qid2 = `ns2/${baseId}`
  let executed1 = false
  let executed2 = false

  const jobs = [
    { id: baseId, _qualifiedId: qid1, interval: 60000, run: async () => { executed1 = true } },
    { id: baseId, _qualifiedId: qid2, interval: 60000, run: async () => { executed2 = true } }
  ]

  try {
    const result = await runAllDue(jobs)
    assert.ok(executed1, 'first namespace job should execute')
    assert.ok(executed2, 'second namespace job should execute')
    assert.ok(result.ran.includes(qid1), 'ran should include first qualified ID')
    assert.ok(result.ran.includes(qid2), 'ran should include second qualified ID')
  } finally {
    await cleanupTestEntry(qid1)
    await cleanupTestEntry(qid2)
  }
})

test('runAllDue: routes failed jobs to failed array', async () => {
  const jobId = testId()

  const jobs = [{
    id: jobId,
    interval: 60000,
    run: async () => { throw new Error('test error') }
  }]

  try {
    const result = await runAllDue(jobs)
    assert.ok(result.failed.includes(jobId), 'failed job should be in failed array')
    assert.not.ok(result.skipped.includes(jobId), 'failed job should NOT be in skipped array')
  } finally {
    await cleanupTestEntry(jobId)
  }
})

test('checkMissed: uses _qualifiedId for state operations', async () => {
  const baseId = testId()
  const qualifiedId = `ns/${baseId}`
  let executed = false

  const jobs = [{
    id: baseId,
    _qualifiedId: qualifiedId,
    interval: 1000,
    run: async () => { executed = true }
  }]

  try {
    // Mark as run 2 seconds ago under qualified ID
    const twoSecondsAgo = new Date(Date.now() - 2000)
    const data = await fs.readFile(STATE_FILE, 'utf8').catch(() => '{}')
    const state = JSON.parse(data)
    state[qualifiedId] = twoSecondsAgo.toISOString()
    await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2))

    const result = await checkMissed(jobs)
    assert.ok(executed, 'overdue job should execute')
    assert.ok(result.ran.includes(qualifiedId), 'ran array should use qualified ID')
  } finally {
    await cleanupTestEntry(qualifiedId)
  }
})

test.run()
