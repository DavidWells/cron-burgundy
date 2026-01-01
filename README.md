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

# 4. Define your jobs in jobs.js

# 5. Sync to launchd
node bin/cli.js sync

# Done! Jobs run automatically
```

## CLI Commands

```bash
# Job management
cron-burgundy sync           # Sync jobs with launchd (install enabled, remove disabled)
cron-burgundy list           # Show all jobs with status
cron-burgundy run <jobId>    # Run a specific job immediately
cron-burgundy uninstall      # Remove all launchd plists
cron-burgundy status         # Show installed plists

# Logs
cron-burgundy logs                      # View runner log
cron-burgundy logs view <jobId>         # View specific job log
cron-burgundy logs view -t              # Tail runner log
cron-burgundy logs view <jobId> -t      # Tail job log
cron-burgundy logs list                 # List all log file paths
cron-burgundy logs clear                # Clear runner log
cron-burgundy logs clear <jobId>        # Clear specific job log
cron-burgundy logs clear all            # Clear all job logs
```

## Defining Jobs

Edit `jobs.js` in project root:

```javascript
export const jobs = [
  {
    id: 'my-job',
    schedule: 'every 5 minutes',  // Human-readable or cron syntax
    enabled: true,                 // Optional, default: true
    run: async (logger) => {
      await logger.log('Starting...')
      // Your job logic here
      await logger.log('Done!')
    }
  }
]
```

## Schedule Syntax

### Human-Readable (Recommended)

```javascript
// Intervals
schedule: 'every minute'
schedule: 'every 5 minutes'
schedule: 'every 2 hours'
schedule: 'hourly'
schedule: 'daily'
schedule: 'weekly'
schedule: 'monthly'

// Specific times
schedule: 'at 9:30'
schedule: 'at 2:00 pm'
schedule: 'noon'
schedule: 'midnight'
schedule: 'morning'      // 9am
schedule: 'evening'      // 6pm

// Days of week
schedule: 'weekdays'
schedule: 'weekends'
schedule: 'monday'
schedule: 'on monday at 9:00'
schedule: 'on monday,wednesday,friday at 8:00 am'
schedule: 'on weekdays at 8:30 am'
```

### Standard Cron

```javascript
schedule: '0 9 * * *'      // 9am daily
schedule: '*/5 * * * *'    // Every 5 minutes
schedule: '0 0 * * 0'      // Midnight on Sundays
schedule: '30 14 1 * *'    // 2:30pm on 1st of month
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
