/**
 * Normalize job schedules (human-readable phrases or raw cron) into cron expressions launchd can run.
 * Phrase parsing is delegated to @davidwells/human-cron.
 */
import humanCron from '@davidwells/human-cron'

// launchd StartCalendarInterval only takes numeric fields: no @macros, names, or Quartz ?/L/W/# specials
const LAUNCHD_FIELD = /^[\d*,\-/]+$/

/**
 * Normalize a schedule - convert human readable to cron if needed
 * @param {string} schedule - e.g. "every 5 minutes", "weekdays at 9:30", "0 9 * * *"
 * @returns {string} Standard 5-field cron expression
 * @throws if the schedule is unrecognized or can't be expressed as a launchd calendar interval
 */
export function normalizeSchedule(schedule) {
  const cron = humanCron.parseCron(schedule)
  const parts = cron.split(/\s+/)
  if (parts.length !== 5 || !parts.every(part => LAUNCHD_FIELD.test(part))) {
    throw new Error(`Schedule "${schedule}" (cron "${cron}") is not supported by launchd. Use a 5-field numeric cron expression`)
  }
  return cron
}

/**
 * Check if a schedule can be normalized into a launchd-compatible cron expression
 * @param {unknown} schedule
 * @returns {boolean}
 */
export function isValidSchedule(schedule) {
  try {
    normalizeSchedule(/** @type {string} */ (schedule))
    return true
  } catch {
    return false
  }
}
