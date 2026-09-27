/**
 * Tests for cron-parser.cjs
 */
import { test } from 'uvu'
import * as assert from 'uvu/assert'
import { normalizeSchedule, isValidSchedule } from './cron-parser.cjs'

test('normalizeSchedule: basic patterns', () => {
  assert.equal(normalizeSchedule('every minute'), '* * * * *')
  assert.equal(normalizeSchedule('every hour'), '0 * * * *')
  assert.equal(normalizeSchedule('every day'), '0 0 * * *')
  assert.equal(normalizeSchedule('daily'), '0 0 * * *')
  assert.equal(normalizeSchedule('hourly'), '0 * * * *')
  assert.equal(normalizeSchedule('yearly'), '0 0 1 1 *')
})

test('normalizeSchedule: business patterns', () => {
  assert.equal(normalizeSchedule('weekdays'), '0 0 * * 1-5')
  assert.equal(normalizeSchedule('weekends'), '0 0 * * 0,6')
  assert.equal(normalizeSchedule('business hours'), '0 9-17 * * 1-5')
})

test('normalizeSchedule: interval patterns', () => {
  assert.equal(normalizeSchedule('every 5 minutes'), '*/5 * * * *')
  assert.equal(normalizeSchedule('every 15 minutes'), '*/15 * * * *')
  assert.equal(normalizeSchedule('every 2 hours'), '0 */2 * * *')
  assert.equal(normalizeSchedule('every 3 days'), '0 0 */3 * *')
  assert.equal(normalizeSchedule('every 2 weeks'), '0 0 * * 0/2')
  assert.equal(normalizeSchedule('every 6 months'), '0 0 1 */6 *')

  // Test singular/plural forms
  assert.equal(normalizeSchedule('every 1 minute'), '* * * * *')
  assert.equal(normalizeSchedule('every 1 hour'), '0 * * * *')
  assert.equal(normalizeSchedule('every 1 day'), '0 0 * * *')
  assert.equal(normalizeSchedule('every 1 week'), '0 0 * * 0/1')
  assert.equal(normalizeSchedule('every 1 month'), '0 0 1 * *')

  // Test plural forms
  assert.equal(normalizeSchedule('every 5 minutes'), '*/5 * * * *')
  assert.equal(normalizeSchedule('every 2 hours'), '0 */2 * * *')
  assert.equal(normalizeSchedule('every 3 days'), '0 0 */3 * *')
  assert.equal(normalizeSchedule('every 2 weeks'), '0 0 * * 0/2')
  assert.equal(normalizeSchedule('every 6 months'), '0 0 1 */6 *')
})

test('normalizeSchedule: simple interval patterns', () => {
  // Test singular forms
  assert.equal(normalizeSchedule('1 minute'), '* * * * *')
  assert.equal(normalizeSchedule('1 hour'), '0 * * * *')
  assert.equal(normalizeSchedule('1 day'), '0 0 * * *')
  assert.equal(normalizeSchedule('1 week'), '0 0 * * 0/1')
  assert.equal(normalizeSchedule('1 month'), '0 0 1 * *')

  // Test plural forms
  assert.equal(normalizeSchedule('5 minutes'), '*/5 * * * *')
  assert.equal(normalizeSchedule('2 hours'), '0 */2 * * *')
  assert.equal(normalizeSchedule('3 days'), '0 0 */3 * *')
  assert.equal(normalizeSchedule('2 weeks'), '0 0 * * 0/2')
  assert.equal(normalizeSchedule('6 months'), '0 0 1 */6 *')
})

test('normalizeSchedule: specific times', () => {
  assert.equal(normalizeSchedule('at 9:30'), '30 9 * * *')
  assert.equal(normalizeSchedule('at 14:15'), '15 14 * * *')
  assert.equal(normalizeSchedule('at 9:30 am'), '30 9 * * *')
  assert.equal(normalizeSchedule('at 9:30 pm'), '30 21 * * *')
  assert.equal(normalizeSchedule('at 12:30 am'), '30 0 * * *')
  assert.equal(normalizeSchedule('at 12:30 pm'), '30 12 * * *')
})

test('normalizeSchedule: weekday + time patterns', () => {
  assert.equal(normalizeSchedule('on monday at 9:00'), '0 9 * * 1', 'monday')
  assert.equal(normalizeSchedule('on friday at 17:30'), '30 17 * * 5', 'friday')
  assert.equal(normalizeSchedule('on sunday at 12:00'), '0 12 * * 0', 'sunday')
  assert.equal(normalizeSchedule('on wednesday at 9:30 pm'), '30 21 * * 3', 'wednesday')
  assert.equal(normalizeSchedule('on saturday,sunday at 12:00'), '0 12 * * 6,0', 'saturday,sunday')
  const mwf = normalizeSchedule('on monday,wednesday,friday at 9:00')
  assert.equal(mwf, '0 9 * * 1,3,5', 'monday,wednesday,friday')
  const tth = normalizeSchedule('on tuesday,thursday at 2:30 pm')
  assert.equal(tth, '30 14 * * 2,4', 'tuesday,thursday')
  const sst = normalizeSchedule('on saturday,sunday at 12:00')
  assert.equal(sst, '0 12 * * 6,0', 'saturday,sunday')
})

