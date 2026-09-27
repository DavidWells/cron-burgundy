/**
 * Points CRON_BURGUNDY_HOME at a throwaway temp dir so tests never write to the real ~/.cron-burgundy.
 * Import first in any test that touches state, logs, locks, or the registry.
 */
import fs from 'fs'
import os from 'os'
import path from 'path'

// realpath so paths match fs.realpathSync results (macOS /var -> /private/var)
const TEST_HOME = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cron-burgundy-test-')))
process.env.CRON_BURGUNDY_HOME = TEST_HOME

process.on('exit', () => {
  fs.rmSync(TEST_HOME, { recursive: true, force: true })
})

export { TEST_HOME }
