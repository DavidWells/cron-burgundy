# Test Coverage Configuration Options

**Purpose:** Document possible approaches for improving test coverage tooling, without implementing yet.

---

## Current State

The project uses [uvu](https://github.com/lukeed/uvu) as the test runner. Tests are scattered across:
- `src/*.test.js` - Unit tests for core modules
- `bin/cli.test.js` - CLI integration tests

### Current Test Script
```json
{
  "scripts": {
    "test": "uvu src -p '\\.test\\.js$'"
  }
}
```

---

## Option 1: Native uvu Coverage with c8

**Approach:** Use [c8](https://github.com/bcoe/c8) (native V8 coverage) with uvu.

**Configuration:**
```json
{
  "scripts": {
    "test": "uvu src bin -p '\\.test\\.js$'",
    "test:coverage": "c8 uvu src bin -p '\\.test\\.js$'",
    "test:coverage:report": "c8 report --reporter=html"
  }
}
```

**c8 config (package.json or .c8rc.json):**
```json
{
  "c8": {
    "all": true,
    "include": ["src/**/*.js", "bin/**/*.js"],
    "exclude": ["**/*.test.js", "types/**"],
    "reporter": ["text", "lcov", "html"],
    "check-coverage": true,
    "lines": 80,
    "functions": 80,
    "branches": 70
  }
}
```

**Pros:**
- Zero-config for native ES modules
- Works out of the box with uvu
- Fast (no transpilation)
- lcov output for CI integration

**Cons:**
- Less feature-rich than Istanbul/nyc
- Requires Node 14+

---

## Option 2: NYC (Istanbul) with ESM Loader

**Approach:** Use nyc with esm loader for traditional Istanbul coverage.

**Configuration:**
```json
{
  "scripts": {
    "test:coverage": "nyc --experimental-loader @istanbuljs/esm-loader-hook uvu src bin -p '\\.test\\.js$'"
  }
}
```

**.nycrc.json:**
```json
{
  "all": true,
  "include": ["src/**/*.js", "bin/**/*.js"],
  "exclude": ["**/*.test.js", "types/**"],
  "reporter": ["text", "lcov", "html"],
  "check-coverage": true,
  "lines": 80,
  "functions": 80,
  "branches": 70
}
```

**Pros:**
- Mature ecosystem
- Many reporters
- Well-documented

**Cons:**
- Requires ESM loader setup
- More complex configuration
- Slower than c8

---

## Option 3: Vitest Migration

**Approach:** Migrate from uvu to [Vitest](https://vitest.dev/) for integrated coverage.

**Configuration (vitest.config.js):**
```javascript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.js', 'bin/**/*.test.js'],
    coverage: {
      provider: 'v8', // or 'istanbul'
      include: ['src/**/*.js', 'bin/**/*.js'],
      exclude: ['**/*.test.js', 'types/**'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 70
      }
    }
  }
})
```

**Test syntax changes needed:**
```javascript
// From uvu:
import { test } from 'uvu'
import * as assert from 'uvu/assert'

// To vitest:
import { test, expect } from 'vitest'
```

**Pros:**
- Built-in coverage support
- Faster (ESBuild-based)
- Modern DX (watch mode, UI)
- Jest-compatible API

**Cons:**
- Requires test migration
- Larger dependency
- Breaking change

---

## Option 4: Custom Coverage Script

**Approach:** Create a wrapper script to coordinate coverage across test types.

**scripts/coverage.js:**
```javascript
#!/usr/bin/env node
import { spawn } from 'child_process'
import { rm, mkdir } from 'fs/promises'

async function run() {
  // Clean previous coverage
  await rm('.coverage', { recursive: true, force: true })
  await mkdir('.coverage', { recursive: true })

  // Run unit tests with coverage
  const unit = spawn('c8', [
    '--include', 'src/**/*.js',
    '--exclude', '**/*.test.js',
    '--report-dir', '.coverage/unit',
    'uvu', 'src', '-p', '\\.test\\.js$'
  ])

  // Run CLI tests with coverage
  const cli = spawn('c8', [
    '--include', 'bin/**/*.js',
    '--exclude', '**/*.test.js',
    '--report-dir', '.coverage/cli',
    'uvu', 'bin', '-p', '\\.test\\.js$'
  ])

  // Merge coverage reports
  // ...
}
```

**Pros:**
- Full control
- Can separate unit vs integration coverage
- Custom reporting

**Cons:**
- More maintenance
- Custom implementation

---

## Recommendation

**Start with Option 1 (c8)** as the simplest path:

1. Minimal configuration
2. Works with existing uvu tests
3. Native ESM support
4. Can migrate to Vitest later if needed

### Implementation Steps (when ready)

1. Install c8: `npm install -D c8`
2. Add coverage scripts to package.json
3. Add .c8rc.json configuration
4. Add coverage thresholds
5. Add coverage to CI workflow
6. Generate badges for README

---

## CI Integration Examples

### GitHub Actions
```yaml
- name: Run tests with coverage
  run: npm run test:coverage

- name: Upload coverage to Codecov
  uses: codecov/codecov-action@v3
  with:
    file: ./coverage/lcov.info
```

### Coverage Badge
```markdown
[![Coverage](https://codecov.io/gh/owner/repo/branch/main/graph/badge.svg)](https://codecov.io/gh/owner/repo)
```

---

## Questions for Decision

1. What coverage threshold is acceptable? (e.g., 80% lines, 70% branches)
2. Should coverage be enforced in CI (fail build if below threshold)?
3. Is Vitest migration worth the test rewrite effort?
4. Should we separate unit test coverage from integration test coverage?
