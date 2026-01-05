import { getLastRun, markRun, isPaused } from './state.js'
import { shouldRun, isEnabled, getIntervalMs, getNextRun } from './scheduler.js'
import { logRunner, logJob, createJobLogger, logRunnerSeparator, logJobSeparator, captureJobOutput, humanTime } from './logger.js'
import { acquireLock, releaseLock } from './lock.js'
import { utils } from './actions/index.js'

/**
 * @typedef {import('./scheduler.js').Job} Job
 */

const DEFAULT_STALE_MS = 60 * 60 * 1000 // 1 hour

/**
 * Compute stale lock timeout for a job (3x interval, or 1 hour for cron)
 * @param {Job} job
 * @returns {number}
 */
function getStaleLockMs(job) {
  if (job.interval) {
    return Math.max(job.interval * 3, 30 * 1000) // 3x interval, min 30s
  }
  return DEFAULT_STALE_MS
}

/**
 * Run a single job if it's due
 * @param {Job} job
 * @returns {Promise<'ran'|'skipped'|'disabled'|'paused'>}
 */
async function runIfDue(job) {
  if (!isEnabled(job)) {
    return 'disabled'
  }

  if (await isPaused(job.id)) {
    return 'paused'
  }

  const lastRun = await getLastRun(job.id)
  
  if (!shouldRun(job, lastRun)) {
    return 'skipped'
  }
  
  await logJobSeparator(job.id)
  await logRunner(`Executing on ${humanTime()}`, job.id)
  await logJob(job.id, 'Starting execution')
  const start = Date.now()

  try {
    // Pass logger, utils, and lastRun to job - capture stdout to job log
    const logger = createJobLogger(job.id)
    await captureJobOutput(job.id, () => job.run({ logger, utils, lastRun }))
    await markRun(job.id)
    const duration = Date.now() - start
    await logRunner(`Completed in ${duration}ms`, job.id)
    await logJob(job.id, `Completed in ${duration}ms`)
    return 'ran'
  } catch (err) {
    await logRunner(`Failed: ${err.message}`, job.id)
    await logJob(job.id, `Failed: ${err.message}`)
    utils.notify(`${job.id} failed`, err.message || 'Unknown error')
    // Don't mark as run on failure - will retry next time
    return 'skipped'
  }
}

/**
 * Run all due jobs from the provided list
 * @param {Job[]} jobs
 * @returns {Promise<{ran: string[], skipped: string[], disabled: string[], paused: string[], failed: string[]}>}
 */
export async function runAllDue(jobs) {
  await logRunnerSeparator()
  await logRunner(`=== cron-burgundy runner ===`)
  await logRunner(`Time: ${new Date().toISOString()}`)
  await logRunner(`Jobs to check: ${jobs.length}`)

  const ran = []
  const skipped = []
  const disabled = []
  const paused = []
  const failed = []

  for (const job of jobs) {
    try {
      const result = await runIfDue(job)
      if (result === 'ran') {
        ran.push(job.id)
      } else if (result === 'disabled') {
        disabled.push(job.id)
      } else if (result === 'paused') {
        paused.push(job.id)
      } else {
        skipped.push(job.id)
      }
    } catch (err) {
      await logRunner(`Error: ${err.message}`, job.id)
      failed.push(job.id)
    }
  }

  await logRunner(`=== Summary: ran=${ran.length}, skipped=${skipped.length}, disabled=${disabled.length}, paused=${paused.length}, failed=${failed.length} ===`)

  return { ran, skipped, disabled, paused, failed }
}

/**
 * Run a single job immediately (for CLI / launchd scheduled run)
 * @param {Job} job
 * @param {{ scheduled?: boolean }} [options] - If scheduled, updates nextRun in state
 * @returns {Promise<void>}
 */
