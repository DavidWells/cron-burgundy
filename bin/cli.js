#!/usr/bin/env node

/**
 * @typedef {import('../src/scheduler.js').Job} Job
 * @typedef {import('../src/scheduler.js').JobContext} JobContext
 */

import { Command } from 'commander'
import path from 'path'
import fs from 'fs'
import { runAllDue, runJobNow, checkMissed } from '../src/runner.js'
import { getState, pause, resume, getPauseStatus, isPaused, getNextScheduledRun } from '../src/state.js'
import { getIntervalMs, getNextRun, formatInterval, isEnabled, getDisplaySchedule } from '../src/scheduler.js'
import { sync, uninstallAll, listInstalledPlists, parsePlistFilename } from '../src/launchd.js'
import { spawn } from 'child_process'
import { readRunnerLog, readJobLog, clearRunnerLog, clearJobLog, clearAllJobLogs, listLogFiles, colorizeLine, logRunner, RUNNER_LOG, JOBS_LOG_DIR } from '../src/logger.js'
import { getRegistry, registerFile, unregisterFile, loadAllJobs, findJob, getAllJobsFlat, qualifyJobId, getNamespace, findJobsByNamespace } from '../src/registry.js'
import { clearStaleLock } from '../src/lock.js'
import * as p from '@clack/prompts'

/**
 * Get display ID for a job - short if unique, qualified if collision
 * @param {string} jobId
 * @param {string|null} namespace
 * @param {Map<string, number>} idCounts - map of base jobId to count
 * @returns {string}
 */
function getDisplayId(jobId, namespace, idCounts) {
  const count = idCounts.get(jobId) || 0
  if (count > 1 && namespace) {
    return qualifyJobId(jobId, namespace)
  }
  return jobId
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  const size = bytes / Math.pow(1024, i)
  return `${size % 1 === 0 ? size : size.toFixed(1)} ${units[i]}`
}

const program = new Command()

program
  .name('cron-burgundy')
  .description('Simple macOS cron manager with missed job recovery')
  .version('1.0.0')

// === Primary commands ===

