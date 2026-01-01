import fs from 'fs/promises'
import path from 'path'
import os from 'os'

const STATE_DIR = path.join(os.homedir(), '.cron-burgundy')
const STATE_FILE = path.join(STATE_DIR, 'state.json')
const STATE_LOCK_FILE = path.join(STATE_DIR, 'state.lock')
const LOCK_TIMEOUT_MS = 10000 // 10 seconds max wait for lock
const LOCK_STALE_MS = 30000  // 30 seconds - consider lock stale

/**
 * Ensure the state directory exists
 * @returns {Promise<void>}
 */
async function ensureStateDir() {
  await fs.mkdir(STATE_DIR, { recursive: true })
}

/**
 * Atomically write data to a file using write-then-rename pattern
 * @param {string} filePath
 * @param {string} data
 */
async function atomicWriteFile(filePath, data) {
  const dir = path.dirname(filePath)
  const tempFile = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`)

  try {
    await fs.writeFile(tempFile, data, 'utf8')
    await fs.rename(tempFile, filePath)
  } catch (error) {
    await fs.unlink(tempFile).catch(() => {})
    throw error
  }
}

/**
 * Acquire state lock with timeout
 * @returns {Promise<boolean>}
 */
async function acquireStateLock() {
  await ensureStateDir()
  const startTime = Date.now()

  while (Date.now() - startTime < LOCK_TIMEOUT_MS) {
    try {
      // Check for stale lock
      try {
        const stats = await fs.stat(STATE_LOCK_FILE)
        if (Date.now() - stats.mtimeMs > LOCK_STALE_MS) {
          await fs.unlink(STATE_LOCK_FILE).catch(() => {})
        }
      } catch (err) {
        if (err.code !== 'ENOENT') throw err
      }

      // Try to acquire lock with exclusive flag
      await fs.writeFile(STATE_LOCK_FILE, JSON.stringify({
        pid: process.pid,
        acquired: new Date().toISOString()
      }), { flag: 'wx' })
      return true
    } catch (err) {
      if (err.code === 'EEXIST') {
        // Lock held by another process, wait and retry
        await new Promise(resolve => setTimeout(resolve, 50))
        continue
      }
      throw err
    }
  }

  return false // Timeout
}

/**
 * Release state lock
 */
async function releaseStateLock() {
  await fs.unlink(STATE_LOCK_FILE).catch(() => {})
}

/**
 * Get the current state object (no lock - for read-only access)
 * @returns {Promise<Record<string, string>>} Map of jobId -> last run ISO timestamp
 */
export async function getState() {
  try {
    const data = await fs.readFile(STATE_FILE, 'utf8')
    return JSON.parse(data)
  } catch (err) {
    if (err.code === 'ENOENT') return {}
    throw err
  }
}

/**
 * Save the state object (internal - use updateState for safe writes)
 * @param {Record<string, string>} state - Map of jobId -> last run ISO timestamp
 * @returns {Promise<void>}
 */
async function saveState(state) {
  await ensureStateDir()
  await atomicWriteFile(STATE_FILE, JSON.stringify(state, null, 2))
}

/**
 * Safely update state with lock protection
 * @param {(state: Record<string, string>) => Record<string, string>} updater
 * @returns {Promise<void>}
 */
async function updateState(updater) {
  if (!await acquireStateLock()) {
    throw new Error('Failed to acquire state lock (timeout)')
  }

  try {
    const state = await getState()
    const newState = updater(state)
    await saveState(newState)
  } finally {
    await releaseStateLock()
  }
}

/**
 * Get the last run time for a specific job
 * @param {string} jobId
 * @returns {Promise<Date|null>}
 */
export async function getLastRun(jobId) {
  const state = await getState()
  const lastRun = state[jobId]
  return lastRun ? new Date(lastRun) : null
}

/**
 * Mark a job as having just run
 * @param {string} jobId
 * @returns {Promise<void>}
 */
export async function markRun(jobId) {
  await updateState(state => {
    state[jobId] = new Date().toISOString()
    return state
  })
}

export { STATE_DIR, STATE_FILE }
