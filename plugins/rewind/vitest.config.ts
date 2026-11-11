import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const here = dirname(fileURLToPath(import.meta.url))
// DSH_SRC selects the dsh source tree to alias (e.g. dsh-source-rc2).
// DSH_SRC selects the dsh source tree to alias: an absolute path, or a
// directory name next to this repository (sibling convention).
const dshRoot = resolve(here, '..', '..', '..', process.env.DSH_SRC ?? 'dsh-source', 'src')

// Source-plane aliasing into the dsh source tree (mirrors the repo's own
// tsconfig.base.json source resolution). External npm packages (zod, react…)
// resolve normally through the workspace-parent node_modules.
const paths = JSON.parse(readFileSync(resolve(here, 'tsconfig.paths.json'), 'utf8')).compilerOptions.paths
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const alias = Object.entries(paths).map(([key, targets]) => ({
  find: new RegExp(`^${escape(key)}$`),
  replacement: resolve(dshRoot, (targets as string[])[0]!.replace(/^\.\//, '')),
}))

export default defineConfig({
  resolve: { alias },
  test: {
    include: ['tests/**/*.spec.ts'],
    environment: 'node',
  },
})
