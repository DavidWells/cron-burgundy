/**
 * Tests for cron-parser.js
 */
import { test } from 'uvu'
import * as assert from 'uvu/assert'
import { parseCronExpression } from './cron-parser.js'

test('parseCronExpression: basic patterns', () => {
  assert.equal(parseCronExpression('every minute'), '* * * * *')
  assert.equal(parseCronExpression('every hour'), '0 * * * *')
  assert.equal(parseCronExpression('every day'), '0 0 * * *')
  assert.equal(parseCronExpression('daily'), '0 0 * * *')
  assert.equal(parseCronExpression('hourly'), '0 * * * *')
  assert.equal(parseCronExpression('yearly'), '0 0 1 1 *')
})

test('parseCronExpression: business patterns', () => {
  assert.equal(parseCronExpression('weekdays'), '0 0 * * 1-5')
  assert.equal(parseCronExpression('weekends'), '0 0 * * 0,6')
  assert.equal(parseCronExpression('business hours'), '0 9-17 * * 1-5')
})

test('parseCronExpression: interval patterns', () => {
  assert.equal(parseCronExpression('every 5 minutes'), '*/5 * * * *')
  assert.equal(parseCronExpression('every 15 minutes'), '*/15 * * * *')
  assert.equal(parseCronExpression('every 2 hours'), '0 */2 * * *')
  assert.equal(parseCronExpression('every 3 days'), '0 0 */3 * *')
  assert.equal(parseCronExpression('every 2 weeks'), '0 0 * * 0/2')
  assert.equal(parseCronExpression('every 6 months'), '0 0 1 */6 *')

  // Test singular/plural forms
  assert.equal(parseCronExpression('every 1 minute'), '*/1 * * * *')
  assert.equal(parseCronExpression('every 1 hour'), '0 */1 * * *')
  assert.equal(parseCronExpression('every 1 day'), '0 0 */1 * *')
  assert.equal(parseCronExpression('every 1 week'), '0 0 * * 0/1')
  assert.equal(parseCronExpression('every 1 month'), '0 0 1 */1 *')

  // Test plural forms
  assert.equal(parseCronExpression('every 5 minutes'), '*/5 * * * *')
  assert.equal(parseCronExpression('every 2 hours'), '0 */2 * * *')
  assert.equal(parseCronExpression('every 3 days'), '0 0 */3 * *')
  assert.equal(parseCronExpression('every 2 weeks'), '0 0 * * 0/2')
  assert.equal(parseCronExpression('every 6 months'), '0 0 1 */6 *')
})

test('parseCronExpression: simple interval patterns', () => {
  // Test singular forms
  assert.equal(parseCronExpression('1 minute'), '*/1 * * * *')
  assert.equal(parseCronExpression('1 hour'), '0 */1 * * *')
  assert.equal(parseCronExpression('1 day'), '0 0 */1 * *')
  assert.equal(parseCronExpression('1 week'), '0 0 * * 0/1')
  assert.equal(parseCronExpression('1 month'), '0 0 1 */1 *')

  // Test plural forms
  assert.equal(parseCronExpression('5 minutes'), '*/5 * * * *')
  assert.equal(parseCronExpression('2 hours'), '0 */2 * * *')
  assert.equal(parseCronExpression('3 days'), '0 0 */3 * *')
  assert.equal(parseCronExpression('2 weeks'), '0 0 * * 0/2')
  assert.equal(parseCronExpression('6 months'), '0 0 1 */6 *')
})

test('parseCronExpression: specific times', () => {
  assert.equal(parseCronExpression('at 9:30'), '30 9 * * *')
  assert.equal(parseCronExpression('at 14:15'), '15 14 * * *')
  assert.equal(parseCronExpression('at 9:30 am'), '30 9 * * *')
  assert.equal(parseCronExpression('at 9:30 pm'), '30 21 * * *')
  assert.equal(parseCronExpression('at 12:30 am'), '30 0 * * *')
  assert.equal(parseCronExpression('at 12:30 pm'), '30 12 * * *')
})

