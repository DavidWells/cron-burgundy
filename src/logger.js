import fs from 'fs/promises'
import path from 'path'
import os from 'os'

const LOG_DIR = path.join(os.homedir(), '.cron-burgundy')
const JOBS_LOG_DIR = path.join(LOG_DIR, 'jobs')
const RUNNER_LOG = path.join(LOG_DIR, 'runner.log')

// Log rotation settings
const MAX_LOG_SIZE = 20 * 1024 * 1024  // 20MB
const MAX_ROTATED_FILES = 2            // Keep .log, .log.1, .log.2

/**
 * Ensure log directories exist
 */
async function ensureLogDirs() {
  await fs.mkdir(JOBS_LOG_DIR, { recursive: true })
}

/**
 * Rotate log file if it exceeds max size
 * @param {string} filePath
 */
async function rotateIfNeeded(filePath) {
  try {
    const stats = await fs.stat(filePath)
    if (stats.size < MAX_LOG_SIZE) return

    // Rotate: .log.2 -> delete, .log.1 -> .log.2, .log -> .log.1
    for (let i = MAX_ROTATED_FILES; i >= 1; i--) {
      const from = i === 1 ? filePath : `${filePath}.${i - 1}`
      const to = `${filePath}.${i}`
      try {
        if (i === MAX_ROTATED_FILES) {
          await fs.unlink(to).catch(() => {})
        }
        await fs.rename(from, to)
      } catch (err) {
        if (err.code !== 'ENOENT') throw err
      }
    }
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
  }
}

/**
 * Delete a log file and all its rotated versions
 * @param {string} filePath
 */
async function deleteLogWithRotations(filePath) {
  // Delete main file
  await fs.unlink(filePath).catch(err => {
    if (err.code !== 'ENOENT') throw err
  })
  // Delete rotated files
  for (let i = 1; i <= MAX_ROTATED_FILES; i++) {
    await fs.unlink(`${filePath}.${i}`).catch(err => {
      if (err.code !== 'ENOENT') throw err
    })
  }
}

const SEPARATOR = '────────────────────────────────────────'

/**
 * Format timestamp for logs
 * @returns {string}
 */
function timestamp() {
  return new Date().toISOString()
}

/**
 * Append a line to a log file (with rotation)
 * @param {string} filePath
 * @param {string} message
 */
async function appendLog(filePath, message) {
  await ensureLogDirs()
  await rotateIfNeeded(filePath)
  const line = `[${timestamp()}] ${message}\n`
  await fs.appendFile(filePath, line)
}

/**
 * Log to the main runner log
 * @param {string} message
 */
export async function logRunner(message) {
  console.log(message)
  await appendLog(RUNNER_LOG, message)
}

/**
 * Log a separator to the runner log (for visual breaks between runs)
 */
export async function logRunnerSeparator() {
  await ensureLogDirs()
  await fs.appendFile(RUNNER_LOG, `[${timestamp()}] ${SEPARATOR}\n`)
}

/**
 * Log to a specific job's log file
 * @param {string} jobId
 * @param {string} message
 */
export async function logJob(jobId, message) {
  const jobLogPath = path.join(JOBS_LOG_DIR, `${jobId}.log`)
  await appendLog(jobLogPath, message)
}

/**
 * Log a separator to a job's log file
 * @param {string} jobId
 */
export async function logJobSeparator(jobId) {
  await ensureLogDirs()
  const jobLogPath = path.join(JOBS_LOG_DIR, `${jobId}.log`)
  await fs.appendFile(jobLogPath, `[${timestamp()}] ${SEPARATOR}\n`)
}

/**
 * Create a logger bound to a specific job
 * @param {string} jobId
 * @returns {{ log: (msg: string) => Promise<void> }}
 */
export function createJobLogger(jobId) {
  return {
    log: (message) => logJob(jobId, message)
  }
}

/**
 * Read recent lines from runner log
 * @param {number} lines
 * @returns {Promise<string>}
 */
export async function readRunnerLog(lines = 50) {
  try {
    const content = await fs.readFile(RUNNER_LOG, 'utf8')
    const allLines = content.trim().split('\n')
    return allLines.slice(-lines).join('\n')
  } catch (err) {
    if (err.code === 'ENOENT') return '(no logs yet)'
    throw err
  }
}

/**
 * Read recent lines from a job log
 * @param {string} jobId
 * @param {number} lines
 * @returns {Promise<string>}
 */
export async function readJobLog(jobId, lines = 50) {
  try {
    const jobLogPath = path.join(JOBS_LOG_DIR, `${jobId}.log`)
    const content = await fs.readFile(jobLogPath, 'utf8')
    const allLines = content.trim().split('\n')
    return allLines.slice(-lines).join('\n')
  } catch (err) {
    if (err.code === 'ENOENT') return '(no logs yet)'
    throw err
  }
}

/**
 * Clear the runner log (and rotated files)
 * @returns {Promise<void>}
 */
export async function clearRunnerLog() {
  await deleteLogWithRotations(RUNNER_LOG)
}

/**
 * Clear a specific job's log (and rotated files)
 * @param {string} jobId
 * @returns {Promise<void>}
 */
export async function clearJobLog(jobId) {
  const jobLogPath = path.join(JOBS_LOG_DIR, `${jobId}.log`)
  await deleteLogWithRotations(jobLogPath)
}

/**
 * Clear all job logs (and rotated files)
 * @returns {Promise<string[]>} List of cleared job IDs
 */
export async function clearAllJobLogs() {
  const cleared = new Set()
  try {
    const files = await fs.readdir(JOBS_LOG_DIR)
    for (const file of files) {
      // Match .log and .log.1, .log.2, etc.
      const match = file.match(/^(.+)\.log(\.\d+)?$/)
      if (match) {
        const jobId = match[1]
        if (!cleared.has(jobId)) {
          await deleteLogWithRotations(path.join(JOBS_LOG_DIR, `${jobId}.log`))
          cleared.add(jobId)
        }
      }
    }
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
  }
  return [...cleared]
}

/**
 * List all log files
 * @returns {Promise<{runner: string, jobs: {id: string, path: string}[]}>}
 */
export async function listLogFiles() {
  const jobs = []
  try {
    const files = await fs.readdir(JOBS_LOG_DIR)
    for (const file of files) {
      if (file.endsWith('.log')) {
        jobs.push({
          id: file.replace('.log', ''),
          path: path.join(JOBS_LOG_DIR, file)
        })
      }
    }
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
  }
  return {
    runner: RUNNER_LOG,
    jobs
  }
}

export { LOG_DIR, JOBS_LOG_DIR, RUNNER_LOG }
