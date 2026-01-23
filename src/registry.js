/**
 * Registry for tracking job file locations across the system
 */
import fs from 'fs/promises'
import path from 'path'
import os from 'os'

const STATE_DIR = path.join(os.homedir(), '.cron-burgundy')
const REGISTRY_FILE = path.join(STATE_DIR, 'registry.json')

/**
 * @typedef {Object} RegistryEntry
 * @property {string} path - absolute path to jobs.js file
 * @property {string|null} namespace - namespace for jobs (null = no namespace)
 */

/**
 * @typedef {Object} Registry
 * @property {RegistryEntry[]} files
 */

/**
 * Ensure the state directory exists
 */
async function ensureStateDir() {
  await fs.mkdir(STATE_DIR, { recursive: true })
}

/**
 * Migrate old format (string[]) to new format ({path, namespace}[])
 * @param {any} data - raw registry data
 * @returns {Registry}
 */
function migrateRegistry(data) {
  if (!data || !data.files) return { files: [] }

  // Check if already in new format
  if (data.files.length > 0 && typeof data.files[0] === 'object') {
    return data
  }

  // Migrate from string[] to {path, namespace}[]
  return {
    files: data.files.map(f => ({ path: f, namespace: null }))
  }
}

/**
 * Get the registry
 * @returns {Promise<Registry>}
 */
export async function getRegistry() {
  try {
    const data = await fs.readFile(REGISTRY_FILE, 'utf8')
    return migrateRegistry(JSON.parse(data))
  } catch (err) {
    if (err.code === 'ENOENT') return { files: [] }
    throw err
  }
}

/**
 * Save the registry
 * @param {Registry} registry
 */
async function saveRegistry(registry) {
  await ensureStateDir()
  await fs.writeFile(REGISTRY_FILE, JSON.stringify(registry, null, 2))
}

/**
 * Validate a job ID format
 * Job IDs must not contain characters that could cause issues in file paths,
 * plist labels, or namespace parsing.
 * @param {string} jobId
 * @throws {Error} if the job ID is invalid
 */
export function validateJobId(jobId) {
  if (!jobId || typeof jobId !== 'string') {
    throw new Error('Job ID must be a non-empty string')
  }

  if (jobId.length > 100) {
    throw new Error(`Job ID "${jobId}" is too long (max 100 characters)`)
  }

  // Block dots - they cause parsing issues in plist filenames (namespace.jobId format)
  if (jobId.includes('.')) {
    throw new Error(`Job ID "${jobId}" cannot contain dots (.) - they conflict with plist naming`)
  }

  // Block path traversal and file system unsafe characters
  const invalidChars = ['/', '\\', '..', ' ', '\t', '\n', '\r', '\0', ':', '*', '?', '"', '<', '>', '|']
  for (const char of invalidChars) {
    if (jobId.includes(char)) {
      throw new Error(`Job ID "${jobId}" contains invalid character: "${char}"`)
    }
  }

  // Must start with alphanumeric or underscore
  if (!/^[a-zA-Z0-9_]/.test(jobId)) {
    throw new Error(`Job ID "${jobId}" must start with a letter, number, or underscore`)
  }

  // Only allow alphanumeric, underscore, and hyphen
  if (!/^[a-zA-Z0-9_-]+$/.test(jobId)) {
    throw new Error(`Job ID "${jobId}" contains invalid characters - only letters, numbers, underscores, and hyphens are allowed`)
  }
}

/**
 * Qualify a job ID with namespace
 * @param {string} jobId
 * @param {string|null} namespace
 * @returns {string} - "namespace/jobId" or just "jobId" if no namespace
 */
export function qualifyJobId(jobId, namespace) {
  if (!namespace) return jobId
  return `${namespace}/${jobId}`
}

/**
 * Parse a qualified job ID
 * @param {string} id - "namespace/jobId" or just "jobId"
 * @returns {{ namespace: string|null, jobId: string }}
 */
export function parseQualifiedId(id) {
  const slashIdx = id.indexOf('/')
  if (slashIdx === -1) {
    return { namespace: null, jobId: id }
  }
  return {
    namespace: id.slice(0, slashIdx),
    jobId: id.slice(slashIdx + 1)
  }
}