test('parseCronExpression: weekday + time patterns', () => {
  assert.equal(parseCronExpression('on monday at 9:00'), '0 9 * * 1', 'monday')
  assert.equal(parseCronExpression('on friday at 17:30'), '30 17 * * 5', 'friday')
  assert.equal(parseCronExpression('on sunday at 12:00'), '0 12 * * 0', 'sunday')
  assert.equal(parseCronExpression('on wednesday at 9:30 pm'), '30 21 * * 3', 'wednesday')
  assert.equal(parseCronExpression('on saturday,sunday at 12:00'), '0 12 * * 6,0', 'saturday,sunday')
  const mwf = parseCronExpression('on monday,wednesday,friday at 9:00')
  assert.equal(mwf, '0 9 * * 1,3,5', 'monday,wednesday,friday')
  const tth = parseCronExpression('on tuesday,thursday at 2:30 pm')
  assert.equal(tth, '30 14 * * 2,4', 'tuesday,thursday')
  const sst = parseCronExpression('on saturday,sunday at 12:00')
  assert.equal(sst, '0 12 * * 6,0', 'saturday,sunday')
})

test('parseCronExpression: ordinal dates of month', () => {
  assert.equal(parseCronExpression('on 1st of month at 00:00'), '0 0 1 * *')
  assert.equal(parseCronExpression('on 15th of month at 9:30 am'), '30 9 15 * *')
  assert.equal(parseCronExpression('on 31st of month at 2:00 pm'), '0 14 31 * *')
  assert.equal(parseCronExpression('on 2nd of month at 12:00'), '0 12 2 * *')
  assert.equal(parseCronExpression('on 3rd of month at 15:30'), '30 15 3 * *')
  assert.equal(parseCronExpression('on 4th of month at 12:00 am'), '0 0 4 * *')
})

test('parseCronExpression: case insensitive', () => {
  assert.equal(parseCronExpression('EVERY MINUTE'), '* * * * *')
  assert.equal(parseCronExpression('Weekdays'), '0 0 * * 1-5')
  assert.equal(parseCronExpression('At 9:30 PM'), '30 21 * * *')
  assert.equal(parseCronExpression('ON MONDAY AT 9:00'), '0 9 * * 1')
})

test('parseCronExpression: existing cron expressions pass through', () => {
  assert.equal(parseCronExpression('0 12 * * *'), '0 12 * * *')
  assert.equal(parseCronExpression('*/5 * * * *'), '*/5 * * * *')
  assert.equal(parseCronExpression('15 2,14 * * *'), '15 2,14 * * *')
})

test('parseCronExpression: days of week', () => {
  assert.equal(parseCronExpression('monday'), '0 0 * * 1')
  assert.equal(parseCronExpression('tuesday'), '0 0 * * 2')
  assert.equal(parseCronExpression('wednesday'), '0 0 * * 3')
  assert.equal(parseCronExpression('thursday'), '0 0 * * 4')
  assert.equal(parseCronExpression('friday'), '0 0 * * 5')
  assert.equal(parseCronExpression('saturday'), '0 0 * * 6')
  assert.equal(parseCronExpression('sunday'), '0 0 * * 0')
})

test('parseCronExpression: special patterns', () => {
  assert.equal(parseCronExpression('first day of month'), '0 0 1 * *')
  assert.equal(parseCronExpression('middle of month'), '0 0 15 * *')
  assert.equal(parseCronExpression('never'), '0 0 30 2 *')
  assert.equal(parseCronExpression('reboot'), '@reboot')
  assert.equal(parseCronExpression('startup'), '@reboot')
})

test('parseCronExpression: error handling', () => {
  assert.throws(() => parseCronExpression(''), /must be a non-empty string/)
  assert.throws(() => parseCronExpression(null), /must be a non-empty string/)
  assert.throws(() => parseCronExpression(123), /must be a non-empty string/)
  assert.throws(() => parseCronExpression('invalid pattern'), /Unrecognized cron pattern/)
  assert.throws(() => parseCronExpression('every xyz'), /Unrecognized cron pattern/)
})

test.run()
