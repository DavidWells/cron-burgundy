/**
 * Tests for state.js - uses real state file with unique test job IDs
 */
import { test } from 'uvu'
import * as assert from 'uvu/assert'
import fs from 'fs/promises'
import { getState, getLastRun, markRun, isPaused, pause, resume, getPauseStatus, STATE_FILE } from './state.js'

// Generate unique test job ID to avoid conflicts
const testId = () => `test-state-${Date.now()}-${Math.random().toString(36).slice(2)}`

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
}

test('getLastRun: returns null for unknown job', async () => {
  const jobId = testId()
  const lastRun = await getLastRun(jobId)
  assert.equal(lastRun, null)
})

test('markRun: records run time', async () => {
  const jobId = testId()
  try {
    const before = Date.now()
    await markRun(jobId)
    const after = Date.now()

    const lastRun = await getLastRun(jobId)
    assert.ok(lastRun instanceof Date, 'should return Date')
    assert.ok(lastRun.getTime() >= before, 'should be after start')
    assert.ok(lastRun.getTime() <= after, 'should be before end')
  } finally {
    await cleanupTestEntry(jobId)
  }
})

test('markRun: updates existing run time', async () => {
  const jobId = testId()
  try {
    await markRun(jobId)
    const first = await getLastRun(jobId)

    // Wait a bit to ensure different timestamp
    await new Promise(r => setTimeout(r, 10))

    await markRun(jobId)
    const second = await getLastRun(jobId)

    assert.ok(second.getTime() > first.getTime(), 'second run should be later')
  } finally {
    await cleanupTestEntry(jobId)
  }
})

test('markRun: records nextRun when interval provided', async () => {
  const jobId = testId()
  try {
    await markRun(jobId, { interval: 60000 }) // 1 minute

    const state = await getState()
    const nextRun = state[`${jobId}:nextRun`]
    assert.ok(nextRun, 'should have nextRun entry')

    const nextRunDate = new Date(nextRun)
    const lastRun = await getLastRun(jobId)
    const diff = nextRunDate.getTime() - lastRun.getTime()
    assert.ok(Math.abs(diff - 60000) < 100, 'nextRun should be ~1 minute after lastRun')
  } finally {
    await cleanupTestEntry(jobId)
  }
})

test('isPaused: returns false for unpaused job', async () => {
  const jobId = testId()
  const paused = await isPaused(jobId)
  assert.equal(paused, false)
})

test('pause/resume: pauses and resumes specific job', async () => {
  const jobId = testId()
  try {
    await pause(jobId)
    assert.equal(await isPaused(jobId), true, 'should be paused')

    await resume(jobId)
    assert.equal(await isPaused(jobId), false, 'should be resumed')
  } finally {
    await cleanupTestEntry(jobId)
  }
})

test('getPauseStatus: returns correct status', async () => {
  const jobId = testId()
  try {
    const initial = await getPauseStatus()
    assert.equal(initial.all, false)
    assert.ok(Array.isArray(initial.jobs))

    await pause(jobId)
    const afterPause = await getPauseStatus()
    assert.equal(afterPause.all, false)
    assert.ok(afterPause.jobs.includes(jobId), 'should include paused job')

    await resume(jobId)
    const afterResume = await getPauseStatus()
    assert.not.ok(afterResume.jobs.includes(jobId), 'should not include resumed job')
  } finally {
    await cleanupTestEntry(jobId)
  }
})

test('pause: multiple jobs can be paused independently', async () => {
  const jobId1 = testId()
  const jobId2 = testId()
  try {
    await pause(jobId1)
    await pause(jobId2)

    assert.equal(await isPaused(jobId1), true)
    assert.equal(await isPaused(jobId2), true)

    await resume(jobId1)
    assert.equal(await isPaused(jobId1), false)
    assert.equal(await isPaused(jobId2), true, 'job2 should still be paused')
  } finally {
    await cleanupTestEntry(jobId1)
    await cleanupTestEntry(jobId2)
  }
})

test('getState: returns empty object when no state file', async () => {
  // This test just verifies getState doesn't throw for missing entries
  const state = await getState()
  assert.ok(typeof state === 'object', 'should return object')
})

test.run()