program
  .command('list')
  .description('List all registered jobs with status')
  .option('-n, --namespace <ns>', 'Filter by namespace')
  .action(async (options) => {
    const sources = await loadAllJobs()
    const state = await getState()
    const pauseStatus = await getPauseStatus()
    const installedPlists = await listInstalledPlists()

    // Build a set of installed qualified IDs
    const installedQualifiedIds = new Set()
    for (const plist of installedPlists) {
      const parsed = parsePlistFilename(plist)
      if (parsed) {
        installedQualifiedIds.add(qualifyJobId(parsed.jobId, parsed.namespace))
      }
    }

    // Count base IDs for collision detection
    const idCounts = new Map()
    for (const source of sources) {
      if (source.error) continue
      for (const job of source.jobs) {
        idCounts.set(job.id, (idCounts.get(job.id) || 0) + 1)
      }
    }

    const nsFilter = options.namespace || null
    const headerSuffix = nsFilter ? ` [${nsFilter}]` : ''
    console.log(`\n=== Registered Jobs${headerSuffix} ===\n`)

    if (pauseStatus.all) {
      console.log('⏸  ALL JOBS PAUSED\n')
    }

    if (sources.length === 0) {
      console.log('No job files registered.')
      console.log('Run: cron-burgundy sync <path/to/jobs.js>')
      return
    }

    let totalJobs = 0
    let totalEnabled = 0
    let totalDisabled = 0
    const unsyncedJobs = []

    for (const source of sources) {
      // Filter by namespace if specified
      if (nsFilter && source.namespace !== nsFilter) continue

      const nsLabel = source.namespace ? ` [${source.namespace}]` : ''
      console.log(`${source.file}${nsLabel}:`)

      if (source.error) {
        console.log(`  ⚠ Error loading: ${source.error}\n`)
        continue
      }

      if (source.jobs.length === 0) {
        console.log('  (no jobs)\n')
        continue
      }

      for (const job of source.jobs) {
        const qualifiedId = qualifyJobId(job.id, source.namespace)
        const displayId = getDisplayId(job.id, source.namespace, idCounts)
        const lastRunStr = state[qualifiedId] || state[job.id] // fallback for migration
        const lastRun = lastRunStr ? new Date(lastRunStr) : null
        const nextRun = job.interval
          ? await getNextScheduledRun(qualifiedId)
          : getNextRun(job, lastRun)
        const jobPaused = pauseStatus.all || pauseStatus.jobs.includes(qualifiedId) || pauseStatus.jobs.includes(job.id)
        const isInstalled = installedQualifiedIds.has(qualifiedId)
        const needsSync = isEnabled(job) && !isInstalled

        const status = !isEnabled(job) ? '✗' : needsSync ? '⚠' : jobPaused ? '⏸' : '✓'

        console.log(`  ${status} ${displayId}`)
        if (job.description) {
          console.log(`     ${job.description}`)
        }
        const statusText = !isEnabled(job)
          ? 'DISABLED'
          : needsSync
            ? 'NOT SYNCED (run: cronb sync)'
            : jobPaused
              ? 'PAUSED'
              : 'enabled'
        console.log(`     Status:   ${statusText}`)
        console.log(`     Schedule: ${getDisplaySchedule(job)}`)
        console.log(`     Last run: ${lastRun ? lastRun.toLocaleString() : 'never'}`)
        if (isEnabled(job) && !jobPaused && !needsSync) {
          const nextDueStr = nextRun ? nextRun.toLocaleString() : (job.interval ? 'unknown' : 'now')
          console.log(`     Next due: ${nextDueStr}`)
        }
        console.log('')

        totalJobs++
        if (isEnabled(job)) totalEnabled++
        else totalDisabled++
        if (needsSync) unsyncedJobs.push(displayId)
      }
    }

    const pausedCount = pauseStatus.all ? totalEnabled : pauseStatus.jobs.length
    console.log(`Total: ${totalJobs} jobs (${totalEnabled} enabled, ${totalDisabled} disabled, ${pausedCount} paused)`)
    if (unsyncedJobs.length > 0) {
      console.log(`⚠ Not synced: ${unsyncedJobs.join(', ')} - run: cronb sync`)
    }
    console.log(`Files: ${sources.length} registered`)
  })

program
  .command('run')
  .argument('[jobId]', 'Job ID to run immediately')
  .option('-s, --scheduled', 'Mark as scheduled run (updates nextRun in state)')
  .description('Run a job manually (autocomplete if no arg)')
  .action(async (jobId, options) => {
    if (jobId) {
      const result = await findJob(jobId)
      if (!result) {
        console.error(`Error: Job "${jobId}" not found\n`)
        const allJobs = await getAllJobsFlat()
        if (allJobs.length > 0) {
          console.error('Available jobs:')
          for (const job of allJobs) {
            const status = isEnabled(job) ? '✓' : '✗'
            console.error(`  ${status} ${job.id}`)
          }
        } else {
          console.error('No jobs registered. Run: cron-burgundy sync <path/to/jobs.js>')
        }
        process.exit(1)
      }
      const { job } = result
      if (options.scheduled && !isEnabled(job)) {
        await logRunner(`Skipped - job is disabled`, jobId)
        return
      }
      await runJobNow(job, { scheduled: options.scheduled })
      if (!options.scheduled) {
        console.log(`✓ ${jobId} completed`)
      }
    } else {
      // Interactive single select
      const allJobs = await getAllJobsFlat()
      if (allJobs.length === 0) {
        console.error('No jobs registered. Run: cron-burgundy sync <path/to/jobs.js>')
        process.exit(1)
      }

      const enabledJobs = allJobs.filter(j => isEnabled(j))
      if (enabledJobs.length === 0) {
        console.log('No enabled jobs to run')
        return
      }

      const selected = await p.autocomplete({
        message: 'Select job to run',
        options: enabledJobs.map(j => ({
          value: j.id,
          label: j.id,
          hint: j.description
        }))
      })

      if (p.isCancel(selected)) {
        console.log('Cancelled')
        return
      }

      const { job } = await findJob(selected)
      await runJobNow(job, { scheduled: false })
      console.log(`✓ ${selected} completed`)
    }
  })

