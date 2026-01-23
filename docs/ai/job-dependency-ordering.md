# Job Dependency/Ordering Support

**Purpose:** Brainstorm what job dependency and ordering support could look like in cron-burgundy.

---

## Problem Statement

Currently, all jobs in cron-burgundy run independently. There's no way to express:
- "Job B should run after Job A completes"
- "Job C depends on both Job A and Job B"
- "If Job A fails, don't run Job B"

**Common use cases:**
- Backup before cleanup
- Build before deploy
- Data fetch before data processing
- Database migration before app restart

---

## Option 1: Simple `after` Property

**Approach:** Add an `after` property to job configuration that specifies which job(s) must complete first.

**Job Configuration:**
```javascript
export const jobs = [
  {
    id: 'backup',
    schedule: '0 2 * * *',
    run: async () => { /* backup database */ }
  },
  {
    id: 'cleanup',
    after: 'backup', // runs after backup completes
    run: async () => { /* cleanup old files */ }
  },
  {
    id: 'report',
    after: ['backup', 'cleanup'], // runs after both complete
    run: async () => { /* generate report */ }
  }
]
```

**Pros:**
- Simple, declarative syntax
- Easy to understand
- Minimal changes to existing API

**Cons:**
- No schedule for dependent jobs (only triggered by parent)
- Chain failures cascade implicitly
- Circular dependency detection needed

**Implementation Notes:**
- Dependent jobs don't have their own schedule - they inherit timing from parent
- Runner would need to track job completion events
- Could store dependency graph in state.json

---

## Option 2: Job Chains/Pipelines

**Approach:** Define explicit pipelines that group related jobs.

**Job Configuration:**
```javascript
import { pipeline } from 'cron-burgundy'

export const jobs = [
  {
    id: 'standalone-job',
    schedule: '*/10 * * * *',
    run: async () => { /* ... */ }
  }
]

export const pipelines = [
  pipeline('nightly-maintenance', '0 2 * * *', [
    { id: 'backup', run: async () => { /* ... */ } },
    { id: 'cleanup', run: async () => { /* ... */ } },
    { id: 'report', run: async () => { /* ... */ } }
  ])
]
```

**Pros:**
- Clear visual grouping of related jobs
- Single schedule for entire chain
- Easy to reason about execution order

**Cons:**
- New API concept (pipelines)
- All jobs in pipeline share schedule
- Less flexible than dependency graph

**Implementation Notes:**
- Pipeline becomes a special job type internally
- Each step runs sequentially
- Could add options like `continueOnError: true`

---

## Option 3: DAG-based Dependencies

**Approach:** Full directed acyclic graph (DAG) support with explicit dependency declarations.

**Job Configuration:**
```javascript
export const jobs = [
  {
    id: 'fetch-data',
    schedule: '0 * * * *',
    run: async () => { /* fetch from API */ }
  },
  {
    id: 'process-data',
    dependsOn: ['fetch-data'],
    run: async () => { /* process the data */ }
  },
  {
    id: 'generate-report',
    dependsOn: ['process-data'],
    run: async () => { /* create report */ }
  },
  {
    id: 'send-notification',
    dependsOn: ['generate-report'],
    schedule: '0 9 * * *', // also runs on its own schedule
    run: async () => { /* send email */ }
  }
]
```

**Pros:**
- Maximum flexibility
- Jobs can have both dependencies AND their own schedule
- Standard pattern (like Airflow, GitHub Actions)

**Cons:**
- Most complex to implement
- Need cycle detection
- State management more complex

**Implementation Notes:**
- Build dependency graph at startup
- Validate no cycles exist
- Track "ready to run" state per job
- Jobs with schedules run on schedule AND when dependencies complete

---

## Option 4: Event-based Triggers

**Approach:** Jobs can emit and listen to events.

**Job Configuration:**
```javascript
export const jobs = [
  {
    id: 'backup',
    schedule: '0 2 * * *',
    emits: ['backup:complete', 'backup:failed'],
    run: async ({ emit }) => {
      try {
        await doBackup()
        emit('backup:complete')
      } catch (e) {
        emit('backup:failed', e)
      }
    }
  },
  {
    id: 'cleanup',
    on: 'backup:complete', // triggers on event
    run: async () => { /* ... */ }
  },
  {
    id: 'alert',
    on: 'backup:failed',
    run: async ({ event }) => {
      await notify(`Backup failed: ${event.error}`)
    }
  }
]
```

