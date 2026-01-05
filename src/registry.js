/**
 * Registry for tracking job file locations across the system
 */
import fs from 'fs/promises'
import path from 'path'
import os from 'os'

const STATE_DIR = path.join(os.homedir(), '.cron-burgundy')
const REGISTRY_FILE = path.join(STATE_DIR, 'registry.json')

/**
 * Ensure the state directory exists
 */
async function ensureStateDir() {
  await fs.mkdir(STATE_DIR, { recursive: true })
}

/**
 * Get the registry
 * @returns {Promise<{files: string[]}>}
 */
export async function getRegistry() {
  try {
    const data = await fs.readFile(REGISTRY_FILE, 'utf8')
    return JSON.parse(data)
  } catch (err) {
    if (err.code === 'ENOENT') return { files: [] }
    throw err
  }
}

/**
 * Save the registry
 * @param {{files: string[]}} registry
 */
async function saveRegistry(registry) {
  await ensureStateDir()
  await fs.writeFile(REGISTRY_FILE, JSON.stringify(registry, null, 2))
}

/**
 * Register a job file
 * @param {string} filePath - absolute path to jobs.js file
 * @returns {Promise<'added'|'exists'>}
 */
export async function registerFile(filePath) {
  const absPath = path.resolve(filePath)
  const registry = await getRegistry()

  if (registry.files.includes(absPath)) {
    return 'exists'
  }

  registry.files.push(absPath)
  await saveRegistry(registry)
  return 'added'
}

/**
 * Unregister a job file
 * @param {string} filePath - absolute path to jobs.js file
 * @returns {Promise<'removed'|'not_found'>}
 */
export async function unregisterFile(filePath) {
  const absPath = path.resolve(filePath)
  const registry = await getRegistry()

  const idx = registry.files.indexOf(absPath)
  if (idx === -1) {
    return 'not_found'
  }

  registry.files.splice(idx, 1)
  await saveRegistry(registry)
  return 'removed'
}

/**
 * Load jobs from a single file
 * @param {string} filePath
 * @returns {Promise<{file: string, jobs: import('./scheduler.js').Job[], error?: string}>}
 */
export async function loadJobsFromFile(filePath) {
  try {
    const mod = await import(filePath)
    const jobs = mod.jobs || mod.default?.jobs || []
    return { file: filePath, jobs }
  } catch (err) {
    return { file: filePath, jobs: [], error: err.message }
  }
}

/**
 * Load all jobs from all registered files
 * @returns {Promise<{file: string, jobs: import('./scheduler.js').Job[], error?: string}[]>}
 */
export async function loadAllJobs() {
  const registry = await getRegistry()
  const results = []

  for (const file of registry.files) {
    results.push(await loadJobsFromFile(file))
  }

  return results
}

/**
 * Get all jobs as a flat array with source info
 * @returns {Promise<Array<import('./scheduler.js').Job & {_source: string}>>}
 */
export async function getAllJobsFlat() {
  const sources = await loadAllJobs()
  const allJobs = []

  for (const source of sources) {
    if (source.error) continue
    for (const job of source.jobs) {
      allJobs.push({ ...job, _source: source.file })
    }
  }

  return allJobs
}

/**
 * Find a job by ID across all registered files
 * @param {string} jobId
 * @returns {Promise<{job: import('./scheduler.js').Job & {_source: string}, source: string} | null>}
 */
export async function findJob(jobId) {
  const sources = await loadAllJobs()

  for (const source of sources) {
    if (source.error) continue
    const job = source.jobs.find(j => j.id === jobId)
    if (job) {
      return { job: { ...job, _source: source.file }, source: source.file }
    }
  }

  return null
}

export { REGISTRY_FILE }