// logs command with subcommands
const logsCmd = program
  .command('logs')
  .description('View, list, or clear logs')

logsCmd
  .command('view', { isDefault: true })
  .argument('[jobId]', 'Job ID to view logs for (omit for runner log)')
  .option('-n, --lines <number>', 'Number of lines to show', '50')
  .option('-t, --tail', 'Follow log file (tail -f)')
  .description('View logs (runner log or specific job log)')
  .action(async (jobId, options) => {
    const lines = parseInt(options.lines, 10)
    const logPath = jobId
      ? path.join(JOBS_LOG_DIR, `${jobId}.log`)
      : RUNNER_LOG

    if (options.tail) {
      // Show job schedule info if tailing a specific job
      if (jobId) {
        const result = await findJob(jobId)
        if (result) {
          console.log(`\nSchedule: ${getDisplaySchedule(result.job)}`)
        }
      }
      // Create empty log file if it doesn't exist
      if (!fs.existsSync(logPath)) {
        fs.mkdirSync(path.dirname(logPath), { recursive: true })
        fs.writeFileSync(logPath, '')
        console.log(`\n(Created empty log file - no entries yet)`)
      }
      const stats = fs.statSync(logPath)
      const size = formatBytes(stats.size)
      console.log(`\n=== Tailing: ${logPath} (${size}) ===\n`)
      console.log('(Press Ctrl+C to stop)\n')
      const tail = spawn('tail', ['-f', '-n', '0', logPath], { stdio: 'inherit' })
      tail.on('error', (err) => {
        console.error(`Error: ${err.message}`)
        process.exit(1)
      })
      return
    }

    if (jobId) {
      console.log(`\n=== Logs for: ${jobId} ===`)
      console.log(`${logPath}\n`)
      const log = await readJobLog(jobId, lines)
      console.log(log)
    } else {
      const logs = await listLogFiles()
      console.log('\n=== Runner Log ===')
      console.log(`${logs.runner}`)
      if (logs.jobs.length > 0) {
        console.log(`\n=== Job logs ===`)
        for (const job of logs.jobs) {
          console.log(`${job.path}`)
        }
      }
      console.log('')
      const log = await readRunnerLog(lines)
      const colorized = log.split('\n').map(colorizeLine).join('\n')
      console.log(colorized)
    }
  })

logsCmd
  .command('list')
  .description('List all log file paths')
  .action(async () => {
    const logs = await listLogFiles()

    console.log('\n=== Log Files ===\n')
    console.log(`Runner log:`)
    console.log(`  ${logs.runner}`)

    if (logs.jobs.length > 0) {
      console.log(`\nJob logs:`)
      for (const job of logs.jobs) {
        console.log(`  ${job.id}: ${job.path}`)
      }
    } else {
      console.log(`\nNo job logs yet`)
    }
  })

logsCmd
  .command('clear')
  .argument('[name]', 'Job ID to clear, "all" for everything, omit for runner log')
  .description('Clear logs')
  .action(async (name) => {
    if (name === 'all') {
      await clearRunnerLog()
      const cleared = await clearAllJobLogs()
      const jobsMessage = cleared.length > 0 ? ` and ${cleared.length} job logs` : ''
      console.log(`✓ Cleared runner log${jobsMessage}`)
      if (cleared.length > 0) {
        cleared.forEach(id => console.log(`  - ${id}`))
      }
    } else if (name) {
      await clearJobLog(name)
      console.log(`✓ Cleared logs for: ${name}`)
    } else {
      await clearRunnerLog()
      console.log('✓ Cleared runner log')
    }
  })

