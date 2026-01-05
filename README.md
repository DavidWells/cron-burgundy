# cron-burgundy

Simple macOS cron manager with missed job recovery. Uses launchd for scheduling, catches up on missed jobs when your Mac wakes up.

## How It Works

1. Each job gets its own **launchd plist** with its schedule
2. **sleepwatcher** detects wake from sleep and runs missed jobs
3. No daemon, no background process - jobs fire on their own schedules

If your Mac was asleep when a job should have run, it fires on wake.

## Quick Start

```bash
# 1. Install sleepwatcher for wake detection
brew install sleepwatcher

# 2. Create ~/.wakeup script
cat > ~/.wakeup << 'EOF'
#!/bin/bash
cd /path/to/cron-burgundy && node bin/cli.js check-missed
EOF
chmod +x ~/.wakeup

# 3. Start sleepwatcher
brew services start sleepwatcher
# Note: sleepwatcher may request "Input Monitoring" permission - this is NOT
# required for ~/.wakeup to work. You can safely deny it.

# 4. Define your jobs in jobs.js

# 5. Sync to launchd
node bin/cli.js sync

# Done! Jobs run automatically
```

### Focus Mode

If using `utils.notify()` and macOS Focus Mode is enabled, add **Script Editor** to allowed apps:

System Settings → Focus → [Your Focus] → Allowed Apps → Add → Script Editor

(`playSound()` and `speak()` work regardless of Focus Mode)

## CLI Commands

Available as `cron-burgundy` or `cronb`:

```
Usage: cronb [options] [command]

Commands:
  list                   List all registered jobs with status
  run [options] [jobId]  Run a job manually (autocomplete if no arg)
  logs                   View, list, or clear logs
  pause [name]           Pause a job or all jobs (interactive if no arg)
  unpause [name]         Unpause a job or all jobs (interactive if no arg)
  sync [path]            Register and sync a job file, or sync all registered files
  clear [target]         Unregister job files and remove from launchd (interactive if no arg)
  status                 Check installed launchd plists
  check-missed           Check and run any missed jobs (called on wake)

Options:
  -V, --version          output the version number
  -h, --help             display help for command
```

### Logs subcommands

```bash
cronb logs                      # View runner log
cronb logs view <jobId>         # View specific job log
cronb logs view -t              # Tail runner log (follow)
cronb logs view <jobId> -t      # Tail job log
cronb logs list                 # List all log file paths
cronb logs clear                # Clear runner log
cronb logs clear <jobId>        # Clear specific job log
cronb logs clear all            # Clear runner + all job logs
```

## Defining Jobs

Edit `jobs.js` in project root:

```javascript
export const jobs = [
  {
    id: 'my-job',
    schedule: 'every 5 minutes',  // Human-readable or cron syntax
    enabled: true,                 // Optional, default: true
    run: async ({ logger, utils, lastRun }) => {
      logger.log('Starting...')
      // Your job logic here
      utils.notify('Job done', 'Completed successfully')
      logger.log('Done!')
    }
  }
]
```

### Available Utils

Jobs receive a `utils` object with macOS helpers:

```javascript
utils.notify(title, message, { sound: true })  // macOS notification
utils.speak('Hello world')                      // Text-to-speech
utils.playSound('Ping')                         // System sound (Ping, Pop, Glass, Frog, etc.)
```

### Job Context

The `run` function receives:
- `logger` - Job-specific logger (`logger.log()`, `logger.error()`)
- `utils` - macOS utilities (notify, speak, playSound)
- `lastRun` - Date of last successful run (or null)

## Schedule Syntax

### Human-Readable (Recommended)

