#!/usr/bin/env node

import { Command } from 'commander'
import path from 'path'
import { runAllDue, runJobNow, checkMissed } from '../src/runner.js'
import { getState, pause, resume, getPauseStatus, isPaused, getNextScheduledRun } from '../src/state.js'
import { getIntervalMs, getNextRun, formatInterval, isEnabled, getDisplaySchedule } from '../src/scheduler.js'
import { sync, uninstallAll, listInstalledPlists } from '../src/launchd.js'
import { spawn } from 'child_process'
import { readRunnerLog, readJobLog, clearRunnerLog, clearJobLog, clearAllJobLogs, listLogFiles, colorizeLine, RUNNER_LOG, JOBS_LOG_DIR } from '../src/logger.js'
import { getRegistry, registerFile, unregisterFile, loadAllJobs, findJob, getAllJobsFlat } from '../src/registry.js'
import { clearStaleLock } from '../src/lock.js'
import * as p from '@clack/prompts'

const program = new Command()

program
  .name('cron-burgundy')
  .description('Simple macOS cron manager with missed job recovery')
  .version('1.0.0')

program
  .command('run')
  .argument('[jobId]', 'Job ID to run immediately')
  .option('-s, --scheduled', 'Mark as scheduled run (updates nextRun in state)')
  .description('Run a specific job by ID (called by launchd)')
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
        console.log(`Job "${jobId}" is disabled, skipping`)
        return
      }
      await runJobNow(job, { scheduled: options.scheduled })
      if (!options.scheduled) {
        console.log(`✓ ${jobId} completed`)
      }
    } else {
      console.error('Error: Job ID required\n')
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
      console.error('\nUsage: cron-burgundy run <jobId>')
      process.exit(1)
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

program
  .command('list')
  .description('List all registered jobs with status')
  .action(async () => {
    const sources = await loadAllJobs()
    const state = await getState()
    const pauseStatus = await getPauseStatus()

    console.log('\n=== Registered Jobs ===\n')

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

    for (const source of sources) {
      console.log(`${source.file}:`)

      if (source.error) {
        console.log(`  ⚠ Error loading: ${source.error}\n`)
        continue
      }

      if (source.jobs.length === 0) {
        console.log('  (no jobs)\n')
        continue
      }

      for (const job of source.jobs) {
        const lastRunStr = state[job.id]
        const lastRun = lastRunStr ? new Date(lastRunStr) : null
        const nextRun = job.interval
          ? await getNextScheduledRun(job.id)
          : getNextRun(job, lastRun)
        const jobPaused = pauseStatus.all || pauseStatus.jobs.includes(job.id)
        const status = !isEnabled(job) ? '✗' : jobPaused ? '⏸' : '✓'

        console.log(`  ${status} ${job.id}`)
        if (job.description) {
          console.log(`     ${job.description}`)
        }
        const statusText = !isEnabled(job) ? 'DISABLED' : jobPaused ? 'PAUSED' : 'enabled'
        console.log(`     Status:   ${statusText}`)
        console.log(`     Schedule: ${getDisplaySchedule(job)}`)
        console.log(`     Last run: ${lastRun ? lastRun.toLocaleString() : 'never'}`)
        if (isEnabled(job) && !jobPaused) {
          const nextDueStr = nextRun ? nextRun.toLocaleString() : (job.interval ? 'unknown' : 'now')
          console.log(`     Next due: ${nextDueStr}`)
        }
        console.log('')

        totalJobs++
        if (isEnabled(job)) totalEnabled++
        else totalDisabled++
      }
    }

    const pausedCount = pauseStatus.all ? totalEnabled : pauseStatus.jobs.length
    console.log(`Total: ${totalJobs} jobs (${totalEnabled} enabled, ${totalDisabled} disabled, ${pausedCount} paused)`)
    console.log(`Files: ${sources.length} registered`)
  })

program
  .command('sync')
  .argument('[path]', 'Path to jobs.js file to register and sync')
  .description('Register and sync a job file, or sync all registered files')
  .action(async (filePath) => {
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

        const result = await registerFile(absPath)
        if (result === 'added') {
          console.log(`✓ Registered: ${absPath}`)
        } else {
          console.log(`  Already registered: ${absPath}`)
        }

        // Sync this file's jobs
        const projectPath = path.dirname(absPath)
        await sync(jobs, projectPath)
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
        console.log(`  ${source.file}`)
      }
      console.log('')

      for (const source of sources) {
        if (source.error) {
          console.log(`⚠ Skipping ${source.file}: ${source.error}`)
          continue
        }
        const projectPath = path.dirname(source.file)
        await sync(source.jobs, projectPath)
      }
    }
  })

program
  .command('uninstall')
  .description('Remove all launchd plists for all registered jobs')
  .action(async () => {
    const allJobs = await getAllJobsFlat()
    if (allJobs.length === 0) {
      console.log('No jobs registered')
      return
    }
    await uninstallAll(allJobs)
  })

program
  .command('unregister')
  .argument('<path>', 'Path to jobs.js file to unregister')
  .description('Unregister a job file (also uninstalls its jobs from launchd)')
  .action(async (filePath) => {
    const absPath = path.resolve(filePath)

    // Try to load and uninstall jobs first
    try {
      const { jobs } = await import(absPath)
      if (jobs && Array.isArray(jobs)) {
        await uninstallAll(jobs)
      }
    } catch {
      // File might not exist anymore, that's ok
    }

    const result = await unregisterFile(absPath)
    if (result === 'removed') {
      console.log(`✓ Unregistered: ${absPath}`)
    } else {
      console.log(`  Not registered: ${absPath}`)
    }
  })

program
  .command('status')
  .description('Check installed launchd plists')
  .action(async () => {
    const plists = await listInstalledPlists()
    
    if (plists.length > 0) {
      console.log('\n=== Installed Plists ===\n')
      for (const p of plists) {
        console.log(`  ${p}`)
      }
      console.log(`\nTotal: ${plists.length} plists`)
    } else {
      console.log('✗ No cron-burgundy plists installed')
      console.log('  Run: cron-burgundy sync')
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
      console.log(`\n=== Tailing: ${logPath} ===\n`)
      console.log('(Press Ctrl+C to stop)\n')
      const tail = spawn('tail', ['-f', '-n', '0', logPath], { stdio: 'inherit' })
      tail.on('error', (err) => {
        console.error(`Error: ${err.message}`)
        process.exit(1)
      })
      return
    }
    
    if (jobId) {
      console.log(`\n=== Logs for: ${jobId} ===\n`)
      const log = await readJobLog(jobId, lines)
      console.log(log)
    } else {
      console.log('\n=== Runner Log ===\n')
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
  .argument('[name]', 'Job ID to clear, "all" for all job logs, omit for runner log')
  .description('Clear logs')
  .action(async (name) => {
    if (name === 'all') {
      const cleared = await clearAllJobLogs()
      console.log(`✓ Cleared ${cleared.length} job logs`)
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

program
  .command('resume')
  .argument('[name]', 'Job ID to resume, or "all" for all jobs')
  .description('Resume a paused job or all jobs (interactive if no arg)')
  .action(async (name) => {
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
        console.log('No paused jobs to resume')
        return
      }

      const selected = await p.multiselect({
        message: 'Select jobs to resume',
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
      console.log('✓ All jobs resumed')
    } else {
      console.log(`✓ Resumed: ${jobIds.join(', ')}`)
    }
  })

program.parse()
