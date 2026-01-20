import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import { execSync } from 'child_process'
import { fileURLToPath } from 'url'
import plist from 'plist'
import { normalizeSchedule } from './cron-parser.js'
import { clearLock } from './lock.js'
import { resume } from './state.js'
import { qualifyJobId } from './registry.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(__dirname, '..')

/**
 * Ensure we're running on macOS
 * @throws {Error} if not on macOS
 */
function requireMacOS() {
  if (process.platform !== 'darwin') {
    throw new Error('cron-burgundy requires macOS (uses launchd for scheduling)')
  }
}

const LABEL_PREFIX = 'com.cron-burgundy'
const WAKE_CHECKER_LABEL = `${LABEL_PREFIX}.wakecheck`
const LAUNCH_AGENTS_DIR = path.join(os.homedir(), 'Library', 'LaunchAgents')

// launchd limits (Apple enforces 10 second minimum for StartInterval)
const MIN_INTERVAL_SECONDS = 10
const MIN_INTERVAL_MS = MIN_INTERVAL_SECONDS * 1000

/**
 * Get the path to the node binary
 * @returns {string}
 */
function getNodePath() {
  try {
    return execSync('which node', { encoding: 'utf8' }).trim()
  } catch {
    return '/usr/local/bin/node'
  }
}

/**
 * Get launchd label for a job
 * @param {string} jobId
 * @param {string|null} namespace
 * @returns {string}
 */
function getJobLabel(jobId, namespace = null) {
  if (namespace) {
    return `${LABEL_PREFIX}.job.${namespace}.${jobId}`
  }
  return `${LABEL_PREFIX}.job.${jobId}`
}

/**
 * Get plist path for a job
 * @param {string} jobId
 * @param {string|null} namespace
 * @returns {string}
 */
function getJobPlistPath(jobId, namespace = null) {
  return path.join(LAUNCH_AGENTS_DIR, `${getJobLabel(jobId, namespace)}.plist`)
}

/**
 * Get plist path for wake checker
 * @returns {string}
 */
function getWakeCheckerPlistPath() {
  return path.join(LAUNCH_AGENTS_DIR, `${WAKE_CHECKER_LABEL}.plist`)
}

/**
 * Expand a cron field value into an array of integers
 * Handles: *, single values, ranges (6-12), lists (1,3,5)
 * @param {string} field
 * @returns {number[]|null} null means wildcard (*)
 */
function expandCronField(field) {
  if (field === '*') return null

  const values = new Set()

  for (const part of field.split(',')) {
    if (part.includes('-')) {
      const [start, end] = part.split('-').map(n => parseInt(n, 10))
      for (let i = start; i <= end; i++) {
        values.add(i)
      }
    } else {
      values.add(parseInt(part, 10))
    }
  }

  return [...values].sort((a, b) => a - b)
}

/**
 * Parse cron expression to StartCalendarInterval format
 * @param {string} cronExpr - Cron expression (e.g., "0 9 * * *")
 * @returns {Object|Object[]}
 */
