/**
 * Generate a plugin's tsconfig `paths` map against a dsh source tree, without
 * installing the dsh workspace: every workspace package name and subpath
 * export maps to its TypeScript source entry (the repo's own source plane).
 *
 *   node tools/gen-tsconfig-paths.mjs <plugin>        # writes plugins/<plugin>/tsconfig.paths.json
 */

import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { dshSourceRoot, pluginRoot } from './dsh-root.mjs'

const root = dshSourceRoot()

/** Collect candidate package.json directories under a group directory. */
function packageDirs(groupDir) {
  const group = join(root, groupDir)
  if (!existsSync(group)) return []
  const out = []
  for (const entry of readdirSync(group)) {
    const dir = join(group, entry)
    if (!statSync(dir).isDirectory()) continue
    const manifest = join(dir, 'package.json')
    if (existsSync(manifest)) { out.push(dir); continue }
    for (const sub of readdirSync(dir)) {
      const subDir = join(dir, sub)
      if (statSync(subDir).isDirectory() && existsSync(join(subDir, 'package.json'))) {
        out.push(subDir)
      }
    }
  }
  return out
}

/** Resolve an exports target (or main) to a repo-relative .ts/.tsx source. */
function sourceEntry(pkgDir, target) {
  if (typeof target !== 'string') return undefined
  const base = join(pkgDir, target)
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  }
  return undefined
}

const paths = {}
let mapped = 0

function mapPackage(pkgDir) {
  let manifest
  try { manifest = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')) } catch { return }
  const name = manifest.name
  if (typeof name !== 'string' || name === '') return
  const targets = new Map()
  const rootTarget = typeof manifest.exports?.['.'] === 'string'
    ? manifest.exports['.']
    : manifest.exports?.['.']?.default
      ?? manifest.exports?.['.']?.import
      ?? manifest.main
  const dot = sourceEntry(pkgDir, rootTarget) ?? sourceEntry(pkgDir, './src/index.ts')
  if (dot !== undefined) targets.set(name, dot)
  if (manifest.exports !== undefined && typeof manifest.exports === 'object') {
    for (const [key, value] of Object.entries(manifest.exports)) {
      if (key === '.' || key.startsWith('./locale/') || !key.startsWith('./')) continue
      const target = typeof value === 'string' ? value : value?.default ?? value?.import ?? value?.types
      // Built targets (lib/...) do not exist in a source tree; fall back to
      // the mirrored source path (./src/<sub>[.ts|/index.ts]).
      const entry = sourceEntry(pkgDir, target)
        ?? sourceEntry(pkgDir, `./src${key.slice(1)}`)
      if (entry !== undefined) {
        targets.set(`${name}${key.slice(1)}`, entry)
      }
    }
  }
  for (const [key, entry] of targets) {
    paths[key] = [entry.replaceAll('\\', '/')]
    mapped += 1
  }
}

for (const group of ['packages', 'vendor']) {
  for (const dir of packageDirs(group)) mapPackage(dir)
}
// The dsh launcher package lives directly under apps/.
mapPackage(join(root, 'apps', 'cli'))

const outFile = join(pluginRoot(process.argv[2] ?? ''), 'tsconfig.paths.json')
writeFileSync(outFile, `${JSON.stringify({ compilerOptions: { paths } }, null, 2)}\n`)
console.log(`mapped ${mapped} specifiers from ${root} into ${outFile}`)
