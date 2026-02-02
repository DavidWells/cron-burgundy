/**
 * cron-burgundy - Simple macOS cron manager with missed job recovery
 *
 * @example
 * import { registerJob, runAllDue } from 'cron-burgundy'
 *
 * const jobs = [
 *   {
 *     id: 'my-job',
 *     schedule: '0 9 * * *',
 *     run: async () => console.log('Hello!')
 *   }
 * ]
 *
 * await runAllDue(jobs)
 */

/**
 * @typedef {import('./scheduler.js').Job} Job
 * @typedef {import('./scheduler.js').JobContext} JobContext
 * @typedef {import('./scheduler.js').JobLogger} JobLogger
 * @typedef {import('./scheduler.js').Utils} Utils
 */

export { runAllDue, runJobNow } from './runner.js'
export { getState, getLastRun, markRun, pause, resume, isPaused, getPauseStatus, isSuspended, getSuspendedAt, markSuspended, clearSuspended, getSuspendedJobs } from './state.js'
export { shouldRun, getIntervalMs, getNextRun, formatInterval } from './scheduler.js'
export { installJob, uninstallJob, suspendJob, resumeJob, sync, uninstallAll, listInstalledPlists, generateJobPlistConfig, getJobLabel, getJobPlistPath, parsePlistFilename, MIN_INTERVAL_MS } from './launchd.js'
export { registerFile, unregisterFile, getRegistry, loadAllJobs, findJob, getAllJobsFlat, qualifyJobId, parseQualifiedId, getNamespace, getAllNamespaces, findJobsByNamespace, validateJobId } from './registry.js'

/**
 * Find a registered job by qualified ID and run it with full infrastructure
 * @param {string} qualifiedId - Qualified job ID (e.g. "pm/tick")
 * @returns {Promise<void>}
 */
export async function runScheduledJob(qualifiedId) {
  const { findJob } = await import('./registry.js')
  const { runJobNow } = await import('./runner.js')
  const result = await findJob(qualifiedId)
  if (!result) {
    const { logRunner } = await import('./logger.js')
    const { utils } = await import('./actions/index.js')
    await logRunner(`Job "${qualifiedId}" not found in registry`, qualifiedId)
    utils.notify(`${qualifiedId} failed`, `Job not found in registry`)
    process.exit(1)
  }
  await runJobNow(result.job, { scheduled: true })
}
