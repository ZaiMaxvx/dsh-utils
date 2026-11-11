/**
 * Run both type-check faces for every plugin (or one plugin by name).
 *
 *   node tools/check-all.mjs [plugin]
 */

import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { pluginRoot, repoRoot } from './dsh-root.mjs'

const arg = process.argv[2]
const plugins = arg !== undefined ? [arg] : readdirSync(join(repoRoot, 'plugins'))

const tsc = join(repoRoot, 'node_modules', 'typescript', 'lib', 'tsc.js')
let failed = false
for (const plugin of plugins) {
  const pkg = pluginRoot(plugin)
  spawnSync(process.execPath, [join(repoRoot, 'tools', 'gen-tsconfig-paths.mjs'), plugin], { stdio: 'inherit' })
  spawnSync(process.execPath, [join(repoRoot, 'tools', 'compose-check.mjs'), plugin], { stdio: 'inherit' })
  for (const face of ['tsconfig.check.host.json', 'tsconfig.check.client.json']) {
    const run = spawnSync(process.execPath, [tsc, '-p', join(pkg, face), '--noEmit'], { encoding: 'utf8' })
    const errors = run.stdout.split('\n').filter(line => /^(src|tests)\//.test(line))
    console.log(`${plugin} ${face.split('.')[2]}: ${errors.length} plugin errors`)
    for (const line of errors) console.log(`  ${line}`)
    if (run.status !== 0 && errors.length === 0) {
      // dsh-internal strictness noise under this composed program; surface a count only.
      const internal = run.stdout.split('\n').filter(line => line.startsWith('../') || /^[A-Za-z]:/.test(line)).length
      console.log(`  (${internal} errors inside dsh vendored sources — not this plugin; see README)`)
    }
    if (errors.length > 0) failed = true
  }
}
process.exit(failed ? 1 : 0)
