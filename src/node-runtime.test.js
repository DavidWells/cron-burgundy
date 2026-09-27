/**
 * Tests for node-runtime.js - node install resolution and the stable node symlink
 */
import { TEST_HOME } from './test-fixtures/isolated-home.js'
import { test } from 'uvu'
import * as assert from 'uvu/assert'
import fs from 'fs'
import path from 'path'
import { resolveNvmVersion, resolveNodeRoot, updateNodeLink, NODE_LINK, NODE_BIN } from './node-runtime.js'

const NVM_DIR = path.join(TEST_HOME, 'nvm')
const versionRoot = (v) => path.join(NVM_DIR, 'versions', 'node', v)

for (const v of ['v22.11.0', 'v24.1.0', 'v24.18.0', 'v9.0.0']) {
  fs.mkdirSync(path.join(versionRoot(v), 'bin'), { recursive: true })
  fs.writeFileSync(path.join(versionRoot(v), 'bin', 'node'), '')
}
fs.mkdirSync(path.join(NVM_DIR, 'alias', 'lts'), { recursive: true })

function setAlias(name, value) {
  fs.writeFileSync(path.join(NVM_DIR, 'alias', name), `${value}\n`)
}

test('NODE_BIN lives under the stable NODE_LINK in CRON_BURGUNDY_HOME', () => {
  assert.is(NODE_LINK, path.join(TEST_HOME, 'node'))
  assert.is(NODE_BIN, path.join(TEST_HOME, 'node', 'bin', 'node'))
})

test('resolveNvmVersion: exact version', () => {
  setAlias('default', '22.11.0')
  assert.is(resolveNvmVersion(NVM_DIR), versionRoot('v22.11.0'))
  setAlias('default', 'v24.1.0')
  assert.is(resolveNvmVersion(NVM_DIR), versionRoot('v24.1.0'))
})

test('resolveNvmVersion: major/minor prefix picks highest installed match', () => {
  setAlias('default', '24')
  assert.is(resolveNvmVersion(NVM_DIR), versionRoot('v24.18.0'))
  setAlias('default', 'v24.1')
  assert.is(resolveNvmVersion(NVM_DIR), versionRoot('v24.1.0'))
})

test('resolveNvmVersion: "node" and "stable" pick highest installed (numeric, not lexical)', () => {
  setAlias('default', 'node')
  assert.is(resolveNvmVersion(NVM_DIR), versionRoot('v24.18.0'))
  setAlias('default', 'stable')
  assert.is(resolveNvmVersion(NVM_DIR), versionRoot('v24.18.0'))
})

test('resolveNvmVersion: follows alias chains (lts/*)', () => {
  fs.writeFileSync(path.join(NVM_DIR, 'alias', 'lts', '*'), 'lts/krypton\n')
  fs.writeFileSync(path.join(NVM_DIR, 'alias', 'lts', 'krypton'), 'v24.18.0\n')
  setAlias('default', 'lts/*')
  assert.is(resolveNvmVersion(NVM_DIR), versionRoot('v24.18.0'))
})

test('resolveNvmVersion: null when alias missing or version not installed', () => {
  assert.is(resolveNvmVersion(path.join(TEST_HOME, 'no-nvm')), null)
  setAlias('default', '18')
  assert.is(resolveNvmVersion(NVM_DIR), null)
})

test('resolveNodeRoot: prefers nvm default, falls back to execPath install root', () => {
  setAlias('default', '24')
  assert.is(resolveNodeRoot({ nvmDir: NVM_DIR, execPath: '/ignored/bin/node' }), versionRoot('v24.18.0'))
  const execPath = path.join(versionRoot('v22.11.0'), 'bin', 'node')
  assert.is(resolveNodeRoot({ nvmDir: path.join(TEST_HOME, 'no-nvm'), execPath }), versionRoot('v22.11.0'))
})

test('updateNodeLink: creates, keeps, and repoints the link', async () => {
  setAlias('default', '22.11.0')
  assert.equal(await updateNodeLink({ nvmDir: NVM_DIR }), { root: versionRoot('v22.11.0'), changed: true })
  assert.is(fs.readlinkSync(NODE_LINK), versionRoot('v22.11.0'))
  assert.ok(fs.existsSync(NODE_BIN))

  assert.equal(await updateNodeLink({ nvmDir: NVM_DIR }), { root: versionRoot('v22.11.0'), changed: false })

  setAlias('default', '24')
  assert.equal(await updateNodeLink({ nvmDir: NVM_DIR }), { root: versionRoot('v24.18.0'), changed: true })
  assert.is(fs.readlinkSync(NODE_LINK), versionRoot('v24.18.0'))
})

test('updateNodeLink: throws and leaves link alone when resolved root has no bin/node', async () => {
  fs.mkdirSync(versionRoot('v25.0.0'), { recursive: true })
  setAlias('default', '25')
  try {
    let threw = false
    try { await updateNodeLink({ nvmDir: NVM_DIR }) } catch (err) { threw = /no node binary/.test(err.message) }
    assert.ok(threw, 'expected "no node binary" error')
    assert.is(fs.readlinkSync(NODE_LINK), versionRoot('v24.18.0'))
  } finally {
    fs.rmSync(versionRoot('v25.0.0'), { recursive: true })
  }
})

test.run()
