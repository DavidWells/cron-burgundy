/**
 * Picks the node install launchd jobs run on and keeps a stable symlink (NODE_LINK) pointing at it.
 * Plists reference NODE_BIN through the link, so switching node versions only repoints the link.
 */
import fs from 'fs'
import path from 'path'
import os from 'os'
import { CRON_BURGUNDY_DIR } from './paths.js'

/** Symlink to the chosen node install root (the dir containing bin/node) */
export const NODE_LINK = path.join(CRON_BURGUNDY_DIR, 'node')
export const NODE_BIN = path.join(NODE_LINK, 'bin', 'node')

const DEFAULT_NVM_DIR = process.env.NVM_DIR || path.join(os.homedir(), '.nvm')
const MAX_ALIAS_HOPS = 10

/**
 * Compare "vX.Y.Z" strings numerically, highest first
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function compareVersionsDesc(a, b) {
  const pa = a.slice(1).split('.').map(Number)
  const pb = b.slice(1).split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pb[i] - pa[i]
  }
  return 0
}

/**
 * Resolve an nvm alias (default: "default") to an installed version's root dir.
 * Supports exact versions, major/minor prefixes ("24", "v24.1"), "node"/"stable", and alias chains ("lts/*").
 * Reads nvm's files directly so the result is the same from an interactive shell and from launchd.
 * @param {string} [nvmDir]
 * @param {string} [alias]
 * @returns {string|null} version root dir, or null if the alias or a matching install is missing
 */
export function resolveNvmVersion(nvmDir = DEFAULT_NVM_DIR, alias = 'default') {
  const aliasDir = path.join(nvmDir, 'alias')
  let value = alias
  for (let hops = 0; hops < MAX_ALIAS_HOPS; hops++) {
    const aliasFile = path.join(aliasDir, value)
    if (!fs.existsSync(aliasFile) || !fs.statSync(aliasFile).isFile()) break
    value = fs.readFileSync(aliasFile, 'utf8').trim()
  }
  if (value === alias) return null

  const versionsDir = path.join(nvmDir, 'versions', 'node')
  let installed
  try {
    installed = fs.readdirSync(versionsDir).filter(v => /^v\d+\.\d+\.\d+$/.test(v)).sort(compareVersionsDesc)
  } catch {
    return null
  }

  const wanted = value.replace(/^v/, '')
  const match = (value === 'node' || value === 'stable')
    ? installed[0]
    : installed.find(v => v === `v${wanted}` || v.startsWith(`v${wanted}.`))
  return match ? path.join(versionsDir, match) : null
}

/**
 * Pick the node install root for launchd jobs: the nvm default alias, else the install running this process
 * @param {{ nvmDir?: string, execPath?: string }} [options]
 * @returns {string}
 */
export function resolveNodeRoot({ nvmDir = DEFAULT_NVM_DIR, execPath = process.execPath } = {}) {
  const nvmRoot = resolveNvmVersion(nvmDir)
  if (nvmRoot) return nvmRoot
  let realExec = execPath
  try {
    realExec = fs.realpathSync(execPath)
  } catch {}
  return path.dirname(path.dirname(realExec))
}

/**
 * Point NODE_LINK at the resolved node install root (atomic swap). No-op when already correct.
 * @param {{ nvmDir?: string, execPath?: string }} [options]
 * @returns {Promise<{ root: string, changed: boolean }>}
 * @throws if the resolved root has no bin/node
 */
export async function updateNodeLink(options = {}) {
  const root = resolveNodeRoot(options)
  if (!fs.existsSync(path.join(root, 'bin', 'node'))) {
    throw new Error(`Resolved node install "${root}" has no node binary at bin/node`)
  }

  let current = null
  try {
    current = await fs.promises.readlink(NODE_LINK)
  } catch {}
  if (current === root) return { root, changed: false }

  await fs.promises.mkdir(path.dirname(NODE_LINK), { recursive: true })
  const tmpLink = `${NODE_LINK}.${process.pid}.${Date.now()}.tmp`
  await fs.promises.symlink(root, tmpLink)
  await fs.promises.rename(tmpLink, NODE_LINK)
  return { root, changed: true }
}
