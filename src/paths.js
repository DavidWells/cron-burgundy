/**
 * Resolves cron-burgundy's state/log directory.
 * CRON_BURGUNDY_HOME overrides the default ~/.cron-burgundy (tests use this to stay out of the real one).
 */
import path from 'path'
import os from 'os'

export const CRON_BURGUNDY_DIR = process.env.CRON_BURGUNDY_HOME || path.join(os.homedir(), '.cron-burgundy')
