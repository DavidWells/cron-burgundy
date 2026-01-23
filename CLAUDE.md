# cron-burgundy Development Guide

## Overview
cron-burgundy is a macOS cron manager with missed job recovery, using launchd for scheduling.

## Quick Start
```bash
npm install
npm test
```

## Architecture

### Core Modules
- **src/scheduler.js** - Job scheduling logic, cron parsing, interval calculation
- **src/runner.js** - Job execution (`runAllDue`, `runJobNow`, `checkMissed`)
- **src/registry.js** - Job file registration and namespace management
- **src/launchd.js** - macOS launchd plist generation and management
- **src/state.js** - Job state persistence (last run times, pause status)
- **src/lock.js** - File-based locking for concurrent job execution
- **src/logger.js** - Logging with rotation support
- **src/cron-parser.js** - Human-readable cron schedule normalization
- **src/actions/index.js** - macOS utilities (notify, speak, playSound)

### CLI
- **bin/cli.js** - Commander-based CLI with commands: list, run, logs, pause, unpause, sync, clear, status

### Type Definitions
- **types/index.d.ts** - Generated TypeScript definitions (use `npm run types`)

## Key Concepts

### Namespaces
Jobs can be organized into namespaces. Qualified IDs use format `namespace/jobId`.

### Job Configuration
```javascript
{
  id: 'my-job',           // Required: unique identifier
  description: 'Does X',  // Optional: human-readable description
  schedule: '0 9 * * *',  // Cron expression OR
  interval: 60000,        // Interval in milliseconds
  enabled: true,          // Optional: default true
  run: async (ctx) => {}  // Required: job function
}
```

### Job Context
Jobs receive `{ logger, utils, lastRun }` context when executed.

## Testing
```bash
npm test           # Run all tests
npm run test:watch # Watch mode
```

Tests use [uvu](https://github.com/lukeed/uvu) - fast, lightweight test runner.

## Code Style
- ES modules (import/export)
- JSDoc for type annotations
- Async/await for file operations
- No semicolons (standardjs style)

## Common Patterns

### Reading state
```javascript
import { getState, getLastRun } from './state.js'
const lastRun = await getLastRun(jobId)
```

### File operations with locking
```javascript
import { acquireLock, releaseLock } from './lock.js'
if (await acquireLock(jobId)) {
  try { /* work */ } finally { await releaseLock(jobId) }
}
```

## Important Constants
- `MIN_INTERVAL_MS` (10000) - Minimum launchd interval (10 seconds)
- `LABEL_PREFIX` - 'com.cron-burgundy' for launchd labels