logsCmd
  .command('prune')
  .option('-n, --dry-run', 'Show what would be deleted without deleting')
  .description('Remove orphaned logs (jobs no longer registered)')
  .action(async (options) => {
    const allJobs = await getAllJobsFlat()
    const registeredIds = new Set(allJobs.map(j => j._qualifiedId))

    const logs = await listLogFiles()
    const orphaned = []

    for (const log of logs.jobs) {
      if (!registeredIds.has(log.id)) {
        orphaned.push(log)
      }
    }

    if (orphaned.length === 0) {
      console.log('No orphaned logs found')
      return
    }

    console.log(`\n${options.dryRun ? 'Would remove' : 'Removing'} ${orphaned.length} orphaned log(s):\n`)

    for (const log of orphaned) {
      console.log(`  ${log.id} (${log.path})`)
      if (!options.dryRun) {
        await clearJobLog(log.id)
      }
    }

    if (!options.dryRun) {
      console.log(`\n✓ Removed ${orphaned.length} orphaned log(s)`)
    }
  })

program
  .command('pause')
  .argument('[name]', 'Job ID to pause, or "all" for all jobs')
  .description('Pause a job or all jobs (interactive if no arg)')
  .action(async (name) => {
    let jobIds = []

    if (!name) {
      // Interactive multiselect
      const allJobs = await getAllJobsFlat()
      const pauseStatus = await getPauseStatus()
      const unpausedJobs = allJobs.filter(j =>
        isEnabled(j) && !pauseStatus.all && !pauseStatus.jobs.includes(j.id)
      )

      // Show currently paused jobs
      const pausedJobs = pauseStatus.all
        ? allJobs.filter(j => isEnabled(j))
        : allJobs.filter(j => pauseStatus.jobs.includes(j.id))

      if (pausedJobs.length > 0) {
        console.log('\nCurrently paused:')
        for (const job of pausedJobs) {
          console.log(`  - ${job.id}`)
        }
        console.log('')
      }

      if (unpausedJobs.length === 0) {
        console.log('No jobs available to pause')
        return
      }

      const selected = await p.multiselect({
        message: 'Select jobs to pause',
        options: unpausedJobs.map(j => ({
          value: j.id,
          label: j.id,
          hint: j.description
        }))
      })

      if (p.isCancel(selected)) {
        console.log('Cancelled')
        return
      }

      jobIds = selected
    } else if (name === 'all') {
      const allJobs = await getAllJobsFlat()
      jobIds = allJobs.map(j => j.id)
      await pause('all')
    } else {
      const result = await findJob(name)
      if (!result) {
        console.error(`Error: Job "${name}" not found`)
        process.exit(1)
      }
      jobIds = [name]
    }

    // Pause and clear stale locks
    for (const id of jobIds) {
      if (name !== 'all') await pause(id)
      await clearStaleLock(id)
    }

    if (jobIds.length === 0) {
      console.log('No jobs selected')
    } else if (name === 'all') {
      console.log('✓ All jobs paused')
    } else {
      console.log(`✓ Paused: ${jobIds.join(', ')}`)
    }
  })

