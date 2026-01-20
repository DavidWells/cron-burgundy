/**
 * Tests for CLI commands
 * Uses subprocess spawning to test actual CLI behavior
 */
import { test } from 'uvu'
import * as assert from 'uvu/assert'
import { spawn, execSync } from 'child_process'
import path from 'path'
import fs from 'fs/promises'
import os from 'os'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CLI_PATH = path.join(__dirname, 'cli.js')
const STATE_DIR = path.join(os.homedir(), '.cron-burgundy')
const REGISTRY_FILE = path.join(STATE_DIR, 'registry.json')

/**
 * Run CLI command and return output
 * @param {string[]} args
 * @returns {Promise<{stdout: string, stderr: string, code: number}>}
 */
function runCli(args, options = {}) {
  return new Promise((resolve) => {
    const proc = spawn('node', [CLI_PATH, ...args], {
      cwd: options.cwd || __dirname,
      env: { ...process.env, ...options.env }
    })

    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (data) => { stdout += data.toString() })
    proc.stderr.on('data', (data) => { stderr += data.toString() })

    proc.on('close', (code) => {
      resolve({ stdout, stderr, code: code || 0 })
    })

    // Handle timeout
    const timeout = setTimeout(() => {
      proc.kill()
      resolve({ stdout, stderr, code: -1 })
    }, options.timeout || 10000)

    proc.on('close', () => clearTimeout(timeout))
  })
}

// ========================
// Help and version tests
// ========================

test('cli --version: shows version', async () => {
  const { stdout, code } = await runCli(['--version'])
  assert.equal(code, 0)
  assert.ok(stdout.includes('1.0.0'), 'should show version')
})

test('cli --help: shows help text', async () => {
  const { stdout, code } = await runCli(['--help'])
  assert.equal(code, 0)
  assert.ok(stdout.includes('cron-burgundy'), 'should mention app name')
  assert.ok(stdout.includes('list'), 'should mention list command')
  assert.ok(stdout.includes('run'), 'should mention run command')
  assert.ok(stdout.includes('sync'), 'should mention sync command')
})

test('cli list --help: shows list help', async () => {
  const { stdout, code } = await runCli(['list', '--help'])
  assert.equal(code, 0)
  assert.ok(stdout.includes('List all registered jobs'), 'should show list description')
  assert.ok(stdout.includes('--namespace'), 'should show namespace option')
})

test('cli run --help: shows run help', async () => {
  const { stdout, code } = await runCli(['run', '--help'])
  assert.equal(code, 0)
  assert.ok(stdout.includes('Run a job manually'), 'should show run description')
})

test('cli logs --help: shows logs help', async () => {
  const { stdout, code } = await runCli(['logs', '--help'])
  assert.equal(code, 0)
  assert.ok(stdout.includes('View, list, or clear logs'), 'should show logs description')
})

test('cli pause --help: shows pause help', async () => {
  const { stdout, code } = await runCli(['pause', '--help'])
  assert.equal(code, 0)
  assert.ok(stdout.includes('Pause a job'), 'should show pause description')
})

test('cli unpause --help: shows unpause help', async () => {
  const { stdout, code } = await runCli(['unpause', '--help'])
  assert.equal(code, 0)
  assert.ok(stdout.includes('Unpause'), 'should show unpause description')
})

test('cli sync --help: shows sync help', async () => {
  const { stdout, code } = await runCli(['sync', '--help'])
  assert.equal(code, 0)
  assert.ok(stdout.includes('Register and sync'), 'should show sync description')
})

test('cli clear --help: shows clear help', async () => {
  const { stdout, code } = await runCli(['clear', '--help'])
  assert.equal(code, 0)
  assert.ok(stdout.includes('Unregister job files'), 'should show clear description')
})

test('cli status --help: shows status help', async () => {
  const { stdout, code } = await runCli(['status', '--help'])
  assert.equal(code, 0)
  assert.ok(stdout.includes('Check installed launchd plists'), 'should show status description')
})

// ========================
// List command tests
// ========================

test('cli list: runs without error when no jobs registered', async () => {
  const { stdout, code } = await runCli(['list'])
  // May show "No job files registered" or existing jobs
  assert.equal(code, 0)
  assert.ok(stdout.includes('Registered Jobs') || stdout.includes('No job files'), 'should show output')
})

// ========================
// Status command tests
// ========================

test('cli status: shows installed plists or message', async () => {
  const { stdout, code } = await runCli(['status'])
  assert.equal(code, 0)
  // Will show either installed plists or "No cron-burgundy plists"
  assert.ok(
    stdout.includes('Installed Plists') || stdout.includes('No cron-burgundy plists'),
    'should show status output'
  )
})

// ========================
// Logs command tests
// ========================

test('cli logs list: lists log files', async () => {
  const { stdout, code } = await runCli(['logs', 'list'])
  assert.equal(code, 0)
  assert.ok(stdout.includes('Log Files'), 'should show log files header')
  assert.ok(stdout.includes('Runner log'), 'should mention runner log')
})

// ========================
// Run command tests (error cases)
// ========================

test('cli run [invalid-job]: shows error for non-existent job', async () => {
  const { stderr, code } = await runCli(['run', 'nonexistent-job-12345'])
  assert.equal(code, 1)
  assert.ok(stderr.includes('not found'), 'should show error for missing job')
})

// ========================
// Unknown command test
// ========================

test('cli [unknown]: shows error for unknown command', async () => {
  const { stderr, code } = await runCli(['unknowncommand'])
  // Commander shows error for unknown commands
  assert.ok(code !== 0 || stderr.includes('unknown'), 'should handle unknown command')
})

test.run()
