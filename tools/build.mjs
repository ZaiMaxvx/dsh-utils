/**
 * Build one plugin's installable artifacts (committed under plugins/<name>/lib):
 *
 *   lib/index.js   host half — single-file ESM, every bare dependency external
 *                  (esbuild packages:'external'), relative imports inlined
 *   lib/client.js  browser half — one classic-script statement registering the
 *                  cordis plugin factory through window.__ModuleLoader__.load,
 *                  per the dsh client-modules contract (CJS body, platform
 *                  module table external, .module.css compiled by lightningcss
 *                  and injected at factory materialization)
 *
 *   node tools/build.mjs <plugin>
 */

import { build } from 'esbuild'
import { transform } from 'lightningcss'
import { basename, join, resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { pluginRoot } from './dsh-root.mjs'

const name = process.argv[2]
if (name === undefined) {
  console.error('usage: build.mjs <plugin>')
  process.exit(1)
}
const pkgDir = pluginRoot(name)
const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'))
const id = pkg.name

await build({
  entryPoints: { index: join(pkgDir, 'src', 'index.ts') },
  outdir: join(pkgDir, 'lib'),
  outExtension: { '.js': '.js' },
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  // All bare imports stay external (host provides the installed instances);
  // relative imports (planner/rewind/history/sideask/types) are inlined.
  packages: 'external',
  sourcemap: true,
  logLevel: 'info',
})
console.log(`built host half: ${id} → lib/index.js`)

// The dsh client module-table baseline (dsh: packages/client/web/src/platform.ts).
const PLATFORM_EXTERNALS = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client',
  '@deepseek-ai/cordis', 'zod', '@tanstack/react-virtual',
  '@deepseek-ai/dsh-client-store', '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives', '@deepseek-ai/dsh-client-ui-dockkit',
]
const external = [...PLATFORM_EXTERNALS, ...(pkg.dsh?.client?.external ?? [])]

// Mirrors dsh's dsh-css-modules-inline plugin (tsdown.client.ts
// styleInjectionModule): compile the stylesheet, inject it as a tagged
// <style data-plugin> at factory materialization, export the class map.
const cssModules = {
  name: 'dsh-like-css-modules',
  setup(builder) {
    builder.onResolve({ filter: /\.module\.css$/ }, args =>
      ({ path: resolve(args.resolveDir, args.path), namespace: 'dsh-css' }))
    builder.onLoad({ filter: /.*/, namespace: 'dsh-css' }, ({ path }) => {
      const { code, exports: cssExports } = transform({
        filename: path,
        code: readFileSync(path),
        cssModules: { pattern: '[hash]_[local]' },
        minify: true,
      })
      const classMap = Object.fromEntries(
        Object.entries(cssExports ?? {})
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, value]) => [key, value.name]),
      )
      const tagId = `${id}/${basename(path)}`
      return {
        loader: 'js',
        contents: `
const css = ${JSON.stringify(code.toString())};
const tagId = ${JSON.stringify(tagId)};
if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') === null) {
  const tag = document.createElement('style');
  tag.dataset.plugin = ${JSON.stringify(id)};
  tag.dataset.pluginCss = tagId;
  tag.textContent = css;
  document.head.appendChild(tag);
}
export default ${JSON.stringify(classMap)};`,
      }
    })
  },
}

await build({
  entryPoints: [join(pkgDir, 'src', 'client', 'index.ts')],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2024',
  jsx: 'automatic',
  splitting: false,
  outfile: join(pkgDir, 'lib', 'client.js'),
  external,
  define: { 'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production') },
  banner: {
    js:
      `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {\n`
      + 'var module = { exports: {} }; var exports = module.exports;',
  },
  footer: { js: 'return module.exports; } });' },
  plugins: [cssModules],
  sourcemap: true,
  logLevel: 'info',
})
console.log(`built client half: ${id} → lib/client.js`)
