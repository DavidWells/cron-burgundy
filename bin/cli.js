#!/usr/bin/env node

import { Command } from 'commander'
import path from 'path'
import { fileURLToPath } from 'url'
import { runAllDue, runJobNow, checkMissed } from '../src/runner.js'
import { getState, pause, resume, getPauseStatus, isPaused, getNextScheduledRun } from '../src/state.js'
import { getIntervalMs, getNextRun, formatInterval, isEnabled, getDisplaySchedule } from '../src/scheduler.js'
import { sync, uninstallAll, listInstalledPlists } from '../src/launchd.js'
import { spawn } from 'child_process'
import { readRunnerLog, readJobLog, clearRunnerLog, clearJobLog, clearAllJobLogs, listLogFiles, RUNNER_LOG, JOBS_LOG_DIR } from '../src/logger.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(__dirname, '..')

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
    try {
      const { jobs } = await import(path.join(PROJECT_ROOT, 'jobs.js'))

      if (jobId) {
        const job = jobs.find(j => j.id === jobId)
        if (!job) {
          console.error(`Error: Job "${jobId}" not found`)
          process.exit(1)
        }
        if (options.scheduled && !isEnabled(job)) {
          console.log(`Job "${jobId}" is disabled, skipping`)
          return
        }
        await runJobNow(job, { scheduled: options.scheduled })
        console.log(`✓ ${jobId} completed`)
      } else {
        console.error('Error: Job ID required\n')
        console.error('Available jobs:')
        for (const job of jobs) {
          const status = isEnabled(job) ? '✓' : '✗'
          console.error(`  ${status} ${job.id}`)
        }
        console.error('\nUsage: cron-burgundy run <jobId>')
        process.exit(1)
      }
    } catch (err) {
      if (err.code === 'ERR_MODULE_NOT_FOUND') {
        console.error('Error: jobs.js not found in project root')
        process.exit(1)
      }
      throw err
    }
  })

program
  .command('check-missed')
  .description('Check and run any missed jobs (called by launchd on wake)')
  .action(async () => {
    try {
      const { jobs } = await import(path.join(PROJECT_ROOT, 'jobs.js'))
      await checkMissed(jobs)
    } catch (err) {
      if (err.code === 'ERR_MODULE_NOT_FOUND') {
        console.error('Error: jobs.js not found in project root')
        process.exit(1)
      }
      throw err
    }
  })

program
  .command('list')
  .description('List all registered jobs with status')
  .action(async () => {
    try {
      const { jobs } = await import(path.join(PROJECT_ROOT, 'jobs.js'))
      const state = await getState()
      const pauseStatus = await getPauseStatus()

      console.log('\n=== Registered Jobs ===\n')

      if (pauseStatus.all) {
        console.log('⏸  ALL JOBS PAUSED\n')
      }

      const enabled = jobs.filter(j => isEnabled(j))
      const disabled = jobs.filter(j => !isEnabled(j))

      for (const job of jobs) {
        const lastRunStr = state[job.id]
        const lastRun = lastRunStr ? new Date(lastRunStr) : null
        // For interval jobs, use stored nextRun; for cron jobs, calculate from expression
        const nextRun = job.interval
          ? await getNextScheduledRun(job.id)
          : getNextRun(job, lastRun)
        const jobPaused = pauseStatus.all || pauseStatus.jobs.includes(job.id)
        const status = !isEnabled(job) ? '✗' : jobPaused ? '⏸' : '✓'

        console.log(`${status} ${job.id}`)
        if (job.description) {
          console.log(`   ${job.description}`)
        }
        const statusText = !isEnabled(job) ? 'DISABLED' : jobPaused ? 'PAUSED' : 'enabled'
        console.log(`   Status:   ${statusText}`)
        console.log(`   Schedule: ${getDisplaySchedule(job)}`)
        console.log(`   Last run: ${lastRun ? lastRun.toLocaleString() : 'never'}`)
        if (isEnabled(job) && !jobPaused) {
          const nextDueStr = nextRun ? nextRun.toLocaleString() : (job.interval ? 'unknown' : 'now')
          console.log(`   Next due: ${nextDueStr}`)
        }
        console.log('')
      }

      const pausedCount = pauseStatus.all ? enabled.length : pauseStatus.jobs.length
      console.log(`Total: ${jobs.length} jobs (${enabled.length} enabled, ${disabled.length} disabled, ${pausedCount} paused)`)
    } catch (err) {
      if (err.code === 'ERR_MODULE_NOT_FOUND') {
        console.error('Error: jobs.js not found in project root')
        process.exit(1)
      }
      throw err
    }
  })

program
  .command('sync')
  .description('Sync jobs with launchd (install enabled, remove disabled)')
  .action(async () => {
    try {
      const { jobs } = await import(path.join(PROJECT_ROOT, 'jobs.js'))
      await sync(jobs, PROJECT_ROOT)
    } catch (err) {
      if (err.code === 'ERR_MODULE_NOT_FOUND') {
        console.error('Error: jobs.js not found in project root')
        process.exit(1)
      }
      throw err
    }
  })

program
  .command('uninstall')
  .description('Remove all launchd plists')
  .action(async () => {
    try {
      const { jobs } = await import(path.join(PROJECT_ROOT, 'jobs.js'))
      await uninstallAll(jobs)
    } catch (err) {
      if (err.code === 'ERR_MODULE_NOT_FOUND') {
        console.error('Error: jobs.js not found in project root')
        process.exit(1)
      }
      throw err
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
        try {
          const { jobs } = await import(path.join(PROJECT_ROOT, 'jobs.js'))
          const job = jobs.find(j => j.id === jobId)
          if (job) {
            console.log(`\nSchedule: ${getDisplaySchedule(job)}`)
          }
        } catch {}
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
      console.log(log)
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
  .argument('<name>', 'Job ID to pause, or "all" for all jobs')
  .description('Pause a job or all jobs')
  .action(async (name) => {
    await pause(name)
    if (name === 'all') {
      console.log('✓ All jobs paused')
    } else {
      console.log(`✓ Paused: ${name}`)
    }
  })

program
  .command('resume')
  .argument('<name>', 'Job ID to resume, or "all" for all jobs')
  .description('Resume a paused job or all jobs')
  .action(async (name) => {
    await resume(name)
    if (name === 'all') {
      console.log('✓ All jobs resumed')
    } else {
      console.log(`✓ Resumed: ${name}`)
    }
  })

program.parse()