function cronToCalendarInterval(cronExpr) {
  // Parse cron: minute hour dayOfMonth month dayOfWeek
  const parts = cronExpr.trim().split(/\s+/)
  if (parts.length !== 5) {
    throw new Error(`Invalid cron expression: ${cronExpr}`)
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts

  const minutes = expandCronField(minute)
  const hours = expandCronField(hour)
  const days = expandCronField(dayOfMonth)
  const months = expandCronField(month)
  const weekdays = expandCronField(dayOfWeek)

  // Build all combinations
  const intervals = []

  const minuteVals = minutes || [null]
  const hourVals = hours || [null]
  const dayVals = days || [null]
  const monthVals = months || [null]
  const weekdayVals = weekdays || [null]

  for (const m of minuteVals) {
    for (const h of hourVals) {
      for (const d of dayVals) {
        for (const mo of monthVals) {
          for (const wd of weekdayVals) {
            const interval = {}
            if (m !== null) interval.Minute = m
            if (h !== null) interval.Hour = h
            if (d !== null) interval.Day = d
            if (mo !== null) interval.Month = mo
            if (wd !== null) interval.Weekday = wd
            intervals.push(interval)
          }
        }
      }
    }
  }

  return intervals.length === 1 ? intervals[0] : intervals
}

/**
 * Generate plist config for a specific job
 * @param {import('./scheduler.js').Job} job
 * @param {string} jobFileDir - directory containing the job file (used as WorkingDirectory)
 * @param {string|null} namespace
 * @returns {Object}
 */
export function generateJobPlistConfig(job, jobFileDir, namespace = null) {
  const nodePath = getNodePath()
  const cliPath = path.join(PROJECT_ROOT, 'bin', 'cli.js')
  const logDir = path.join(os.homedir(), '.cron-burgundy')
  const qualifiedId = qualifyJobId(job.id, namespace)

  const config = {
    Label: getJobLabel(job.id, namespace),
    ProgramArguments: [nodePath, cliPath, 'run', '--scheduled', qualifiedId],
    StandardOutPath: path.join(logDir, 'runner.log'),
    StandardErrorPath: path.join(logDir, 'runner.error.log'),
    WorkingDirectory: jobFileDir,
    EnvironmentVariables: {
      PATH: `${path.dirname(nodePath)}:/usr/local/bin:/usr/bin:/bin`
    }
  }

  // Add schedule based on job type
  if (job.schedule) {
    const cronSchedule = normalizeSchedule(job.schedule)
    config.StartCalendarInterval = cronToCalendarInterval(cronSchedule)
  } else if (job.interval) {
    if (job.interval < MIN_INTERVAL_MS) {
      throw new Error(`Job "${job.id}": interval must be at least ${MIN_INTERVAL_SECONDS} seconds (${MIN_INTERVAL_MS}ms), got ${job.interval}ms`)
    }
    config.StartInterval = Math.floor(job.interval / 1000) // Convert ms to seconds
  }

  return config
}

/**
 * Generate plist config for wake checker (runs on login/wake to catch missed jobs)
 * @returns {Object}
 */
export function generateWakeCheckerPlistConfig() {
  const nodePath = getNodePath()
  const cliPath = path.join(PROJECT_ROOT, 'bin', 'cli.js')
  const logDir = path.join(os.homedir(), '.cron-burgundy')

  return {
    Label: WAKE_CHECKER_LABEL,
    ProgramArguments: [nodePath, cliPath, 'check-missed'],
    RunAtLoad: true,  // Run on login/wake
    StandardOutPath: path.join(logDir, 'runner.log'),
    StandardErrorPath: path.join(logDir, 'runner.error.log'),
    WorkingDirectory: PROJECT_ROOT,
    EnvironmentVariables: {
      PATH: `${path.dirname(nodePath)}:/usr/local/bin:/usr/bin:/bin`
    }
  }
}

/**
 * Load a plist into launchd
 * @param {string} plistPath
 */
function loadPlist(plistPath) {
  try {
    execSync(`launchctl load "${plistPath}"`, { stdio: 'ignore' })
  } catch {
    // May already be loaded
  }
}

/**
 * Unload a plist from launchd
 * @param {string} plistPath
 */
function unloadPlist(plistPath) {
  try {
    execSync(`launchctl unload "${plistPath}"`, { stdio: 'ignore' })
  } catch {
    // May not be loaded
  }
}

/**
 * Install a single job's plist
 * @param {import('./scheduler.js').Job} job
 * @param {string} projectPath
 * @param {string|null} namespace
 * @returns {Promise<'installed'|'unchanged'>}
 */
export async function installJob(job, projectPath, namespace = null) {
  requireMacOS()
  await fs.mkdir(LAUNCH_AGENTS_DIR, { recursive: true })

  const plistPath = getJobPlistPath(job.id, namespace)
  const config = generateJobPlistConfig(job, projectPath, namespace)
  const xml = plist.build(config)

  // Check if plist already exists and is identical
  try {
    const existing = await fs.readFile(plistPath, 'utf8')
    if (existing === xml) {
      return 'unchanged'
    }
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
  }

  // Unload first if exists
  unloadPlist(plistPath)

  // Write and load
  await fs.writeFile(plistPath, xml)
  loadPlist(plistPath)

  return 'installed'
}

/**
 * Uninstall a single job's plist
 * @param {string} jobId
 * @param {{ alwaysPrint?: boolean, description?: string, namespace?: string|null }} [options]
 */
export async function uninstallJob(jobId, options = {}) {
  requireMacOS()
  const { alwaysPrint = false, description, namespace = null } = options
  const plistPath = getJobPlistPath(jobId, namespace)
  const qualifiedId = qualifyJobId(jobId, namespace)
  const desc = description ? ` - ${description}` : ''

  unloadPlist(plistPath)

  try {
    await fs.unlink(plistPath)
    await clearLock(qualifiedId)
    await resume(qualifiedId)  // Clear pause state
    console.log(`  ✗ ${qualifiedId}${desc}`)
  } catch (err) {
    if (err.code === 'ENOENT') {
      await clearLock(qualifiedId)
      await resume(qualifiedId)  // Clear pause state
      if (alwaysPrint) console.log(`  ✗ ${qualifiedId}${desc}`)
    } else {
      throw err
    }
  }
}

/**
 * Install the wake checker plist
 */
export async function installWakeChecker() {
  requireMacOS()
  await fs.mkdir(LAUNCH_AGENTS_DIR, { recursive: true })

  const plistPath = getWakeCheckerPlistPath()
  const config = generateWakeCheckerPlistConfig()
  const xml = plist.build(config)
  
  unloadPlist(plistPath)
  await fs.writeFile(plistPath, xml)
  loadPlist(plistPath)
  
  console.log(`  ✓ Installed: wake-checker (runs on login/wake)`)
}

/**
 * Uninstall the wake checker plist
 */
export async function uninstallWakeChecker() {
  requireMacOS()
  const plistPath = getWakeCheckerPlistPath()
  
  unloadPlist(plistPath)
  
  try {
    await fs.unlink(plistPath)
    console.log(`  ✗ Removed: wake-checker`)
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
  }
}

/**
 * Sync jobs with launchd - install enabled, remove disabled
 * @param {import('./scheduler.js').Job[]} jobs
 * @param {string} projectPath
 * @param {string|null} namespace
 */
export async function sync(jobs, projectPath, namespace = null) {
  const { isEnabled } = await import('./scheduler.js')

  const nsLabel = namespace ? ` [${namespace}]` : ''
  console.log(`=== Syncing jobs with launchd${nsLabel} ===\n`)

  const enabled = jobs.filter(j => isEnabled(j))
  const disabled = jobs.filter(j => !isEnabled(j))
  const allJobIds = new Set(jobs.map(j => j.id))

  // Install enabled jobs
  const installed = []
  const unchanged = []

  for (const job of enabled) {
    const result = await installJob(job, projectPath, namespace)
    if (result === 'installed') {
      installed.push(job)
    } else {
      unchanged.push(job)
    }
  }

  if (enabled.length > 0) {
    console.log('Installed jobs:')
    for (const job of enabled) {
      const qualifiedId = qualifyJobId(job.id, namespace)
      const desc = job.description ? ` - ${job.description}` : ''
      const status = unchanged.includes(job) ? ' (unchanged)' : ''
      console.log(`  ✓ ${qualifiedId}${desc}${status}`)
    }
  }

  // Remove disabled jobs
  if (disabled.length > 0) {
    console.log('\nDisabled jobs:')
    for (const job of disabled) {
      await uninstallJob(job.id, { alwaysPrint: true, description: job.description, namespace })
    }
  }

  // Remove orphaned plists for THIS namespace only
  const installedPlists = await listInstalledPlists()
  const orphaned = []

  for (const plistFile of installedPlists) {
    // Parse the plist filename to extract namespace and jobId
    const parsed = parsePlistFilename(plistFile)
    if (!parsed) continue

    // Only check orphans within the same namespace
    if (parsed.namespace !== namespace) continue

    if (!allJobIds.has(parsed.jobId)) {
      orphaned.push(parsed)
    }
  }

  if (orphaned.length > 0) {
    console.log('\nRemoving orphaned jobs:')
    for (const { jobId, namespace: ns } of orphaned) {
      await uninstallJob(jobId, { namespace: ns })
    }
  }

  console.log(`\n✓ Sync complete: ${installed.length} installed, ${unchanged.length} unchanged, ${disabled.length} disabled, ${orphaned.length} orphaned`)
  console.log('\nNote: Wake detection handled by sleepwatcher (~/.wakeup)')
}

/**
 * Parse a plist filename to extract namespace and jobId
 * @param {string} filename - e.g. "com.cron-burgundy.job.pm.tick.plist"
 * @returns {{ namespace: string|null, jobId: string }|null}
 */
function parsePlistFilename(filename) {
  const jobPrefix = `${LABEL_PREFIX}.job.`
  if (!filename.startsWith(jobPrefix) || !filename.endsWith('.plist')) {
    return null
  }

  // Remove prefix and .plist suffix
  const rest = filename.slice(jobPrefix.length, -6)

  // Check if there's a namespace (format: namespace.jobId)
  // Simple heuristic: if there's a dot, first part is namespace
  const dotIdx = rest.indexOf('.')
  if (dotIdx === -1) {
    return { namespace: null, jobId: rest }
  }

  return {
    namespace: rest.slice(0, dotIdx),
    jobId: rest.slice(dotIdx + 1)
  }
}

/**
 * Uninstall all plists for given jobs
 * @param {import('./scheduler.js').Job[]} jobs
 * @param {string|null} namespace
 */
export async function uninstallAll(jobs, namespace = null) {
  const nsLabel = namespace ? ` [${namespace}]` : ''
  console.log(`\n=== Uninstalling all jobs${nsLabel} ===\n`)

  for (const job of jobs) {
    await uninstallJob(job.id, { namespace })
  }

  // Only uninstall wake checker if no namespace (global uninstall)
  if (!namespace) {
    await uninstallWakeChecker()
  }

  console.log('\n✓ All jobs uninstalled')
}

/**
 * List all installed cron-burgundy plists
 * @returns {Promise<string[]>}
 */
export async function listInstalledPlists() {
  requireMacOS()
  try {
    const files = await fs.readdir(LAUNCH_AGENTS_DIR)
    return files.filter(f => f.startsWith(LABEL_PREFIX))
  } catch {
    return []
  }
}

export {
  LABEL_PREFIX,
  LAUNCH_AGENTS_DIR,
  MIN_INTERVAL_MS,
  MIN_INTERVAL_SECONDS,
  getJobLabel,
  getJobPlistPath,
  getWakeCheckerPlistPath,
  expandCronField,
  cronToCalendarInterval,
  parsePlistFilename
}