/**
 * Register a job file
 * @param {string} filePath - absolute path to jobs.js file
 * @param {string|null} [namespace] - optional namespace for this file's jobs
 * @returns {Promise<'added'|'updated'|'exists'>}
 */
export async function registerFile(filePath, namespace = null) {
  const absPath = path.resolve(filePath)
  const registry = await getRegistry()

  const existingIdx = registry.files.findIndex(f => f.path === absPath)

  if (existingIdx !== -1) {
    // File already registered - check if namespace changed
    if (registry.files[existingIdx].namespace === namespace) {
      return 'exists'
    }
    // Update namespace
    registry.files[existingIdx].namespace = namespace
    await saveRegistry(registry)
    return 'updated'
  }

  registry.files.push({ path: absPath, namespace })
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

  const idx = registry.files.findIndex(f => f.path === absPath)
  if (idx === -1) {
    return 'not_found'
  }

  registry.files.splice(idx, 1)
  await saveRegistry(registry)
  return 'removed'
}

/**
 * Get namespace for a file path
 * @param {string} filePath
 * @returns {Promise<string|null>}
 */
export async function getNamespace(filePath) {
  const absPath = path.resolve(filePath)
  const registry = await getRegistry()
  const entry = registry.files.find(f => f.path === absPath)
  return entry?.namespace ?? null
}

/**
 * @typedef {Object} JobSource
 * @property {string} file
 * @property {string|null} namespace
 * @property {import('./scheduler.js').Job[]} jobs
 * @property {string} [error]
 */

/**
 * Load jobs from a single file
 * @param {string} filePath
 * @param {string|null} namespace
 * @returns {Promise<JobSource>}
 */
export async function loadJobsFromFile(filePath, namespace = null) {
  try {
    const mod = await import(filePath)
    const jobs = mod.jobs || mod.default?.jobs || []
    return { file: filePath, namespace, jobs }
  } catch (err) {
    return { file: filePath, namespace, jobs: [], error: err.message }
  }
}

/**
 * Load all jobs from all registered files
 * @returns {Promise<JobSource[]>}
 */
export async function loadAllJobs() {
  const registry = await getRegistry()
  const results = []

  for (const entry of registry.files) {
    results.push(await loadJobsFromFile(entry.path, entry.namespace))
  }

  return results
}

/**
 * @typedef {import('./scheduler.js').Job & { _source: string, _namespace: string|null, _qualifiedId: string }} JobWithMeta
 */

/**
 * Get all jobs as a flat array with source info
 * @returns {Promise<JobWithMeta[]>}
 */
export async function getAllJobsFlat() {
  const sources = await loadAllJobs()
  const allJobs = []

  for (const source of sources) {
    if (source.error) continue
    for (const job of source.jobs) {
      allJobs.push({
        ...job,
        _source: source.file,
        _namespace: source.namespace,
        _qualifiedId: qualifyJobId(job.id, source.namespace)
      })
    }
  }

  return allJobs
}

/**
 * Get all namespaces currently in use
 * @returns {Promise<Set<string|null>>}
 */
export async function getAllNamespaces() {
  const registry = await getRegistry()
  return new Set(registry.files.map(f => f.namespace))
}

/**
 * Find a job by ID across all registered files
 * Supports both qualified (namespace/id) and unqualified (id) lookups
 * @param {string} jobId - "namespace/jobId" or just "jobId"
 * @returns {Promise<{job: JobWithMeta, source: string} | null>}
 */
export async function findJob(jobId) {
  const sources = await loadAllJobs()
  const { namespace: targetNs, jobId: targetId } = parseQualifiedId(jobId)

  for (const source of sources) {
    if (source.error) continue

    // If qualified ID, must match namespace
    if (targetNs !== null && source.namespace !== targetNs) continue

    const job = source.jobs.find(j => j.id === targetId)
    if (job) {
      return {
        job: {
          ...job,
          _source: source.file,
          _namespace: source.namespace,
          _qualifiedId: qualifyJobId(job.id, source.namespace)
        },
        source: source.file
      }
    }
  }

  return null
}

/**
 * Find all jobs by namespace
 * @param {string} namespace
 * @returns {Promise<JobWithMeta[]>}
 */
export async function findJobsByNamespace(namespace) {
  const allJobs = await getAllJobsFlat()
  return allJobs.filter(j => j._namespace === namespace)
}

export {
  REGISTRY_FILE,
  STATE_DIR
}
