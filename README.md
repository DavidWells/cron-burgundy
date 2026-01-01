# cron-burgundy

Simple macOS cron manager with missed job recovery. Uses launchd for scheduling, catches up on missed jobs when your Mac wakes up.

## How It Works

1. **launchd** (macOS native) handles scheduling
2. On trigger, spawns `node runner.js`
3. Runner checks which jobs are due → executes them → exits
4. No daemon, no background process

If your Mac was asleep when a job should have run, it fires on wake.

## Quick Start

```bash
# 1. Define your jobs in jobs.js
# 2. Install to launchd
pnpm cron-burgundy install

# 3. Done! Jobs run automatically
```

## CLI Commands

```bash
cron-burgundy run        # Execute all due jobs now
cron-burgundy list       # Show jobs with last run / next due
cron-burgundy install    # Install launchd plist
cron-burgundy uninstall  # Remove launchd plist
cron-burgundy status     # Check installation status
```

## Defining Jobs

Edit `jobs.js` in project root:

```javascript
export const jobs = [
  // Cron syntax
  {
    id: 'daily-backup',
    schedule: '0 9 * * *',  // 9am daily
    run: async () => {
      console.log('Backing up...')
    }
  },
  
  // Or interval in milliseconds
  {
    id: 'hourly-sync',
    interval: 60 * 60 * 1000,
    run: async () => {
      console.log('Syncing...')
    }
  }
]
```

## Programmatic API

```javascript
import { runAllDue, getState } from 'cron-burgundy'
import { jobs } from './jobs.js'

// Run all due jobs
await runAllDue(jobs)

// Check state
const state = await getState()
console.log(state)  // { 'daily-backup': '2024-01-15T09:00:00.000Z', ... }
```

## Files

- `~/.cron-burgundy/state.json` - Last run times
- `~/.cron-burgundy/runner.log` - Stdout logs
- `~/.cron-burgundy/runner.error.log` - Stderr logs
- `~/Library/LaunchAgents/com.cron-burgundy.plist` - launchd config

## Schedule

After `install`, cron-burgundy runs:
- On every login/wake (catches missed jobs)
- Every 15 minutes
