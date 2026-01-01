import { execSync } from 'child_process'

const sounds = [
  'Ping',
  'Pop',
  'Blow',
  'Glass',
  'Frog',
  'Submarine',
  'Purr',
  'Funk',
  'Morse',
  'Sosumi',
  'Basso',
  'Blow',
  'Bottle',
  'Frog',
]

/**
 * Play a macOS system sound
 * @param {string} sound - Sound name (Ping, Pop, Blow, Glass, etc.)
 */
function playSound(sound = 'Ping') {
  const isSystemSound = sounds.includes(sound)
  if (isSystemSound) {
    try {
      execSync(`afplay /System/Library/Sounds/${sound}.aiff`)
    } catch (err) {
      console.log('Could not play sound:', err.message)
    }
  } else {
    try {
      execSync(`say "${sound}"`)
    } catch (err) {
      console.log('Could not speak:', err.message)
    }
  }
}

function speak(text = 'Hello, world!') {
  try {
    execSync(`say "${text}"`)
  } catch (err) {
    console.log('Could not speak:', err.message)
  }
}

/**
 * Show a macOS notification
 * @param {string} title
 * @param {string} message
 */
function notify(title, message) {
  try {
    execSync(`osascript -e 'display notification "${message}" with title "${title}"'`)
  } catch (err) {
    console.log('Could not show notification:', err.message)
  }
}

/**
 * Define all your cron jobs here.
 * 
 * Each job needs:
 * - id: unique identifier
 * - schedule: cron expression (e.g., "0 9 * * *") OR interval in ms
 * - run: async function that receives a logger
 * 
 * The logger writes to ~/.cron-burgundy/jobs/{job-id}.log
 * 
 * @type {import('./src/scheduler.js').Job[]}
 */
export const jobs = [
  // Verification job - runs every minute, plays sound + notification
  {
    id: 'verify-running',
    description: 'Plays sound + notification to verify cron is running',
    enabled: false,
    interval: 60 * 1000,  // every 1 minute
    run: async (logger) => {
      await logger.log('Verification job running!')
      notify('cron-burgundy', 'Job executed successfully!')
      playSound('Ping')
      await logger.log('Sound played and notification sent')
    }
  },

  // Speak at 1pm every day
  {
    id: 'speak-at-2pm',
    description: 'Announces the time at 2pm daily',
    schedule: 'at 02:00 pm',  // 2pm
    run: async (logger) => {
      speak('It is 2pm')
    }
  },

  // Example: Daily backup at 9am
  {
    id: 'daily-backup',
    description: 'Runs daily backup at 9am',
    schedule: '0 9 * * *',
    run: async (logger) => {
      playSound('Frog')
      await logger.log('Starting daily backup...')
      // Your backup logic here
      await logger.log('Backup complete')
    }
  },
  
  // Example: Hourly sync using interval
  {
    id: 'hourly-sync',
    description: 'Syncs data every hour',
    interval: 60 * 60 * 1000,  // 1 hour in ms
    run: async (logger) => {
      await logger.log('Starting hourly sync...')
      // Your sync logic here
      await logger.log('Sync complete')
    }
  },
  
  // Example: Weekly report on Sundays at 8am (DISABLED)
  {
    id: 'weekly-report',
    description: 'Generates weekly report on Sundays',
    enabled: false,
    schedule: '0 8 * * 0',
    run: async (logger) => {
      await logger.log('Generating weekly report...')
      // Your report logic here
      await logger.log('Report generated')
    }
  }
]
