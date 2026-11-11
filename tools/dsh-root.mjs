/**
 * Shared resolution of the dsh source tree for every plugin in this repo.
 *
 * DSH_SRC may be an absolute path to a dsh `src` root's parent (or the src
 * root itself), or the name of a directory sitting NEXT TO this repository
 * (the documented sibling convention: clone deepseek-harness next to
 * dsh-utils). Default sibling name: `dsh-source`.
 */

import { existsSync, statSync } from 'node:fs'
import { resolve, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

/** This tools/ directory. */
export const toolsDir = dirname(fileURLToPath(import.meta.url))
/** Repository root (the directory containing tools/ and plugins/). */
export const repoRoot = resolve(toolsDir, '..')

function isDir(path) {
  return existsSync(path) && statSync(path).isDirectory()
}

/** Resolve the dsh source root (the directory holding tsconfig.base.json). */
export function dshSourceRoot() {
  const raw = process.env.DSH_SRC ?? 'dsh-source'
  const absolute = resolve(raw)
  const candidates = [
    ...absolute === raw ? [] : [absolute],
    // Sibling of the repository (…/dsh-utils/../<name>).
    resolve(repoRoot, '..', raw),
  ]
  for (const candidate of candidates) {
    if (!isDir(candidate)) continue
    if (basename(candidate) === 'src') return candidate
    if (isDir(resolve(candidate, 'src'))) return resolve(candidate, 'src')
  }
  const tried = [resolve(raw), resolve(repoRoot, '..', raw)].join('", "')
  throw new Error(
    `dsh source tree not found (tried "${tried}"). `
    + 'Clone deepseek-harness next to this repo, or set DSH_SRC to its path.',
  )
}

/** One plugin's root directory by name (plugins/<name>). */
export function pluginRoot(name) {
  const root = resolve(repoRoot, 'plugins', name)
  if (!isDir(root)) throw new Error(`unknown plugin "${name}" (expected plugins/${name})`)
  return root
}
