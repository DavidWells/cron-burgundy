import { getLastRun, markRun } from './state.js'
import { shouldRun, isEnabled } from './scheduler.js'
import { logRunner, logJob, createJobLogger, logRunnerSeparator, logJobSeparator } from './logger.js'
import { acquireLock, releaseLock } from './lock.js'

/**
 * @typedef {import('./scheduler.js').Job} Job
 */

/**
 * Run a single job if it's due
 * @param {Job} job
 * @returns {Promise<'ran'|'skipped'|'disabled'>}
 */
async function runIfDue(job) {
  if (!isEnabled(job)) {
    return 'disabled'
  }
  
  const lastRun = await getLastRun(job.id)
  
  if (!shouldRun(job, lastRun)) {
    return 'skipped'
  }
  
  await logJobSeparator(job.id)
  await logRunner(`[${job.id}] Executing...`)
  await logJob(job.id, 'Starting execution')
  const start = Date.now()
  
  try {
    // Pass logger to job so it can write to its own log file
    const logger = createJobLogger(job.id)
    await job.run(logger)
    await markRun(job.id)
    const duration = Date.now() - start
    await logRunner(`[${job.id}] Completed in ${duration}ms`)
    await logJob(job.id, `Completed in ${duration}ms`)
    return 'ran'
  } catch (err) {
    await logRunner(`[${job.id}] Failed: ${err.message}`)
    await logJob(job.id, `Failed: ${err.message}`)
    // Don't mark as run on failure - will retry next time
    return 'skipped'
  }
}

/**
 * Run all due jobs from the provided list
 * @param {Job[]} jobs
 * @returns {Promise<{ran: string[], skipped: string[], disabled: string[], failed: string[]}>}
 */
export async function runAllDue(jobs) {
  await logRunnerSeparator()
  await logRunner(`=== cron-burgundy runner ===`)
  await logRunner(`Time: ${new Date().toISOString()}`)
  await logRunner(`Jobs to check: ${jobs.length}`)
  
  const ran = []
  const skipped = []
  const disabled = []
  const failed = []
  
  for (const job of jobs) {
    try {
      const result = await runIfDue(job)
      if (result === 'ran') {
        ran.push(job.id)
      } else if (result === 'disabled') {
        disabled.push(job.id)
      } else {
        skipped.push(job.id)
      }
    } catch (err) {
      await logRunner(`[${job.id}] Error: ${err.message}`)
      failed.push(job.id)
    }
  }
  
  await logRunner(`=== Summary: ran=${ran.length}, skipped=${skipped.length}, disabled=${disabled.length}, failed=${failed.length} ===`)
  
  return { ran, skipped, disabled, failed }
}

/**
 * Run a single job immediately (for CLI / launchd scheduled run)
 * @param {Job} job
 * @returns {Promise<void>}
 */
export async function runJobNow(job) {
  // Acquire lock - skip if another instance is already running
  if (!await acquireLock(job.id)) {
    console.log(`[${job.id}] Skipped - another instance is running (locked)`)
    return
  }
  
  try {
    await logRunnerSeparator()
    await logJobSeparator(job.id)
    await logRunner(`[${job.id}] Scheduled run triggered`)
    await logJob(job.id, 'Scheduled run triggered')
    
    const start = Date.now()
    const logger = createJobLogger(job.id)
    
    await job.run(logger)
    await markRun(job.id)
    const duration = Date.now() - start
    await logRunner(`[${job.id}] Completed in ${duration}ms`)
    await logJob(job.id, `Completed in ${duration}ms`)
  } catch (err) {
    await logRunner(`[${job.id}] Failed: ${err.message}`)
    await logJob(job.id, `Failed: ${err.message}`)
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
  
  const enabledJobs = jobs.filter(j => isEnabled(j))
  await logRunner(`Enabled jobs to check: ${enabledJobs.length}`)
  
  const ran = []
  const skipped = []
  
  for (const job of enabledJobs) {
    // Acquire lock - skip if another instance is already running
    if (!await acquireLock(job.id)) {
      await logRunner(`[${job.id}] Skipped - another instance is running (locked)`)
      skipped.push(job.id)
      continue
    }
    
    try {
      const lastRun = await getLastRun(job.id)
      
      if (shouldRun(job, lastRun)) {
        await logRunner(`[${job.id}] Missed! Running now...`)
        await logJobSeparator(job.id)
        await logJob(job.id, 'Missed job - running on wake')
        
        const start = Date.now()
        const logger = createJobLogger(job.id)
        
        await job.run(logger)
        await markRun(job.id)
        const duration = Date.now() - start
        await logRunner(`[${job.id}] Completed in ${duration}ms`)
        await logJob(job.id, `Completed in ${duration}ms`)
        ran.push(job.id)
      } else {
        skipped.push(job.id)
      }
    } catch (err) {
      await logRunner(`[${job.id}] Failed: ${err.message}`)
      await logJob(job.id, `Failed: ${err.message}`)
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
