/**
 * Run every plugin's test script (or one plugin by name).
 *
 *   node tools/test-all.mjs [plugin]
 */

import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { pluginRoot, repoRoot } from './dsh-root.mjs'

const arg = process.argv[2]
const plugins = arg !== undefined ? [arg] : readdirSync(join(repoRoot, 'plugins'))

let failed = false
for (const plugin of plugins) {
  console.log(`\n=== ${plugin} ===`)
  const run = spawnSync('npm', ['test'], {
    cwd: pluginRoot(plugin),
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (run.status !== 0) failed = true
}
process.exit(failed ? 1 : 0)