**Pros:**
- Very flexible
- Decoupled jobs
- Easy error handling patterns
- Can react to external events

**Cons:**
- More complex API
- Event naming conventions needed
- Debugging event flows harder

**Implementation Notes:**
- Event bus/emitter in runner
- Events persisted to state for replay
- Could integrate with external event sources

---

## Option 5: Workflow Files

**Approach:** Separate workflow definition files (inspired by GitHub Actions).

**File: `workflows/nightly.workflow.js`**
```javascript
export default {
  name: 'Nightly Maintenance',
  schedule: '0 2 * * *',

  jobs: {
    backup: {
      run: async () => { /* ... */ }
    },
    cleanup: {
      needs: ['backup'],
      run: async () => { /* ... */ }
    },
    report: {
      needs: ['backup', 'cleanup'],
      run: async () => { /* ... */ }
    }
  }
}
```

**Pros:**
- Familiar pattern (GitHub Actions)
- Clear separation of workflows
- Easy to visualize
- Each workflow is self-contained

**Cons:**
- New file format
- Registry needs to track workflows
- Overlaps with existing jobs concept

**Implementation Notes:**
- Scan for `.workflow.js` files
- Convert to internal job representation
- Separate launchd plist per workflow

---

## Comparison Table

| Feature | Option 1: after | Option 2: pipeline | Option 3: DAG | Option 4: events | Option 5: workflow |
|---------|-----------------|-------------------|---------------|------------------|-------------------|
| Complexity | Low | Low | Medium | High | Medium |
| Flexibility | Medium | Low | High | Very High | High |
| Familiar pattern | - | - | Airflow | Pub/Sub | GitHub Actions |
| Error handling | Implicit | Per-pipeline | Per-job | Explicit | Per-job |
| Cross-namespace | No | No | Possible | Yes | No |
| launchd impact | Minimal | Minimal | Moderate | Moderate | Moderate |

---

## Recommendation

**Start with Option 1 (`after` property)** for MVP:

1. Simplest to implement
2. Covers 80% of use cases
3. Minimal changes to existing API
4. Can evolve to Option 3 (DAG) later

### Proposed MVP Implementation

```javascript
// Job config
{
  id: 'cleanup',
  after: 'backup',           // single dependency
  // OR
  after: ['backup', 'sync'], // multiple dependencies
  onParentFailure: 'skip',   // 'skip' | 'run' | 'fail' (default: 'skip')
  run: async (ctx) => { /* ... */ }
}
```

**Key behaviors:**
- Jobs with `after` don't have their own schedule
- They run immediately after parent(s) complete
- If parent fails, dependent jobs are skipped by default
- Circular dependencies throw error at registration time

---

## Implementation Considerations

### State Changes

```javascript
// state.json additions
{
  "jobs": {
    "backup": {
      "lastRun": "2024-01-20T02:00:00Z",
      "lastStatus": "success",  // NEW: track success/failure
      "lastDuration": 45000     // NEW: track duration
    }
  },
  "pendingDependents": {        // NEW: track waiting jobs
    "cleanup": {
      "waitingFor": ["backup"],
      "triggeredAt": "2024-01-20T02:00:00Z"
    }
  }
}
```

### Runner Changes

1. After job completes, check for dependents
2. If all dependencies satisfied, run dependent
3. Track execution chain for debugging
4. Add `--chain` flag to show dependency tree

### CLI Changes

```bash
# Show dependency tree
cron-burgundy list --tree

# Output:
# backup (0 2 * * *)
# └── cleanup (after: backup)
#     └── report (after: cleanup)

# Run job and all dependents
cron-burgundy run backup --with-dependents
```

---

## Questions for Decision

1. Should dependent jobs be able to have their own schedule too?
2. How should cross-namespace dependencies work (if at all)?
3. Should we support conditional dependencies (only run if parent output matches)?
4. How should the CLI visualize dependency chains?
5. Should failed dependencies block or just warn?