async function handleUnpause(name) {
  let jobIds = []

  if (!name) {
    // Interactive multiselect - show paused jobs
    const allJobs = await getAllJobsFlat()
    const pauseStatus = await getPauseStatus()

    // If globally paused, show all enabled jobs
    const pausedJobs = pauseStatus.all
      ? allJobs.filter(j => isEnabled(j))
      : allJobs.filter(j => pauseStatus.jobs.includes(j.id))

    // Show currently running jobs
    const runningJobs = allJobs.filter(j =>
      isEnabled(j) && !pauseStatus.all && !pauseStatus.jobs.includes(j.id)
    )

    if (runningJobs.length > 0) {
      console.log('\nCurrently running:')
      for (const job of runningJobs) {
        console.log(`  - ${job.id}`)
      }
      console.log('')
    }

    if (pausedJobs.length === 0) {
      console.log('No paused jobs to unpause')
      return
    }

    const selected = await p.multiselect({
      message: 'Select jobs to unpause',
      options: pausedJobs.map(j => ({
        value: j.id,
        label: j.id,
        hint: j.description
      }))
    })

    if (p.isCancel(selected)) {
      console.log('Cancelled')
      return
    }

    jobIds = selected
  } else if (name === 'all') {
    const allJobs = await getAllJobsFlat()
    jobIds = allJobs.map(j => j.id)
    await resume('all')
  } else {
    const result = await findJob(name)
    if (!result) {
      console.error(`Error: Job "${name}" not found`)
      process.exit(1)
    }
    jobIds = [name]
  }

  // Resume and clear stale locks
  for (const id of jobIds) {
    if (name !== 'all') await resume(id)
    await clearStaleLock(id)
  }

  if (jobIds.length === 0) {
    console.log('No jobs selected')
  } else if (name === 'all') {
    console.log('✓ All jobs unpaused')
  } else {
    console.log(`✓ Unpaused: ${jobIds.join(', ')}`)
  }
}

program
  .command('unpause')
  .argument('[name]', 'Job ID to unpause, or "all" for all jobs')
  .description('Unpause a job or all jobs (interactive if no arg)')
  .action(handleUnpause)

// === Setup commands ===

program
  .command('sync')
  .argument('[path]', 'Path to jobs.js file to register and sync')
  .option('-n, --namespace <ns>', 'Namespace for this job file')
  .description('Register and sync a job file, or sync all registered files')
  .action(async (filePath, options) => {
    const namespace = options.namespace || null

    if (filePath) {
      // Register and sync a specific file
      const absPath = path.resolve(filePath)

      // Check file exists
      try {
        const { jobs } = await import(absPath)
        if (!jobs || !Array.isArray(jobs)) {
          console.error(`Error: ${absPath} must export a 'jobs' array`)
          process.exit(1)
        }

        const result = await registerFile(absPath, namespace)
        if (result === 'added') {
          const nsLabel = namespace ? ` [${namespace}]` : ''
          console.log(`✓ Registered: ${absPath}${nsLabel}`)
        } else if (result === 'updated') {
          const nsLabel = namespace ? ` [${namespace}]` : ''
          console.log(`✓ Updated namespace: ${absPath}${nsLabel}`)
        } else {
          const existingNs = await getNamespace(absPath)
          const nsLabel = existingNs ? ` [${existingNs}]` : ''
          console.log(`  Already registered: ${absPath}${nsLabel}`)
        }

        // Sync this file's jobs
        const projectPath = path.dirname(absPath)
        await sync(jobs, projectPath, namespace)
      } catch (err) {
        if (err.code === 'ERR_MODULE_NOT_FOUND') {
          console.error(`Error: File not found: ${absPath}`)
          process.exit(1)
        }
        throw err
      }
    } else {
      // Sync all registered files
      const sources = await loadAllJobs()

      if (sources.length === 0) {
        console.log('No job files registered.')
        console.log('Usage: cron-burgundy sync <path/to/jobs.js>')
        return
      }

      console.log(`\nSyncing ${sources.length} registered file(s):`)
      for (const source of sources) {
        const nsLabel = source.namespace ? ` [${source.namespace}]` : ''
        console.log(`  ${source.file}${nsLabel}`)
      }
      console.log('')

      for (const source of sources) {
        if (source.error) {
          console.log(`⚠ Skipping ${source.file}: ${source.error}`)
          continue
        }
        const projectPath = path.dirname(source.file)
        await sync(source.jobs, projectPath, source.namespace)
      }
    }
  })

