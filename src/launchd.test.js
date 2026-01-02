/**
 * Tests for launchd.js cron-to-plist conversion
 */
import { test } from 'uvu'
import * as assert from 'uvu/assert'
import { expandCronField, cronToCalendarInterval, generateJobPlistConfig, MIN_INTERVAL_MS } from './launchd.js'

// expandCronField tests
test('expandCronField: wildcard returns null', () => {
  assert.equal(expandCronField('*'), null)
})

test('expandCronField: single value', () => {
  assert.equal(expandCronField('5'), [5])
  assert.equal(expandCronField('0'), [0])
  assert.equal(expandCronField('23'), [23])
})

test('expandCronField: range', () => {
  assert.equal(expandCronField('6-9'), [6, 7, 8, 9])
  assert.equal(expandCronField('0-2'), [0, 1, 2])
  assert.equal(expandCronField('20-23'), [20, 21, 22, 23])
})

test('expandCronField: list', () => {
  assert.equal(expandCronField('1,3,5'), [1, 3, 5])
  assert.equal(expandCronField('0,6'), [0, 6])
})

test('expandCronField: range + list combined', () => {
  assert.equal(expandCronField('1-3,7,9'), [1, 2, 3, 7, 9])
  assert.equal(expandCronField('0,5-7,10'), [0, 5, 6, 7, 10])
})

// cronToCalendarInterval tests
test('cronToCalendarInterval: daily at 9am', () => {
  const result = cronToCalendarInterval('0 9 * * *')
  assert.equal(result, { Minute: 0, Hour: 9 })
})

test('cronToCalendarInterval: every hour', () => {
  const result = cronToCalendarInterval('0 * * * *')
  assert.equal(result, { Minute: 0 })
})

test('cronToCalendarInterval: specific minute and hour', () => {
  const result = cronToCalendarInterval('30 14 * * *')
  assert.equal(result, { Minute: 30, Hour: 14 })
})

test('cronToCalendarInterval: weekday only (Monday)', () => {
  const result = cronToCalendarInterval('0 9 * * 1')
  assert.equal(result, { Minute: 0, Hour: 9, Weekday: 1 })
})

test('cronToCalendarInterval: day of month', () => {
  const result = cronToCalendarInterval('0 9 15 * *')
  assert.equal(result, { Minute: 0, Hour: 9, Day: 15 })
})

test('cronToCalendarInterval: specific month', () => {
  const result = cronToCalendarInterval('0 9 1 6 *')
  assert.equal(result, { Minute: 0, Hour: 9, Day: 1, Month: 6 })
})

test('cronToCalendarInterval: hour range expands to array', () => {
  const result = cronToCalendarInterval('0 6-8 * * *')
  assert.ok(Array.isArray(result))
  assert.equal(result.length, 3)
  assert.equal(result[0], { Minute: 0, Hour: 6 })
  assert.equal(result[1], { Minute: 0, Hour: 7 })
  assert.equal(result[2], { Minute: 0, Hour: 8 })
})

test('cronToCalendarInterval: hour range 6am-11pm', () => {
  const result = cronToCalendarInterval('0 6-23 * * *')
  assert.ok(Array.isArray(result))
  assert.equal(result.length, 18) // 6,7,8...23 = 18 hours
  assert.equal(result[0], { Minute: 0, Hour: 6 })
  assert.equal(result[17], { Minute: 0, Hour: 23 })
})

test('cronToCalendarInterval: weekday range', () => {
  const result = cronToCalendarInterval('0 9 * * 1-5')
  assert.ok(Array.isArray(result))
  assert.equal(result.length, 5)
  assert.equal(result[0], { Minute: 0, Hour: 9, Weekday: 1 })
  assert.equal(result[4], { Minute: 0, Hour: 9, Weekday: 5 })
})

test('cronToCalendarInterval: multiple weekdays', () => {
  const result = cronToCalendarInterval('0 9 * * 0,6')
  assert.ok(Array.isArray(result))
  assert.equal(result.length, 2)
  assert.equal(result[0], { Minute: 0, Hour: 9, Weekday: 0 })
  assert.equal(result[1], { Minute: 0, Hour: 9, Weekday: 6 })
})

test('cronToCalendarInterval: invalid expression throws', () => {
  assert.throws(() => cronToCalendarInterval('0 9 * *'), /Invalid cron/)
  assert.throws(() => cronToCalendarInterval('* * *'), /Invalid cron/)
})

// generateJobPlistConfig tests
test('generateJobPlistConfig: interval job', () => {
  const job = { id: 'test-job', interval: 60000 }
  const config = generateJobPlistConfig(job, '/path/to/project')

  assert.equal(config.Label, 'com.cron-burgundy.job.test-job')
  assert.equal(config.StartInterval, 60) // seconds
  assert.ok(config.ProgramArguments.includes('run'))
  assert.ok(config.ProgramArguments.includes('--scheduled'))
  assert.ok(config.ProgramArguments.includes('test-job'))
})

test('generateJobPlistConfig: cron schedule job', () => {
  const job = { id: 'daily-job', schedule: '0 9 * * *' }
  const config = generateJobPlistConfig(job, '/path/to/project')

  assert.equal(config.Label, 'com.cron-burgundy.job.daily-job')
  assert.equal(config.StartCalendarInterval, { Minute: 0, Hour: 9 })
  assert.not.ok(config.StartInterval)
})

test('generateJobPlistConfig: human schedule converted', () => {
  const job = { id: 'human-job', schedule: 'at 9:30 am' }
  const config = generateJobPlistConfig(job, '/path/to/project')

  assert.equal(config.StartCalendarInterval, { Minute: 30, Hour: 9 })
})

test('generateJobPlistConfig: interval too short throws', () => {
  const job = { id: 'fast-job', interval: 1000 } // 1 second, below 3s minimum
  assert.throws(() => generateJobPlistConfig(job, '/path'), /at least/)
})

test('generateJobPlistConfig: includes PATH with node bin', () => {
  const job = { id: 'test', interval: 60000 }
  const config = generateJobPlistConfig(job, '/path/to/project')

  assert.ok(config.EnvironmentVariables)
  assert.ok(config.EnvironmentVariables.PATH)
  assert.ok(config.EnvironmentVariables.PATH.includes('/usr/bin'))
})

test.run()
