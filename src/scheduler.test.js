/**
 * Tests for scheduler.js
 */
import { test } from 'uvu'
import * as assert from 'uvu/assert'
import { isEnabled, getIntervalMs, shouldRun, getNextRun, formatInterval, getDisplaySchedule } from './scheduler.js'

test('isEnabled: returns true by default', () => {
  assert.equal(isEnabled({ id: 'test' }), true)
  assert.equal(isEnabled({ id: 'test', enabled: undefined }), true)
})

test('isEnabled: returns false when explicitly disabled', () => {
  assert.equal(isEnabled({ id: 'test', enabled: false }), false)
})

test('isEnabled: returns true when explicitly enabled', () => {
  assert.equal(isEnabled({ id: 'test', enabled: true }), true)
})

test('getIntervalMs: returns interval directly if set', () => {
  assert.equal(getIntervalMs({ id: 'test', interval: 5000 }), 5000)
  assert.equal(getIntervalMs({ id: 'test', interval: 60000 }), 60000)
})

test('getIntervalMs: calculates from cron schedule', () => {
  // every 5 minutes = 5 * 60 * 1000 = 300000
  const fiveMinJob = { id: 'test', schedule: '*/5 * * * *' }
  assert.equal(getIntervalMs(fiveMinJob), 5 * 60 * 1000)

  // hourly = 60 * 60 * 1000 = 3600000
  const hourlyJob = { id: 'test', schedule: '0 * * * *' }
  assert.equal(getIntervalMs(hourlyJob), 60 * 60 * 1000)
})

test('getIntervalMs: throws if no schedule or interval', () => {
  assert.throws(() => getIntervalMs({ id: 'test' }), /no schedule or interval/)
})

test('shouldRun: returns true if never run', () => {
  const job = { id: 'test', interval: 60000 }
  assert.equal(shouldRun(job, null), true)
})

test('shouldRun: returns true if interval elapsed', () => {
  const job = { id: 'test', interval: 60000 } // 1 minute
  const twoMinutesAgo = new Date(Date.now() - 2 * 60000)
  assert.equal(shouldRun(job, twoMinutesAgo), true)
})

test('shouldRun: returns false if interval not elapsed', () => {
  const job = { id: 'test', interval: 60000 } // 1 minute
  const thirtySecondsAgo = new Date(Date.now() - 30000)
  assert.equal(shouldRun(job, thirtySecondsAgo), false)
})

test('getNextRun: returns now if never run for interval job', () => {
  const job = { id: 'test', interval: 60000 }
  const next = getNextRun(job, null)
  assert.ok(next instanceof Date)
  assert.ok(Math.abs(next.getTime() - Date.now()) < 1000)
})

test('getNextRun: returns lastRun + interval for interval job', () => {
  const job = { id: 'test', interval: 60000 }
  const lastRun = new Date('2024-01-01T12:00:00Z')
  const next = getNextRun(job, lastRun)
  assert.equal(next.toISOString(), '2024-01-01T12:01:00.000Z')
})

test('getNextRun: returns cron next run for schedule job', () => {
  // This will be based on current time, so just check it returns a Date
  const job = { id: 'test', schedule: '0 9 * * *' }
  const next = getNextRun(job, null)
  assert.ok(next instanceof Date)
  assert.ok(next.getTime() > Date.now())
})

test('getNextRun: returns null if no schedule or interval', () => {
  const job = { id: 'test' }
  assert.equal(getNextRun(job, null), null)
})

test('formatInterval: formats seconds', () => {
  assert.equal(formatInterval(1000), '1 second')
  assert.equal(formatInterval(5000), '5 seconds')
  assert.equal(formatInterval(30000), '30 seconds')
})

test('formatInterval: formats minutes', () => {
  assert.equal(formatInterval(60000), '1 minute')
  assert.equal(formatInterval(5 * 60000), '5 minutes')
  assert.equal(formatInterval(30 * 60000), '30 minutes')
})

test('formatInterval: formats hours', () => {
  assert.equal(formatInterval(60 * 60 * 1000), '1 hour')
  assert.equal(formatInterval(2 * 60 * 60 * 1000), '2 hours')
  assert.equal(formatInterval(12 * 60 * 60 * 1000), '12 hours')
})

test('formatInterval: formats days', () => {
  assert.equal(formatInterval(24 * 60 * 60 * 1000), '1 day')
  assert.equal(formatInterval(7 * 24 * 60 * 60 * 1000), '7 days')
})

test('getDisplaySchedule: formats interval jobs', () => {
  assert.equal(getDisplaySchedule({ id: 'test', interval: 60000 }), 'every 1 minute')
  assert.equal(getDisplaySchedule({ id: 'test', interval: 5 * 60000 }), 'every 5 minutes')
})

test('getDisplaySchedule: formats cron jobs with human description', () => {
  const result = getDisplaySchedule({ id: 'test', schedule: '0 9 * * *' })
  assert.ok(result.includes('0 9 * * *'))
  assert.ok(result.includes('9:00 AM'))
})

test('getDisplaySchedule: returns unknown for no schedule', () => {
  assert.equal(getDisplaySchedule({ id: 'test' }), 'unknown')
})

test.run()
