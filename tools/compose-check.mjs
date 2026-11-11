/**
 * Compose one plugin's two type-check configs (host and client compilation
 * faces, mirroring the dsh repo's split programs so Context merges never
 * collide), layering the generated path map over the repo base's own entries.
 *
 *   node tools/compose-check.mjs <plugin>
 *   → plugins/<plugin>/tsconfig.check.{host,client}.json
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { dshSourceRoot, pluginRoot, repoRoot } from './dsh-root.mjs'

const dshRoot = dshSourceRoot()
const pkg = pluginRoot(process.argv[2] ?? '')

const stripJsonComments = text => JSON.parse(text.replace(/^\s*\/\/.*$/gm, ''))
const base = stripJsonComments(readFileSync(join(dshRoot, 'tsconfig.base.json'), 'utf8'))
const generated = JSON.parse(readFileSync(join(pkg, 'tsconfig.paths.json'), 'utf8'))
const paths = { ...(base.compilerOptions.paths ?? {}), ...generated.compilerOptions.paths }

const typeRoots = [join(dshRoot, 'scripts', 'types')]
  .concat(existsSync(join(repoRoot, 'node_modules', '@types')) ? [join(repoRoot, 'node_modules', '@types')] : [])

const host = {
  extends: join(dshRoot, 'tsconfig.base.json'),
  compilerOptions: {
    noEmit: true,
    composite: false,
    incremental: false,
    declaration: false,
    declarationMap: false,
    sourceMap: false,
    types: ['node'],
    lib: ['esnext'],
    typeRoots,
    baseUrl: dshRoot,
    paths,
  },
  include: [resolve(pkg, 'src', '*.ts'), resolve(pkg, 'tests', '*.ts')],
}

const client = {
  extends: join(dshRoot, 'tsconfig.base.client.json'),
  compilerOptions: {
    noEmit: true,
    composite: false,
    incremental: false,
    declaration: false,
    declarationMap: false,
    sourceMap: false,
    typeRoots,
    baseUrl: dshRoot,
    paths,
  },
  include: [resolve(pkg, 'src', 'client', '**', '*.ts'), resolve(pkg, 'src', 'client', '**', '*.tsx')],
}

writeFileSync(join(pkg, 'tsconfig.check.host.json'), `${JSON.stringify(host, null, 2)}\n`)
writeFileSync(join(pkg, 'tsconfig.check.client.json'), `${JSON.stringify(client, null, 2)}\n`)
console.log(`composed ${pkg} check configs with ${Object.keys(paths).length} path entries (dsh: ${dshRoot})`)
