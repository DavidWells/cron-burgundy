import fs from 'fs/promises'
import fsSync from 'fs'
import path from 'path'
import os from 'os'
import { onAnyExit } from '@davidwells/graceful-exit'

const LOCK_DIR = path.join(os.homedir(), '.cron-burgundy', 'locks')
const DEFAULT_STALE_LOCK_MS = 60 * 60 * 1000 // 1 hour default

// Track active locks for cleanup on exit
const activeLocks = new Set()

// Register cleanup handler once
onAnyExit(() => {
  for (const jobId of activeLocks) {
    const lockPath = getLockPath(jobId)
    try {
      fsSync.unlinkSync(lockPath)
      console.log(`[${jobId}] Lock released on exit`)
    } catch (err) {
      // Ignore errors during cleanup
    }
  }
})

/**
 * Get lock file path for a job
 * @param {string} jobId
 * @returns {string}
 */
function getLockPath(jobId) {
  return path.join(LOCK_DIR, `${jobId}.lock`)
}

/**
 * Ensure lock directory exists
 */
async function ensureLockDir() {
  await fs.mkdir(LOCK_DIR, { recursive: true })
}

/**
 * Check if a lock file exists and is not stale
 * @param {string} jobId
 * @param {number} [staleLockMs] - Custom stale threshold (default: 1 hour)
 * @returns {Promise<boolean>}
 */
async function isLocked(jobId, staleLockMs = DEFAULT_STALE_LOCK_MS) {
  const lockPath = getLockPath(jobId)

  try {
    const content = await fs.readFile(lockPath, 'utf8')
    const lockData = JSON.parse(content)
    const stats = await fs.stat(lockPath)
    const age = Date.now() - stats.mtimeMs

    // If lock is old, remove it regardless of PID (handles PID reuse)
    if (age > staleLockMs) {
      console.log(`[${jobId}] Removing stale lock (${Math.round(age / 1000 / 60)}min old)`)
      await fs.unlink(lockPath).catch(() => {})
      return false
    }

    // Lock is recent - check if owning process is still alive
    if (lockData.pid) {
      try {
        // kill(pid, 0) checks if process exists without sending signal
        process.kill(lockData.pid, 0)
        // Process is alive - lock is valid
        return true
      } catch (err) {
        // ESRCH = No such process - lock is stale
        if (err.code === 'ESRCH') {
          console.log(`[${jobId}] Removing stale lock (PID ${lockData.pid} dead)`)
          await fs.unlink(lockPath).catch(() => {})
          return false
        }
        // EPERM = process exists but we can't signal it - lock is valid
        if (err.code === 'EPERM') {
          return true
        }
      }
    }

    // No PID in lock data but lock is recent - assume valid
    return true
  } catch (err) {
    if (err.code === 'ENOENT') return false
    // JSON parse error or other - treat as stale
    if (err instanceof SyntaxError) {
      await fs.unlink(lockPath).catch(() => {})
      return false
    }
    throw err
  }
}

/**
 * Acquire a lock for a job
 * @param {string} jobId
 * @param {{ staleLockMs?: number }} [options]
 * @returns {Promise<boolean>} True if lock acquired, false if already locked
 */
export async function acquireLock(jobId, options = {}) {
  await ensureLockDir()

  if (await isLocked(jobId, options.staleLockMs)) {
    return false
  }
  
  const lockPath = getLockPath(jobId)
  const lockData = {
    pid: process.pid,
    acquired: new Date().toISOString()
  }
  
  try {
    // Use exclusive flag to prevent race conditions
    await fs.writeFile(lockPath, JSON.stringify(lockData), { flag: 'wx' })
    // Track for cleanup on exit
    activeLocks.add(jobId)
    return true
  } catch (err) {
    if (err.code === 'EEXIST') {
      // Another process beat us to it
      return false
    }
    throw err
  }
}

/**
 * Release a lock for a job
 * @param {string} jobId
 */
export async function releaseLock(jobId) {
  const lockPath = getLockPath(jobId)
  // Remove from active tracking
  activeLocks.delete(jobId)
  try {
    await fs.unlink(lockPath)
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
  }
}

/**
 * Release lock synchronously (for process exit handlers)
 * @param {string} jobId
 */
export function releaseLockSync(jobId) {
  const lockPath = getLockPath(jobId)
  try {
    fsSync.unlinkSync(lockPath)
  } catch (err) {
    // Ignore errors
  }
}

/**
 * Run a function with a lock - ensures only one instance runs at a time
 * @param {string} jobId
 * @param {() => Promise<void>} fn
 * @param {{ staleLockMs?: number }} [options]
 * @returns {Promise<boolean>} True if ran, false if skipped due to lock
 */
export async function withLock(jobId, fn, options = {}) {
  if (!await acquireLock(jobId, options)) {
    console.log(`[${jobId}] Skipped - another instance is running (locked)`)
    return false
  }
  
  try {
    await fn()
    return true
  } finally {
    await releaseLock(jobId)
  }
}

export { LOCK_DIR }