test('normalizeSchedule: ordinal dates of month', () => {
  assert.equal(normalizeSchedule('on 1st of month at 00:00'), '0 0 1 * *')
  assert.equal(normalizeSchedule('on 15th of month at 9:30 am'), '30 9 15 * *')
  assert.equal(normalizeSchedule('on 31st of month at 2:00 pm'), '0 14 31 * *')
  assert.equal(normalizeSchedule('on 2nd of month at 12:00'), '0 12 2 * *')
  assert.equal(normalizeSchedule('on 3rd of month at 15:30'), '30 15 3 * *')
  assert.equal(normalizeSchedule('on 4th of month at 12:00 am'), '0 0 4 * *')
})

test('normalizeSchedule: case insensitive', () => {
  assert.equal(normalizeSchedule('EVERY MINUTE'), '* * * * *')
  assert.equal(normalizeSchedule('Weekdays'), '0 0 * * 1-5')
  assert.equal(normalizeSchedule('At 9:30 PM'), '30 21 * * *')
  assert.equal(normalizeSchedule('ON MONDAY AT 9:00'), '0 9 * * 1')
})

test('normalizeSchedule: existing cron expressions pass through', () => {
  assert.equal(normalizeSchedule('0 12 * * *'), '0 12 * * *')
  assert.equal(normalizeSchedule('*/5 * * * *'), '*/5 * * * *')
  assert.equal(normalizeSchedule('15 2,14 * * *'), '15 2,14 * * *')
})

test('normalizeSchedule: days of week', () => {
  assert.equal(normalizeSchedule('monday'), '0 0 * * 1')
  assert.equal(normalizeSchedule('tuesday'), '0 0 * * 2')
  assert.equal(normalizeSchedule('wednesday'), '0 0 * * 3')
  assert.equal(normalizeSchedule('thursday'), '0 0 * * 4')
  assert.equal(normalizeSchedule('friday'), '0 0 * * 5')
  assert.equal(normalizeSchedule('saturday'), '0 0 * * 6')
  assert.equal(normalizeSchedule('sunday'), '0 0 * * 0')
})

test('normalizeSchedule: special patterns', () => {
  assert.equal(normalizeSchedule('first day of month'), '0 0 1 * *')
  assert.equal(normalizeSchedule('middle of month'), '0 0 15 * *')
  assert.equal(normalizeSchedule('never'), '0 0 30 2 *')
})

test('normalizeSchedule: human-cron phrases', () => {
  assert.equal(normalizeSchedule('every five minutes'), '*/5 * * * *')
  assert.equal(normalizeSchedule('15m'), '*/15 * * * *')
  assert.equal(normalizeSchedule('every other hour'), '0 */2 * * *')
  assert.equal(normalizeSchedule('every 60 minutes'), '0 * * * *')
  assert.equal(normalizeSchedule('9am'), '0 9 * * *')
  assert.equal(normalizeSchedule('at noon'), '0 12 * * *')
  assert.equal(normalizeSchedule('daily at 9am'), '0 9 * * *')
  assert.equal(normalizeSchedule('weekdays at 9:30'), '30 9 * * 1-5')
  assert.equal(normalizeSchedule('fridays at 5pm'), '0 17 * * 5')
  assert.equal(normalizeSchedule('mon-fri'), '0 0 * * 1-5')
  assert.equal(normalizeSchedule('monday and friday at 9'), '0 9 * * 1,5')
  assert.equal(normalizeSchedule('hourly at 30'), '30 * * * *')
  assert.equal(normalizeSchedule('twice a day'), '0 0,12 * * *')
  assert.equal(normalizeSchedule('on the 1st and 15th'), '0 0 1,15 * *')
})

test('normalizeSchedule: rejects schedules launchd cannot express', () => {
  assert.throws(() => normalizeSchedule('reboot'), /not supported by launchd/)
  assert.throws(() => normalizeSchedule('last day of month'), /not supported by launchd/)
  assert.throws(() => normalizeSchedule('0 12 * * ? *'), /not supported by launchd/)
  assert.throws(() => normalizeSchedule('0 9 * * MON-FRI'), /not supported by launchd/)
  assert.throws(() => normalizeSchedule('0 0 15W * *'), /not supported by launchd/)
})

test('normalizeSchedule: rejects intervals no single cron can express', () => {
  assert.throws(() => normalizeSchedule('every 90 minutes'), /can't be expressed/)
})

test('isValidSchedule: true for launchd-compatible schedules', () => {
  assert.is(isValidSchedule('every 5 minutes'), true)
  assert.is(isValidSchedule('weekdays at 9:30'), true)
  assert.is(isValidSchedule('0 9 * * *'), true)
  assert.is(isValidSchedule('0-30/5 * * * *'), true)
})

test('isValidSchedule: false for invalid or launchd-incompatible schedules', () => {
  assert.is(isValidSchedule(''), false)
  assert.is(isValidSchedule(null), false)
  assert.is(isValidSchedule(123), false)
  assert.is(isValidSchedule('tomorrow'), false)
  assert.is(isValidSchedule('every 90 minutes'), false)
  assert.is(isValidSchedule('reboot'), false)
  assert.is(isValidSchedule('last day of month'), false)
})

test('normalizeSchedule: error handling', () => {
  assert.throws(() => normalizeSchedule(''), /must be a non-empty string/)
  assert.throws(() => normalizeSchedule(null), /must be a non-empty string/)
  assert.throws(() => normalizeSchedule(123), /must be a non-empty string/)
  assert.throws(() => normalizeSchedule('invalid pattern'), /Unrecognized cron pattern/)
  assert.throws(() => normalizeSchedule('every xyz'), /Unrecognized cron pattern/)
})

test.run()
