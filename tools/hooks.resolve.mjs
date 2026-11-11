/**
 * Resolve hook for running a plugin's scripts against the dsh source tree
 * without installing its node_modules: `@deepseek-ai/*` (and vendored
 * cordis) specifiers map to TypeScript sources; everything else falls
 * through to Node. Selected by DSH_SRC (see tools/dsh-root.mjs) and
 * DSH_PLUGIN (plugin directory name under plugins/).
 */

import { readFileSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { dshSourceRoot, pluginRoot } from './dsh-root.mjs'

const DSH_SRC = dshSourceRoot()
const PATHS = JSON.parse(
  readFileSync(join(pluginRoot(process.env.DSH_PLUGIN ?? ''), 'tsconfig.paths.json'), 'utf8'),
).compilerOptions.paths

const SRC_ROOT_URL = pathToFileURL(`${DSH_SRC}/`).href

function toUrl(entry) {
  const cleaned = entry.replace(/^\.\//, '')
  if (isAbsolute(cleaned)) return pathToFileURL(cleaned).href
  return new URL(cleaned, SRC_ROOT_URL).href
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@deepseek-ai/')) {
    const mapped = PATHS[specifier]
    if (mapped !== undefined && mapped.length > 0) {
      return { url: toUrl(mapped[0]), shortCircuit: true }
    }
  }
  return nextResolve(specifier, context)
}
