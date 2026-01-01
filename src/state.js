import fs from 'fs/promises'
import path from 'path'
import os from 'os'

const STATE_DIR = path.join(os.homedir(), '.cron-burgundy')
const STATE_FILE = path.join(STATE_DIR, 'state.json')

/**
 * Ensure the state directory exists
 * @returns {Promise<void>}
 */
async function ensureStateDir() {
  try {
    await fs.mkdir(STATE_DIR, { recursive: true })
  } catch (err) {
    if (err.code !== 'EEXIST') throw err
  }
}

/**
 * Get the current state object
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
 * Save the state object
 * @param {Record<string, string>} state - Map of jobId -> last run ISO timestamp
 * @returns {Promise<void>}
 */
export async function saveState(state) {
  await ensureStateDir()
  await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2))
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
  const state = await getState()
  state[jobId] = new Date().toISOString()
  await saveState(state)
}

export { STATE_DIR, STATE_FILE }
