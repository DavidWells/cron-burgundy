/**
 * Tests for launchd.js cron-to-plist conversion
 */
import { test } from 'uvu'
import * as assert from 'uvu/assert'
import { expandCronField, cronToCalendarInterval, generateJobPlistConfig, MIN_INTERVAL_MS, getJobLabel, parsePlistFilename } from './launchd.js'

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

test('expandCronField: step value */5 for minutes', () => {
  assert.equal(expandCronField('*/5', 0, 59), [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55])
})

test('expandCronField: step value */15 for minutes', () => {
  assert.equal(expandCronField('*/15', 0, 59), [0, 15, 30, 45])
})

test('expandCronField: step value */2 for hours', () => {
  assert.equal(expandCronField('*/2', 0, 23), [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22])
})

test('expandCronField: step value with range 1-10/2', () => {
  assert.equal(expandCronField('1-10/2', 0, 59), [1, 3, 5, 7, 9])
})

test('expandCronField: step value with range 0-30/10', () => {
  assert.equal(expandCronField('0-30/10', 0, 59), [0, 10, 20, 30])
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

test('cronToCalendarInterval: every 5 minutes (*/5)', () => {
  const result = cronToCalendarInterval('*/5 * * * *')
  assert.ok(Array.isArray(result))
  assert.equal(result.length, 12) // 0,5,10,15,20,25,30,35,40,45,50,55
  assert.equal(result[0], { Minute: 0 })
  assert.equal(result[1], { Minute: 5 })
  assert.equal(result[11], { Minute: 55 })
})

test('cronToCalendarInterval: every 2 hours (0 */2)', () => {
  const result = cronToCalendarInterval('0 */2 * * *')
  assert.ok(Array.isArray(result))
  assert.equal(result.length, 12) // 0,2,4,6,8,10,12,14,16,18,20,22
  assert.equal(result[0], { Minute: 0, Hour: 0 })
  assert.equal(result[1], { Minute: 0, Hour: 2 })
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

// getJobLabel tests
test('getJobLabel: without namespace', () => {
  assert.equal(getJobLabel('my-job'), 'com.cron-burgundy.job.my-job')
  assert.equal(getJobLabel('tick'), 'com.cron-burgundy.job.tick')
})

test('getJobLabel: with namespace', () => {
  assert.equal(getJobLabel('tick', 'pm'), 'com.cron-burgundy.job.pm.tick')
  assert.equal(getJobLabel('backup', 'app'), 'com.cron-burgundy.job.app.backup')
})

test('getJobLabel: null namespace same as no namespace', () => {
  assert.equal(getJobLabel('my-job', null), 'com.cron-burgundy.job.my-job')
})

// generateJobPlistConfig with namespace tests
test('generateJobPlistConfig: with namespace includes namespace in label', () => {
  const job = { id: 'tick', interval: 60000 }
  const config = generateJobPlistConfig(job, '/path', 'pm')
  assert.equal(config.Label, 'com.cron-burgundy.job.pm.tick')
})

test('generateJobPlistConfig: with namespace uses qualified id in args', () => {
  const job = { id: 'tick', interval: 60000 }
  const config = generateJobPlistConfig(job, '/path', 'pm')
  assert.ok(config.ProgramArguments.includes('pm/tick'))
})

// parsePlistFilename tests
test('parsePlistFilename: job without namespace', () => {
  const result = parsePlistFilename('com.cron-burgundy.job.my-job.plist')
  assert.equal(result.namespace, null)
  assert.equal(result.jobId, 'my-job')
})

test('parsePlistFilename: job with namespace', () => {
  const result = parsePlistFilename('com.cron-burgundy.job.pm.tick.plist')
  assert.equal(result.namespace, 'pm')
  assert.equal(result.jobId, 'tick')
})

test('parsePlistFilename: returns null for non-job plists', () => {
  assert.equal(parsePlistFilename('com.cron-burgundy.wakecheck.plist'), null)
  assert.equal(parsePlistFilename('com.other.app.plist'), null)
})

test('parsePlistFilename: returns null for invalid format', () => {
  assert.equal(parsePlistFilename('not-a-plist'), null)
  assert.equal(parsePlistFilename('com.cron-burgundy.job.plist'), null)
})

test('parsePlistFilename: job id with hyphens (no namespace)', () => {
  const result = parsePlistFilename('com.cron-burgundy.job.my-long-job.plist')
  assert.equal(result.namespace, null)
  assert.equal(result.jobId, 'my-long-job')
})

// validateJobId tests (via generateJobPlistConfig)
test('generateJobPlistConfig: rejects job ID with dots', () => {
  const job = { id: 'my.job.name', interval: 60000 }
  assert.throws(() => generateJobPlistConfig(job, '/path'), /cannot contain dots/)
})

test('generateJobPlistConfig: rejects job ID with slashes', () => {
  const job = { id: 'my/job', interval: 60000 }
  assert.throws(() => generateJobPlistConfig(job, '/path'), /invalid character/)
})

test('generateJobPlistConfig: rejects job ID with backslashes', () => {
  const job = { id: 'my\\job', interval: 60000 }
  assert.throws(() => generateJobPlistConfig(job, '/path'), /invalid character/)
})

test('generateJobPlistConfig: rejects job ID with path traversal', () => {
  const job = { id: '..', interval: 60000 }
  assert.throws(() => generateJobPlistConfig(job, '/path'), /cannot contain dots/)
})

test('generateJobPlistConfig: rejects job ID with spaces', () => {
  const job = { id: 'my job', interval: 60000 }
  assert.throws(() => generateJobPlistConfig(job, '/path'), /invalid character/)
})

test('generateJobPlistConfig: rejects job ID with special characters', () => {
  const job = { id: 'my:job', interval: 60000 }
  assert.throws(() => generateJobPlistConfig(job, '/path'), /invalid character/)
})

test('generateJobPlistConfig: rejects job ID starting with hyphen', () => {
  const job = { id: '-myjob', interval: 60000 }
  assert.throws(() => generateJobPlistConfig(job, '/path'), /must start with/)
})

test('generateJobPlistConfig: rejects empty job ID', () => {
  const job = { id: '', interval: 60000 }
  assert.throws(() => generateJobPlistConfig(job, '/path'), /non-empty string/)
})

test('generateJobPlistConfig: rejects job ID over 100 characters', () => {
  const job = { id: 'a'.repeat(101), interval: 60000 }
  assert.throws(() => generateJobPlistConfig(job, '/path'), /too long/)
})

test('generateJobPlistConfig: accepts valid job ID with underscores', () => {
  const job = { id: 'my_job_name', interval: 60000 }
  const config = generateJobPlistConfig(job, '/path')
  assert.equal(config.Label, 'com.cron-burgundy.job.my_job_name')
})

test('generateJobPlistConfig: accepts valid job ID with hyphens', () => {
  const job = { id: 'my-job-name', interval: 60000 }
  const config = generateJobPlistConfig(job, '/path')
  assert.equal(config.Label, 'com.cron-burgundy.job.my-job-name')
})

test('generateJobPlistConfig: accepts valid job ID starting with number', () => {
  const job = { id: '123job', interval: 60000 }
  const config = generateJobPlistConfig(job, '/path')
  assert.equal(config.Label, 'com.cron-burgundy.job.123job')
})

test.run()
