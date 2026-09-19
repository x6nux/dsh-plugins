/**
 * Exercise a tarball installed in a separate consumer through Cordis's real
 * package resolver.
 *
 * This plugin has no Host adapter to stream through, so the smoke proves the
 * two things that can actually break on a harness release: the Host entry
 * imports and applies through the real Loader (a missing or renamed export
 * fails here, the way a bad import failed at load on 0.1.5), and the published
 * browser bundle registers itself under the package name.
 */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { dirname, resolve } from 'node:path'
import { runInNewContext } from 'node:vm'

const consumer = resolve(process.argv[2] ?? '.')
const require = createRequire(resolve(consumer, 'package.json'))
const { name: packageName } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
)
const entry = require.resolve(packageName)
const fromPlugin = createRequire(entry)
const load = id => import(pathToFileURL(fromPlugin.resolve(id)).href)
const { Context } = await load('@deepseek-ai/cordis')
const { default: Loader } = await import(
  pathToFileURL(require.resolve('@deepseek-ai/cordis-plugin-loader')).href
)

const ctx = new Context()
ctx.baseUrl = pathToFileURL(resolve(consumer, 'package.json')).href
await ctx.plugin(Loader)

// Host half: the Loader resolves, imports and applies the installed module.
const mounted = await ctx.loader.create({ name: packageName })
assert.ok(typeof mounted === 'string' && mounted.length > 0, 'loader returned no entry id')
const hostModule = await load(packageName)
assert.equal(hostModule.name, 'plugin-hub')
assert.equal(typeof hostModule.apply, 'function')

// Browser half: the banner registers the factory under the package name. The
// factory itself is not invoked — that needs the harness module table.
const clientPath = resolve(dirname(entry), 'client.js')
let registration
runInNewContext(readFileSync(clientPath, 'utf8'), {
  window: { __ModuleLoader__: { load: value => { registration = value } } },
})
assert.equal(registration?.id, packageName)
assert.equal(typeof registration?.factory, 'function')

await ctx.loader.remove(mounted)
console.log('PASS: installed package resolution, Host apply through the real Loader, browser registration, unload')