program
  .command('clear')
  .argument('[target]', 'Path to job file, namespace, or "all" to clear everything')
  .option('-n, --namespace <ns>', 'Clear all jobs in this namespace')
  .description('Unregister job files and remove from launchd (interactive if no arg)')
  .action(async (target, options) => {
    // Check if clearing by namespace
    if (options.namespace) {
      const jobs = await findJobsByNamespace(options.namespace)
      if (jobs.length === 0) {
        console.log(`No jobs found in namespace: ${options.namespace}`)
        return
      }
      await uninstallAll(jobs, options.namespace)
      console.log(`\n✓ Cleared ${jobs.length} job(s) in namespace [${options.namespace}]`)
      return
    }

    if (target === 'all') {
      // Clear everything
      const allJobs = await getAllJobsFlat()
      const registry = await getRegistry()

      if (allJobs.length === 0 && registry.files.length === 0) {
        console.log('Nothing to clear')
        return
      }

      // Group jobs by namespace for proper uninstall
      const byNamespace = new Map()
      for (const job of allJobs) {
        const ns = job._namespace
        if (!byNamespace.has(ns)) byNamespace.set(ns, [])
        byNamespace.get(ns).push(job)
      }

      for (const [ns, jobs] of byNamespace) {
        await uninstallAll(jobs, ns)
      }

      for (const entry of registry.files) {
        await unregisterFile(entry.path)
      }

      console.log(`\n✓ Cleared ${registry.files.length} file(s), ${allJobs.length} job(s)`)
    } else if (target) {
      // Clear specific file
      const absPath = path.resolve(target)
      const namespace = await getNamespace(absPath)

      try {
        const { jobs } = await import(absPath)
        if (jobs && Array.isArray(jobs)) {
          await uninstallAll(jobs, namespace)
        }
      } catch {
        // File might not exist anymore
      }

      const result = await unregisterFile(absPath)
      if (result === 'removed') {
        const nsLabel = namespace ? ` [${namespace}]` : ''
        console.log(`✓ Cleared: ${absPath}${nsLabel}`)
      } else {
        console.log(`Not registered: ${absPath}`)
      }
    } else {
      // Interactive multiselect
      const registry = await getRegistry()

      if (registry.files.length === 0) {
        console.log('No job files registered')
        return
      }

      const selected = await p.multiselect({
        message: 'Select job files to clear',
        options: registry.files.map(f => ({
          value: f.path,
          label: path.basename(f.path),
          hint: f.namespace ? `[${f.namespace}] ${path.dirname(f.path)}` : path.dirname(f.path)
        }))
      })

      if (p.isCancel(selected)) {
        console.log('Cancelled')
        return
      }

      if (selected.length === 0) {
        console.log('No files selected')
        return
      }

      for (const filePath of selected) {
        const namespace = await getNamespace(filePath)
        try {
          const { jobs } = await import(filePath)
          if (jobs && Array.isArray(jobs)) {
            await uninstallAll(jobs, namespace)
          }
        } catch {
          // File might not exist
        }
        await unregisterFile(filePath)
      }

      console.log(`✓ Cleared ${selected.length} file(s)`)
    }
  })

// === System commands ===

program
  .command('status')
  .description('Check installed launchd plists')
  .action(async () => {
    const plists = await listInstalledPlists()

    if (plists.length > 0) {
      console.log('\n=== Installed Plists ===\n')
      for (const plist of plists) {
        console.log(`  ${plist}`)
      }
      console.log(`\nTotal: ${plists.length} plists`)
    } else {
      console.log('✗ No cron-burgundy plists installed')
      console.log('  Run: cron-burgundy sync')
    }
  })

program
  .command('check-missed')
  .description('Check and run any missed jobs (called by launchd on wake)')
  .action(async () => {
    const allJobs = await getAllJobsFlat()
    if (allJobs.length === 0) {
      console.log('No jobs registered')
      return
    }
    await checkMissed(allJobs)
  })

program.parse()
