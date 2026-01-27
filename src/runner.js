import { getLastRun, markRun, isPaused } from './state.js'
import { shouldRun, isEnabled, getIntervalMs, getNextRun } from './scheduler.js'
import { logRunner, logJob, createJobLogger, logJobSeparator, captureJobOutput, humanTime } from './logger.js'
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
 * @returns {Promise<'ran'|'skipped'|'disabled'|'paused'|'failed'>}
 */
async function runIfDue(job) {
  const jobId = job._qualifiedId || job.id

  if (!isEnabled(job)) {
    return 'disabled'
  }

  if (await isPaused(jobId)) {
    return 'paused'
  }

  const lastRun = await getLastRun(jobId)

  if (!shouldRun(job, lastRun)) {
    return 'skipped'
  }

  await logJobSeparator(jobId)
  await logRunner(`Executing on ${humanTime()}`, jobId)
  await logJob(jobId, 'Starting execution')
  const start = Date.now()

  try {
    // Pass logger, utils, and lastRun to job - capture stdout to job log
    const logger = createJobLogger(jobId)
    await captureJobOutput(jobId, () => job.run({ logger, utils, lastRun }))
    await markRun(jobId)
    const duration = Date.now() - start
    await logRunner(`Completed in ${duration}ms`, jobId)
    await logJob(jobId, `Completed in ${duration}ms`)
    return 'ran'
  } catch (err) {
    await logRunner(`Failed: ${err.message}`, jobId)
    await logJob(jobId, `Failed: ${err.message}`)
    utils.notify(`${jobId} failed`, err.message || 'Unknown error')
    // Don't mark as run on failure - will retry next time
    return 'failed'
  }
}

/**
 * Run all due jobs from the provided list
 * @param {Job[]} jobs
 * @returns {Promise<{ran: string[], skipped: string[], disabled: string[], paused: string[], failed: string[]}>}
 */
export async function runAllDue(jobs) {
  await logRunner(`=== cron-burgundy runner === ────────────────────`)
  await logRunner(`Time: ${new Date().toISOString()}`)
  await logRunner(`Jobs to check: ${jobs.length}`)

  const ran = []
  const skipped = []
  const disabled = []
  const paused = []
  const failed = []

  for (const job of jobs) {
    const jobId = job._qualifiedId || job.id
    try {
      const result = await runIfDue(job)
      if (result === 'ran') {
        ran.push(jobId)
      } else if (result === 'disabled') {
        disabled.push(jobId)
      } else if (result === 'paused') {
        paused.push(jobId)
      } else if (result === 'failed') {
        failed.push(jobId)
      } else {
        skipped.push(jobId)
      }
    } catch (err) {
      await logRunner(`Error: ${err.message}`, jobId)
      failed.push(jobId)
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
  // Use qualified ID for namespaced jobs, fallback to base id
  const jobId = job._qualifiedId || job.id

  // Check if paused (only for scheduled runs - manual runs bypass pause)
  if (options.scheduled && await isPaused(jobId)) {
    await logRunner(`Skipped - job is paused`, jobId)
    return
  }

  // Acquire lock - skip if another instance is already running
  const staleLockMs = getStaleLockMs(job)
  if (!await acquireLock(jobId, { staleLockMs })) {
    await logRunner(`Skipped - another instance is running (locked)`, jobId)
    return
  }

  try {
    await logJobSeparator(jobId)
    const triggerType = options.scheduled ? 'Scheduled' : 'Manual'
    await logRunner(`${triggerType} run on ${humanTime(new Date(), { seconds: true })} ────────────────────`, jobId)
    await logJob(jobId, `${triggerType} run on ${humanTime(new Date(), { seconds: true })}`)

    const start = Date.now()
    const logger = createJobLogger(jobId)
    const lastRun = await getLastRun(jobId)

    await captureJobOutput(jobId, () => job.run({ logger, utils, lastRun }))
    const markOptions = options.scheduled && job.interval ? { interval: job.interval } : {}
    await markRun(jobId, markOptions)
    const duration = Date.now() - start
    let nextRunStr = ''
    if (options.scheduled) {
      const nextRun = getNextRun(job, new Date())
      nextRunStr = nextRun ? `. Next run at ${humanTime(nextRun, { seconds: true })}` : ''
    }
    await logRunner(`Completed in ${duration}ms`, jobId)
    await logJob(jobId, `Completed in ${duration}ms${nextRunStr}`)
  } catch (err) {
    await logRunner(`Failed: ${err.message}`, jobId)
    await logJob(jobId, `Failed: ${err.message}`)
    utils.notify(`${jobId} failed`, err.message || 'Unknown error')
    throw err
  } finally {
    await releaseLock(jobId)
  }
}

/**
 * Check for missed jobs and run them (called on wake/login)
 * @param {Job[]} jobs
 * @returns {Promise<{ran: string[], skipped: string[]}>}
 */
export async function checkMissed(jobs) {
  await logRunner(`=== Wake check: looking for missed jobs === ────────────────────`)
  await logRunner(`Time: ${new Date().toISOString()}`)

  // Filter out disabled and globally paused
  const enabledJobs = jobs.filter(j => isEnabled(j))
  await logRunner(`Enabled jobs to check: ${enabledJobs.length}`)
  
  const ran = []
  const skipped = []
  
  for (const job of enabledJobs) {
    const jobId = job._qualifiedId || job.id

    // Check if paused
    if (await isPaused(jobId)) {
      await logRunner(`Skipped - job is paused`, jobId)
      skipped.push(jobId)
      continue
    }

    // Acquire lock - skip if another instance is already running
    const staleLockMs = getStaleLockMs(job)
    if (!await acquireLock(jobId, { staleLockMs })) {
      await logRunner(`Skipped - another instance is running (locked)`, jobId)
      skipped.push(jobId)
      continue
    }

    try {
      const lastRun = await getLastRun(jobId)

      if (shouldRun(job, lastRun)) {
        await logRunner(`Missed! Running on ${humanTime()}`, jobId)
        await logJobSeparator(jobId)
        await logJob(jobId, 'Missed job - running on wake')

        const start = Date.now()
        const logger = createJobLogger(jobId)

        await captureJobOutput(jobId, () => job.run({ logger, utils, lastRun }))
        await markRun(jobId)
        const duration = Date.now() - start
        await logRunner(`Completed in ${duration}ms`, jobId)
        await logJob(jobId, `Completed in ${duration}ms`)
        ran.push(jobId)
      } else {
        skipped.push(jobId)
      }
    } catch (err) {
      await logRunner(`Failed: ${err.message}`, jobId)
      await logJob(jobId, `Failed: ${err.message}`)
      utils.notify(`${jobId} failed`, err.message || 'Unknown error')
      skipped.push(jobId)
    } finally {
      await releaseLock(jobId)
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
