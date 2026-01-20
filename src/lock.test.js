/**
 * Tests for lock.js - uses real filesystem with unique test job IDs
 */
import { test } from 'uvu'
import * as assert from 'uvu/assert'
import { acquireLock, releaseLock, withLock, clearLock } from './lock.js'

// Generate unique test job ID to avoid conflicts
const testId = () => `test-lock-${Date.now()}-${Math.random().toString(36).slice(2)}`

test('acquireLock: acquires lock for new job', async () => {
  const jobId = testId()
  try {
    const acquired = await acquireLock(jobId)
    assert.equal(acquired, true, 'should acquire lock')
  } finally {
    await clearLock(jobId)
  }
})

test('acquireLock: fails when lock already held', async () => {
  const jobId = testId()
  try {
    const first = await acquireLock(jobId)
    assert.equal(first, true, 'first acquire should succeed')

    const second = await acquireLock(jobId)
    assert.equal(second, false, 'second acquire should fail')
  } finally {
    await clearLock(jobId)
  }
})

test('releaseLock: releases held lock', async () => {
  const jobId = testId()
  try {
    await acquireLock(jobId)
    await releaseLock(jobId)

    // Should be able to acquire again
    const reacquired = await acquireLock(jobId)
    assert.equal(reacquired, true, 'should reacquire after release')
  } finally {
    await clearLock(jobId)
  }
})

test('releaseLock: no error when lock does not exist', async () => {
  const jobId = testId()
  // Should not throw
  await releaseLock(jobId)
})

test('withLock: runs function when lock available', async () => {
  const jobId = testId()
  let executed = false

  try {
    const result = await withLock(jobId, async () => {
      executed = true
    })
    assert.equal(result, true, 'withLock should return true')
    assert.equal(executed, true, 'function should execute')
  } finally {
    await clearLock(jobId)
  }
})

test('withLock: skips function when lock held', async () => {
  const jobId = testId()
  let executed = false

  try {
    await acquireLock(jobId)

    const result = await withLock(jobId, async () => {
      executed = true
    })
    assert.equal(result, false, 'withLock should return false')
    assert.equal(executed, false, 'function should not execute')
  } finally {
    await clearLock(jobId)
  }
})

test('withLock: releases lock after function completes', async () => {
  const jobId = testId()

  try {
    await withLock(jobId, async () => {})

    // Should be able to acquire again
    const acquired = await acquireLock(jobId)
    assert.equal(acquired, true, 'should acquire after withLock completes')
  } finally {
    await clearLock(jobId)
  }
})

test('withLock: releases lock even if function throws', async () => {
  const jobId = testId()

  try {
    await withLock(jobId, async () => {
      throw new Error('test error')
    }).catch(() => {})

    // Should be able to acquire again
    const acquired = await acquireLock(jobId)
    assert.equal(acquired, true, 'should acquire after withLock throws')
  } finally {
    await clearLock(jobId)
  }
})

test('clearLock: clears existing lock', async () => {
  const jobId = testId()

  await acquireLock(jobId)
  const cleared = await clearLock(jobId)
  assert.equal(cleared, true, 'should return true when lock cleared')

  // Verify cleared
  const acquired = await acquireLock(jobId)
  assert.equal(acquired, true, 'should acquire after clear')
  await clearLock(jobId)
})

test('clearLock: returns false when no lock exists', async () => {
  const jobId = testId()
  const cleared = await clearLock(jobId)
  assert.equal(cleared, false, 'should return false when no lock')
})

test('acquireLock: handles namespaced job IDs', async () => {
  const jobId = `test-ns/${testId()}`
  try {
    const acquired = await acquireLock(jobId)
    assert.equal(acquired, true, 'should acquire namespaced lock')
  } finally {
    await clearLock(jobId)
  }
})

test.run()
