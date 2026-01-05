/**
 * CJS fixture with module.exports = { jobs }
 */
module.exports = {
  jobs: [
    { id: 'cjs-test', schedule: 'daily', run: () => 'cjs' }
  ]
}
