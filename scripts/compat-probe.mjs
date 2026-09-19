/**
 * Runtime probe for `compat-verify`'s second layer: which plugin namespace
 * does this harness's Client assembly actually carry?
 *
 * `src/client/hub-controller.ts` reaches for `remote.pluginManager` and
 * `remote.pluginInventory` by name through a cast, because `pluginManager`
 * only exists from `0.1.6-alpha.2` on and naming its types would stop the
 * plugin compiling against the releases before it. tsc therefore cannot check
 * either access, and this probe is what does.
 *
 * The Typert descriptors are literals in the assembled Client bundle, so the
 * namespace/method pairs are read straight out of it — that is the same table
 * the browser builds its remote namespaces from.
 *
 * Passing means one of two things is true:
 *
 * - `pluginManager` carries the four methods the page calls, so every action
 *   works (`manage` mode);
 * - or `pluginInventory/list` is there, so the page can still show state and
 *   print the CLI commands (`read-only` mode).
 *
 * Losing both would leave the page with nothing to say, which is a
 * compatibility break this plugin should not claim.
 *
 * Run from the plugin project root with dependencies installed.
 */
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/** The `pluginManager` methods `hub-controller.ts` calls. */
const MANAGE = ['listBundles', 'installBundle', 'removeBundle', 'setBundleEnabled']

const require = createRequire(resolve('package.json'))
const bundle = readFileSync(require.resolve('@deepseek-ai/dsh-api-remotes/client'), 'utf8')

/** Every `namespace/method` pair the assembly declares. */
const pairs = new Set()
for (const match of bundle.matchAll(/namespace:\s*"([^"]+)",\s*method:\s*"([^"]+)"/g)) {
  pairs.add(`${match[1]}/${match[2]}`)
}
if (pairs.size === 0) {
  console.error('no Typert descriptors found in @deepseek-ai/dsh-api-remotes/client; the probe cannot read this build')
  process.exit(1)
}

const missing = MANAGE.filter(method => !pairs.has(`pluginManager/${method}`))
if (missing.length === 0) {
  console.log(`pluginManager present with ${MANAGE.join(', ')} — full management`)
} else if (pairs.has('pluginInventory/list')) {
  console.log(`pluginManager absent (no ${missing.join(', ')}); pluginInventory/list present — read-only page`)
} else {
  console.error('the assembly carries neither a usable pluginManager nor pluginInventory/list;'
    + ' the page would have nothing to read or change')
  process.exit(1)
}
