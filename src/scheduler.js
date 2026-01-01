import { Cron } from 'croner'

/**
 * @typedef {{ log: (msg: string) => Promise<void> }} JobLogger
 */

/**
 * @typedef {Object} Job
 * @property {string} id - Unique job identifier
 * @property {string} [schedule] - Cron expression (e.g., "0 9 * * *")
 * @property {number} [interval] - Interval in milliseconds
 * @property {boolean} [enabled] - Whether job is enabled (default: true)
 * @property {(logger: JobLogger) => Promise<void>} run - Job function to execute
 */

/**
 * Check if a job is enabled
 * @param {Job} job
 * @returns {boolean}
 */
export function isEnabled(job) {
  return job.enabled !== false
}

/**
 * Get the interval in milliseconds for a job
 * If job has cron schedule, calculates interval from cron pattern
 * @param {Job} job
 * @returns {number} Interval in milliseconds
 */
export function getIntervalMs(job) {
  if (job.interval) {
    return job.interval
  }
  
  if (job.schedule) {
    // For cron, calculate typical interval between runs
    const cron = new Cron(job.schedule)
    const next1 = cron.nextRun()
    const next2 = cron.nextRuns(2)[1]
    
    if (next1 && next2) {
      return next2.getTime() - next1.getTime()
    }
    
    // Fallback: assume daily
    return 24 * 60 * 60 * 1000
  }
  
  throw new Error(`Job ${job.id} has no schedule or interval`)
}

/**
 * Check if a job should run based on last run time
 * @param {Job} job
 * @param {Date|null} lastRun - Last run time or null if never run
 * @returns {boolean}
 */
export function shouldRun(job, lastRun) {
  // Never run before? Run now
  if (!lastRun) {
    console.log(`[${job.id}] Never run before, should run`)
    return true
  }
  
  const intervalMs = getIntervalMs(job)
  const elapsed = Date.now() - lastRun.getTime()
  const shouldRunNow = elapsed >= intervalMs
  
  console.log(`[${job.id}] Last run: ${lastRun.toISOString()}, interval: ${intervalMs}ms, elapsed: ${elapsed}ms, due: ${shouldRunNow}`)
  
  return shouldRunNow
}

/**
 * Get the next run time for a job
 * @param {Job} job
 * @param {Date|null} lastRun - Last run time
 * @returns {Date|null}
 */
export function getNextRun(job, lastRun) {
  if (job.schedule) {
    const cron = new Cron(job.schedule)
    return cron.nextRun()
  }
  
  if (job.interval) {
    if (!lastRun) return new Date()
    return new Date(lastRun.getTime() + job.interval)
  }
  
  return null
}

/**
 * Format interval for human display
 * @param {number} ms - Interval in milliseconds
 * @returns {string}
 */
export function formatInterval(ms) {
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)
  
  if (days > 0) return `${days}d`
  if (hours > 0) return `${hours}h`
  if (minutes > 0) return `${minutes}m`
  return `${seconds}s`
}
