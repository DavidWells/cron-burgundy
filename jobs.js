import { execSync } from 'child_process'
import { mkdirSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { tweetGen } from '../../../dotfiles/.claude/exec/agents/tweet-gen.js'

/**
 * Define all your cron jobs here.
 *
 * Each job needs:
 * - id: unique identifier
 * - schedule: cron expression (e.g., "0 9 * * *") OR interval in ms
 * - run: async function that receives { logger, utils, lastRun }
 *
 * Available utils:
 * - utils.speak(text) - Text-to-speech
 * - utils.playSound(name) - Play system sound (Ping, Pop, Frog, etc.)
 * - utils.notify(title, message) - Show notification
 *
 * The logger writes to ~/.cron-burgundy/jobs/{job-id}.log
 *
 * @type {import('./src/scheduler.js').Job[]}
 */
export const jobs = [
  // Capture window history hourly 6am-midnight
  {
    id: 'window-history',
    description: 'Captures window focus history since last run',
    schedule: '0 6-23 * * *',  // every hour on the hour, 6am-11pm
    run: async ({ logger, utils,lastRun }) => {
      utils.playSound('Funk')
      const now = new Date()
      const sinceDate = lastRun || new Date(now.getTime() - 60 * 60 * 1000) // default: 1 hour ago
      const sinceISO = sinceDate.toISOString()

      await logger.log(`Capturing history since ${sinceISO}`)

      try {
        const output = execSync(
          `${homedir()}/dotfiles/.zsh/functions/yabai-query-history.sh since ${sinceISO}`,
          { encoding: 'utf8', shell: '/bin/zsh' }
        )

        // Skip if no data rows (header + columns + separator = 3 lines)
        const lines = output.trim().split('\n')
        if (lines.length <= 3) {
          await logger.log('No items to save')
          return
        }

        // Write to /Users/david/History/YYYY-MM-DD/HH AM|PM.log
        const dateStr = now.toISOString().slice(0, 10) // YYYY-MM-DD
        const hours = now.getHours()
        const hour12 = ((hours % 12) || 12).toString().padStart(2, '0')
        const ampm = hours < 12 ? 'AM' : 'PM'
        const dir = join(homedir(), 'History', dateStr)
        const file = join(dir, `${hour12}${ampm}.log`)

        mkdirSync(dir, { recursive: true })
        writeFileSync(file, output)

        await logger.log(`Wrote ${lines.length - 3} items to ${file}`)

        // Generate tweets from history
        const tweetFile = join(dir, `${hour12}${ampm}-tweets.md`)
        await logger.log(`Generating tweets to ${tweetFile}`)
        await tweetGen({
          idea: `Read our history from the past hour and help us with some tweets\n\n${output}`,
          count: 10,
          output: tweetFile,
          openOnComplete: false
        })
      } catch (err) {
        await logger.log(`Error: ${err.message}`)
        throw err
      }
    }
  },

  // Test 3-second interval
  {
    id: 'speak-3-seconds',
    description: 'Says "3 seconds" every 3 seconds',
    enabled: false,
    interval: 3 * 1000,  // 3 seconds
    run: async ({ utils }) => {
      utils.speak('3 seconds')
    }
  },

  // Verification job - runs every minute, plays sound + notification
  {
    id: 'verify-running',
    description: 'Plays sound + notification to verify cron is running',
    enabled: false,
    interval: 60 * 1000,  // every 1 minute
    run: async ({ logger, utils }) => {
      await logger.log('Verification job running!')
      utils.notify('cron-burgundy', 'Job executed successfully!')
      // utils.playSound('Ping')
      await logger.log('Sound played and notification sent')
    }
  },

  // Speak at 2pm every day
  {
    id: 'speak-at-2pm',
    description: 'Announces the time at 2pm daily',
    schedule: 'at 02:00 pm',  // 2pm
    run: async ({ utils }) => {
      utils.speak('It is 2pm')
    }
  },

  // Example: Daily backup at 9am
  {
    id: 'daily-backup',
    description: 'Runs daily backup at 9am',
    schedule: '0 9 * * *',
    run: async ({ logger, utils }) => {
      utils.playSound('Frog')
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
    run: async ({ logger }) => {
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
    run: async ({ logger }) => {
      await logger.log('Generating weekly report...')
      // Your report logic here
      await logger.log('Report generated')
    }
  }
]
