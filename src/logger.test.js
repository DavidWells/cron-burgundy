/**
 * Tests for logger.js pure functions
 */
import { test } from 'uvu'
import * as assert from 'uvu/assert'
import { humanTime, colorizeLine } from './logger.js'

// humanTime tests
test('humanTime: formats date correctly', () => {
  const date = new Date('2026-01-20T14:30:00')
  const result = humanTime(date)
  assert.ok(result.includes('2:30pm'), `expected 2:30pm in "${result}"`)
  assert.ok(result.includes('Jan'), `expected Jan in "${result}"`)
  assert.ok(result.includes('20'), `expected 20 in "${result}"`)
  assert.ok(result.includes('2026'), `expected 2026 in "${result}"`)
})

test('humanTime: handles midnight correctly', () => {
  const date = new Date('2026-01-20T00:15:00')
  const result = humanTime(date)
  assert.ok(result.includes('12:15am'), `expected 12:15am in "${result}"`)
})

test('humanTime: handles noon correctly', () => {
  const date = new Date('2026-01-20T12:00:00')
  const result = humanTime(date)
  assert.ok(result.includes('12:00pm'), `expected 12:00pm in "${result}"`)
})

test('humanTime: includes seconds when requested', () => {
  const date = new Date('2026-01-20T14:30:45')
  const result = humanTime(date, { seconds: true })
  assert.ok(result.includes('2:30:45pm'), `expected 2:30:45pm in "${result}"`)
})

test('humanTime: excludes seconds by default', () => {
  const date = new Date('2026-01-20T14:30:45')
  const result = humanTime(date)
  assert.not.ok(result.includes(':45'), `should not include :45 in "${result}"`)
})

// colorizeLine tests
test('colorizeLine: colorizes job log lines', () => {
  const line = '[2026-01-20T14:30:00.000Z][my-job] Starting execution'
  const result = colorizeLine(line)
  // Should contain ANSI escape codes
  assert.ok(result.includes('\x1b['), 'should contain ANSI codes')
  assert.ok(result.includes('my-job'), 'should contain job id')
  assert.ok(result.includes('Starting execution'), 'should contain message')
})

test('colorizeLine: dims separator lines', () => {
  const line = '[2026-01-20T14:30:00.000Z] ────────────────────────────────────────'
  const result = colorizeLine(line)
  assert.ok(result.includes('\x1b[2m'), 'should contain dim code')
})

test('colorizeLine: passes through unrecognized lines unchanged', () => {
  const line = 'just some random text'
  const result = colorizeLine(line)
  assert.equal(result, line)
})

test('colorizeLine: same job gets same color', () => {
  const line1 = '[2026-01-20T14:30:00.000Z][my-job] First message'
  const line2 = '[2026-01-20T14:31:00.000Z][my-job] Second message'
  const result1 = colorizeLine(line1)
  const result2 = colorizeLine(line2)
  // Extract the color code (38;5;XXX)
  const colorMatch1 = result1.match(/\x1b\[38;5;(\d+)m/)
  const colorMatch2 = result2.match(/\x1b\[38;5;(\d+)m/)
  assert.ok(colorMatch1, 'first line should have color')
  assert.ok(colorMatch2, 'second line should have color')
  assert.equal(colorMatch1[1], colorMatch2[1], 'same job should get same color')
})

test('colorizeLine: different jobs get (likely) different colors', () => {
  const line1 = '[2026-01-20T14:30:00.000Z][job-alpha] Message'
  const line2 = '[2026-01-20T14:30:00.000Z][job-beta] Message'
  const result1 = colorizeLine(line1)
  const result2 = colorizeLine(line2)
  const colorMatch1 = result1.match(/\x1b\[38;5;(\d+)m/)
  const colorMatch2 = result2.match(/\x1b\[38;5;(\d+)m/)
  assert.ok(colorMatch1, 'first line should have color')
  assert.ok(colorMatch2, 'second line should have color')
  // Colors might collide due to hash, but these specific strings shouldn't
  assert.not.equal(colorMatch1[1], colorMatch2[1], 'different jobs should get different colors')
})

test.run()
