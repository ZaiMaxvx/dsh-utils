/**
 * Portable smoke runner: boots Node with the dsh resolver hook and tsx, then
 * runs one plugin script.
 *
 *   node tools/smoke.mjs <plugin> <script-path-relative-to-plugin>
 *   DSH_SRC=dsh-source-rc2 node tools/smoke.mjs rewind tests/smoke.session.mjs
 */

import { spawn } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pluginRoot } from './dsh-root.mjs'

const [plugin, script] = process.argv.slice(2)
if (plugin === undefined || script === undefined) {
  console.error('usage: smoke.mjs <plugin> <script-relative-to-plugin>')
  process.exit(1)
}

const hooks = new URL('./register-hooks.mjs', import.meta.url).href
const entry = resolve(pluginRoot(plugin), script)
const child = spawn(process.execPath, ['--import', hooks, '--import', 'tsx', entry], {
  env: { ...process.env, DSH_PLUGIN: plugin },
  stdio: 'inherit',
  cwd: dirname(entry),
})
child.on('exit', (code, signal) => {
  if (signal !== null) process.kill(process.pid, signal)
  else process.exit(code ?? 0)
})