export async function runJobNow(job, options = {}) {
  // Check if paused (only for scheduled runs - manual runs bypass pause)
  if (options.scheduled && await isPaused(job.id)) {
    console.log(`[${job.id}] Skipped - job is paused`)
    return
  }

  // Acquire lock - skip if another instance is already running
  const staleLockMs = getStaleLockMs(job)
  if (!await acquireLock(job.id, { staleLockMs })) {
    console.log(`[${job.id}] Skipped - another instance is running (locked)`)
    return
  }

  try {
    await logRunnerSeparator()
    await logJobSeparator(job.id)
    const triggerType = options.scheduled ? 'Scheduled' : 'Manual'
    await logRunner(`${triggerType} run on ${humanTime(new Date(), { seconds: true })}`, job.id)
    await logJob(job.id, `${triggerType} run on ${humanTime(new Date(), { seconds: true })}`)

    const start = Date.now()
    const logger = createJobLogger(job.id)
    const lastRun = await getLastRun(job.id)

    await captureJobOutput(job.id, () => job.run({ logger, utils, lastRun }))
    const markOptions = options.scheduled && job.interval ? { interval: job.interval } : {}
    await markRun(job.id, markOptions)
    const duration = Date.now() - start
    let nextRunStr = ''
    if (options.scheduled) {
      const nextRun = getNextRun(job, new Date())
      nextRunStr = nextRun ? `. Next run at ${humanTime(nextRun, { seconds: true })}` : ''
    }
    await logRunner(`Completed in ${duration}ms`, job.id)
    await logJob(job.id, `Completed in ${duration}ms${nextRunStr}`)
  } catch (err) {
    await logRunner(`Failed: ${err.message}`, job.id)
    await logJob(job.id, `Failed: ${err.message}`)
    utils.notify(`${job.id} failed`, err.message || 'Unknown error')
    throw err
  } finally {
    await releaseLock(job.id)
  }
}

/**
 * Check for missed jobs and run them (called on wake/login)
 * @param {Job[]} jobs
 * @returns {Promise<{ran: string[], skipped: string[]}>}
 */
export async function checkMissed(jobs) {
  await logRunnerSeparator()
  await logRunner(`=== Wake check: looking for missed jobs ===`)
  await logRunner(`Time: ${new Date().toISOString()}`)

  // Filter out disabled and globally paused
  const enabledJobs = jobs.filter(j => isEnabled(j))
  await logRunner(`Enabled jobs to check: ${enabledJobs.length}`)
  
  const ran = []
  const skipped = []
  
  for (const job of enabledJobs) {
    // Check if paused
    if (await isPaused(job.id)) {
      await logRunner(`Skipped - job is paused`, job.id)
      skipped.push(job.id)
      continue
    }

    // Acquire lock - skip if another instance is already running
    const staleLockMs = getStaleLockMs(job)
    if (!await acquireLock(job.id, { staleLockMs })) {
      await logRunner(`Skipped - another instance is running (locked)`, job.id)
      skipped.push(job.id)
      continue
    }

    try {
      const lastRun = await getLastRun(job.id)

      if (shouldRun(job, lastRun)) {
        await logRunner(`Missed! Running on ${humanTime()}`, job.id)
        await logJobSeparator(job.id)
        await logJob(job.id, 'Missed job - running on wake')

        const start = Date.now()
        const logger = createJobLogger(job.id)

        await captureJobOutput(job.id, () => job.run({ logger, utils, lastRun }))
        await markRun(job.id)
        const duration = Date.now() - start
        await logRunner(`Completed in ${duration}ms`, job.id)
        await logJob(job.id, `Completed in ${duration}ms`)
        ran.push(job.id)
      } else {
        skipped.push(job.id)
      }
    } catch (err) {
      await logRunner(`Failed: ${err.message}`, job.id)
      await logJob(job.id, `Failed: ${err.message}`)
      utils.notify(`${job.id} failed`, err.message || 'Unknown error')
      skipped.push(job.id)
    } finally {
      await releaseLock(job.id)
    }
  }
  
  await logRunner(`=== Wake check complete: ran=${ran.length}, skipped=${skipped.length} ===`)
  
  return { ran, skipped }
}

// If run directly (not imported), load jobs and run
const isMainModule = import.meta.url === `file://${process.argv[1]}`

if (isMainModule) {
  try {
    // Dynamic import of jobs.js from project root
    const { jobs } = await import('../jobs.js')
    await runAllDue(jobs)
  } catch (err) {
    if (err.code === 'ERR_MODULE_NOT_FOUND') {
      console.error('Error: jobs.js not found. Create a jobs.js file in the project root.')
      console.error('See README for example format.')
    } else {
      console.error('Error loading jobs:', err)
    }
    process.exit(1)
  }
}
