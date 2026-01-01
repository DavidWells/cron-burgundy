import { Cron } from 'croner'
import cronstrue from 'cronstrue'
import { normalizeSchedule } from './cron-parser.js'

/**
 * @typedef {{ log: (msg: string) => Promise<void> }} JobLogger
 */

/**
 * @typedef {Object} JobContext
 * @property {JobLogger} logger - Logger for this job
 * @property {import('./actions/index.js').utils} utils - Utility functions (speak, playSound, notify)
 */

/**
 * @typedef {Object} Job
 * @property {string} id - Unique job identifier
 * @property {string} [description] - Human-readable description of what the job does
 * @property {string} [schedule] - Cron expression or human-readable schedule (e.g., "0 9 * * *", "every 5 minutes", "weekdays")
 * @property {number} [interval] - Interval in milliseconds
 * @property {boolean} [enabled] - Whether job is enabled (default: true)
 * @property {(ctx: JobContext) => Promise<void>} run - Job function to execute
 */

/**
 * Get the normalized cron schedule for a job
 * @param {Job} job
 * @returns {string|undefined}
 */
function getCronSchedule(job) {
  if (!job.schedule) return undefined
  return normalizeSchedule(job.schedule)
}

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
  
  const cronSchedule = getCronSchedule(job)
  if (cronSchedule) {
    // For cron, calculate typical interval between runs
    const cron = new Cron(cronSchedule)
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
  const cronSchedule = getCronSchedule(job)
  if (cronSchedule) {
    const cron = new Cron(cronSchedule)
    return cron.nextRun()
  }
  
  if (job.interval) {
    if (!lastRun) return new Date()
    return new Date(lastRun.getTime() + job.interval)
  }
  
  return null
}

/**
 * Get human-readable description of a cron expression
 * @param {string} cronExpr
 * @returns {string}
 */
function cronToHuman(cronExpr) {
  try {
    return cronstrue.toString(cronExpr, { use24HourTimeFormat: false })
  } catch {
    return cronExpr
  }
}

/**
 * Get the display schedule string (shows both human and cron if different)
 * @param {Job} job
 * @returns {string}
 */
export function getDisplaySchedule(job) {
  if (job.interval) {
    return `every ${formatInterval(job.interval)}`
  }
  if (job.schedule) {
    const cronSchedule = getCronSchedule(job)
    const humanDesc = cronToHuman(cronSchedule)
    return `${cronSchedule} (${humanDesc})`
  }
  return 'unknown'
}

/**
 * Pluralize a word based on count
 * @param {number} count
 * @param {string} singular
 * @param {string} plural
 * @returns {string}
 */
function pluralize(count, singular, plural) {
  return count === 1 ? singular : plural
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

  if (days > 0) return `${days} ${pluralize(days, 'day', 'days')}`
  if (hours > 0) return `${hours} ${pluralize(hours, 'hour', 'hours')}`
  if (minutes > 0) return `${minutes} ${pluralize(minutes, 'minute', 'minutes')}`
  return `${seconds} ${pluralize(seconds, 'second', 'seconds')}`
}
