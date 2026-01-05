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

// Extended 256-color palette from debug-js/debug (avoids dark blues on black terminals)
const COLORS = [
  20, 21, 26, 27, 32, 33, 38, 39, 40, 41, 42, 43, 44, 45, 56, 57, 62, 63, 68,
  69, 74, 75, 76, 77, 78, 79, 80, 81, 92, 93, 98, 99, 112, 113, 128, 129, 134,
  135, 148, 149, 160, 161, 162, 163, 164, 165, 166, 167, 168, 169, 170, 171,
  172, 173, 178, 179, 184, 185, 196, 197, 198, 199, 200, 201, 202, 203, 204,
  205, 206, 207, 208, 209, 214, 215, 220, 221
]
const RESET = '\x1b[0m'
const DIM = '\x1b[2m'

/**
 * Get consistent color for a job ID (hash-based like npm debug)
 * @param {string} jobId
 * @returns {string}
 */
function getJobColor(jobId) {
  let hash = 0
  for (let i = 0; i < jobId.length; i++) {
    hash = ((hash << 5) - hash) + jobId.charCodeAt(i)
    hash |= 0
  }
  const colorCode = COLORS[Math.abs(hash) % COLORS.length]
  return `\x1b[38;5;${colorCode}m`
}

/**
 * Format timestamp for logs (ISO)
 * @returns {string}
 */
function timestamp() {
  return new Date().toISOString()
}

/**
 * Format human-readable timestamp (local timezone)
 * @param {Date} [date]
 * @param {{ seconds?: boolean }} [opts]
 * @returns {string} e.g. "Monday 12:01pm, Jan 05, 2026" or "Monday 12:01:30pm, Jan 05, 2026"
 */
export function humanTime(date = new Date(), opts = {}) {
  const weekday = date.toLocaleDateString('en-US', { weekday: 'long' })
  const hour = date.getHours()
  const minute = date.getMinutes().toString().padStart(2, '0')
  const second = date.getSeconds().toString().padStart(2, '0')
  const ampm = hour >= 12 ? 'pm' : 'am'
  const hour12 = hour % 12 || 12
  const month = date.toLocaleDateString('en-US', { month: 'short' })
  const day = date.getDate().toString().padStart(2, '0')
  const year = date.getFullYear()
  const time = opts.seconds ? `${hour12}:${minute}:${second}${ampm}` : `${hour12}:${minute}${ampm}`
  return `${weekday} ${time}, ${month} ${day}, ${year}`
}

/**
 * Colorize a log line for display (parses [job-id] prefix)
 * @param {string} line
 * @returns {string}
 */
export function colorizeLine(line) {
  // Match pattern: [timestamp][job-id] message
  const match = line.match(/^\[([^\]]+)\]\[([^\]]+)\]\s*(.*)$/)
  if (match) {
    const [, ts, jobId, msg] = match
    const color = getJobColor(jobId)
    return `${DIM}[${ts}]${RESET}${color}[${jobId}]${RESET} ${msg}`
  }
  // Match separator or other lines
  if (line.includes('────')) {
    return `${DIM}${line}${RESET}`
  }
  return line
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
 * Log to the main runner log (file only - no console output)
 * Format: [job-id][timestamp] message (if jobId provided)
 *         [timestamp] message (if no jobId)
 * @param {string} message
 * @param {string} [jobId]
 */
export async function logRunner(message, jobId) {
  await ensureLogDirs()
  await rotateIfNeeded(RUNNER_LOG)
  const ts = timestamp()
  const line = jobId
    ? `[${ts}][${jobId}] ${message}\n`
    : `[${ts}] ${message}\n`
  await fs.appendFile(RUNNER_LOG, line)
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
 * Capture stdout/stderr during a function execution and route to job log
 * @param {string} jobId
 * @param {() => Promise<void>} fn
 * @returns {Promise<void>}
 */
export async function captureJobOutput(jobId, fn) {
  const jobLogPath = path.join(JOBS_LOG_DIR, `${jobId}.log`)
  await ensureLogDirs()

  const originalStdoutWrite = process.stdout.write.bind(process.stdout)
  const originalStderrWrite = process.stderr.write.bind(process.stderr)

  /** @type {string[]} */
  const buffer = []

  /**
   * @param {string | Uint8Array} chunk
   * @param {BufferEncoding | ((err?: Error) => void)} [encoding]
   * @param {(err?: Error) => void} [callback]
   */
  const captureWrite = (chunk, encoding, callback) => {
    const str = typeof chunk === 'string' ? chunk : chunk.toString()
    buffer.push(str)
    // Call callback if provided
    if (typeof encoding === 'function') {
      encoding()
    } else if (typeof callback === 'function') {
      callback()
    }
    return true
  }

  // @ts-ignore - overriding write signature
  process.stdout.write = captureWrite
  // @ts-ignore - overriding write signature
  process.stderr.write = captureWrite

  try {
    await fn()
  } finally {
    process.stdout.write = originalStdoutWrite
    process.stderr.write = originalStderrWrite

    // Write captured output to job log (without timestamps, raw output)
    if (buffer.length > 0) {
      const output = buffer.join('')
      if (output.trim()) {
        await fs.appendFile(jobLogPath, output)
      }
    }
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