```javascript
// Basic intervals
schedule: 'every minute'
schedule: 'every hour'
schedule: 'every day'
schedule: 'hourly'
schedule: 'daily'
schedule: 'weekly'
schedule: 'monthly'
schedule: 'yearly'

// Custom intervals
schedule: 'every 5 minutes'
schedule: 'every 2 hours'
schedule: 'every 3 days'
schedule: 'every 2 weeks'
schedule: 'every 6 months'

// Shorthand intervals (without "every")
schedule: '5 minutes'
schedule: '2 hours'
schedule: '1 week'

// Specific times
schedule: 'at 9:30'
schedule: 'at 2:00 pm'
schedule: 'at 14:15'
schedule: 'noon'
schedule: 'midnight'
schedule: 'morning'       // 9am
schedule: 'evening'       // 6pm

// Days of week
schedule: 'monday'
schedule: 'friday'
schedule: 'weekdays'
schedule: 'weekends'
schedule: 'on monday at 9:00'
schedule: 'on friday at 5:30 pm'
schedule: 'on monday,wednesday,friday at 8:00 am'
schedule: 'on tuesday,thursday at 2:30 pm'
schedule: 'on weekdays at 8:30 am'
schedule: 'on weekends at 10:00 am'

// Day of month
schedule: 'on 1st of month at 9:00'
schedule: 'on 15th of month at 12:00'
schedule: 'on 31st of month at 2:00 pm'
schedule: 'first day of month'
schedule: 'middle of month'

// Business patterns
schedule: 'business hours'   // 9am-5pm weekdays

// Special
schedule: 'never'            // Feb 30th (never runs)
schedule: 'reboot'           // @reboot
schedule: 'startup'          // @reboot
```

### Standard Cron

```javascript
schedule: '0 9 * * *'      // 9am daily
schedule: '*/5 * * * *'    // Every 5 minutes
schedule: '0 0 * * 0'      // Midnight on Sundays
schedule: '30 14 1 * *'    // 2:30pm on 1st of month
schedule: '0 9-17 * * 1-5' // Every hour 9am-5pm weekdays
schedule: '15 2,14 * * *'  // 2:15am and 2:15pm daily
```

### Interval (milliseconds)

```javascript
interval: 60 * 1000           // Every minute
interval: 60 * 60 * 1000      // Every hour
interval: 24 * 60 * 60 * 1000 // Every day
```

## Disabling Jobs

Set `enabled: false` to disable a job, then run `sync`:

```javascript
{
  id: 'my-job',
  enabled: false,  // Job won't run
  schedule: 'daily',
  run: async () => { ... }
}
```

```bash
node bin/cli.js sync  # Removes disabled job from launchd
```

## Files

| Path | Description |
|------|-------------|
| `~/.cron-burgundy/state.json` | Last run times for each job |
| `~/.cron-burgundy/runner.log` | Main execution log |
| `~/.cron-burgundy/jobs/*.log` | Per-job logs |
| `~/.cron-burgundy/locks/` | Job lock files (prevent concurrent runs) |
| `~/Library/LaunchAgents/com.cron-burgundy.job.*.plist` | Per-job launchd configs |
| `~/.wakeup` | sleepwatcher script for wake detection |

## Architecture

```
┌─────────────────┐     ┌─────────────────┐
│    launchd      │     │  sleepwatcher   │
│ (per-job plist) │     │  (~/.wakeup)    │
└────────┬────────┘     └────────┬────────┘
         │                       │
         │ fires on schedule     │ fires on wake
         │                       │
         ▼                       ▼
┌─────────────────────────────────────────┐
│           cron-burgundy                 │
│  - Acquires job lock                    │
│  - Runs job function                    │
│  - Updates state.json                   │
│  - Releases lock                        │
└─────────────────────────────────────────┘
```

## DarkWake Behavior

Jobs can run even when your Mac appears asleep. macOS uses **DarkWake** - brief wake periods where background tasks run while the display stays off.

### What triggers DarkWake

- **Do Not Disturb schedule** - DND end time wakes the system
- **Power Nap** - periodic maintenance wakes (if enabled)
- **Scheduled alarms** - Calendar events, reminders
- **Push notifications** - iCloud, Messages, etc.
- **Network activity** - Wake on LAN, Find My Mac

### How it affects your jobs

If a `StartCalendarInterval` job is scheduled during a DarkWake, launchd runs it. This means:

- Jobs may run at their exact scheduled time even while "asleep"
- Audio (`utils.speak()`, `utils.playSound()`) will play
- Logs show the actual scheduled time, not wake time

### Checking wake events

```bash
pmset -g log | grep -E "(Wake|Sleep)" | tail -20
```

Look for `DarkWake` entries to see when your Mac briefly woke.
