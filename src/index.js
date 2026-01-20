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

export { runAllDue } from './runner.js'
export { getState, getLastRun, markRun } from './state.js'
export { shouldRun, getIntervalMs, getNextRun, formatInterval } from './scheduler.js'
export { installJob, uninstallJob, sync, uninstallAll, listInstalledPlists, generateJobPlistConfig, getJobLabel, getJobPlistPath, parsePlistFilename } from './launchd.js'
export { registerFile, unregisterFile, getRegistry, loadAllJobs, findJob, getAllJobsFlat, qualifyJobId, parseQualifiedId, getNamespace, getAllNamespaces, findJobsByNamespace } from './registry.js'
