/**
 * Record a plugin's released version in `plugins.json`.
 *
 * ```
 * node scripts/update-manifest.mjs --plugin opencode --project <插件目录>
 * ```
 *
 * The manifest is what the plugin-hub settings page reads to decide whether an
 * installed plugin is out of date, so it has to name the version that is
 * actually on the rolling release. Release runs it right after publishing and
 * commits the result; nothing else writes it.
 *
 * Prints `updated` or `unchanged` so the caller can skip an empty commit.
 */

import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readManifest } from './compat-versions.mjs'

/** Where the rolling asset for one plugin lives. */
function tarballUrl(repository, plugin, packageName) {
  return `https://github.com/${repository}/releases/download/${plugin}-latest/${packageName}.tgz`
}

/**
 * Merge one plugin's current manifest into the catalogue.
 * @param catalogue - parsed `plugins.json`.
 * @param plugin - plugin id, which is also the release tag prefix.
 * @param manifest - the plugin's own parsed `package.json`.
 * @returns whether anything changed.
 */
export function mergePlugin(catalogue, plugin, manifest) {
  const index = catalogue.plugins.findIndex(row => row.id === plugin)
  const previous = index < 0 ? undefined : catalogue.plugins[index]
  // `name` and `description` are the labels the settings page shows. They are
  // curated in the catalogue — the package manifest's own description is in
  // English for npm — so an existing one is kept and only a new plugin falls
  // back to the manifest.
  const entry = {
    id: plugin,
    package: manifest.name,
    name: previous?.name ?? manifest.name,
    description: previous?.description ?? manifest.description ?? '',
    version: manifest.version,
    tarball: tarballUrl(catalogue.repository, plugin, manifest.name),
  }
  if (previous !== undefined && JSON.stringify(previous) === JSON.stringify(entry)) return false
  if (index < 0) catalogue.plugins.push(entry)
  else catalogue.plugins[index] = entry
  catalogue.plugins.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
  return true
}

/** Parse argv into options. */
function parseArgs(argv) {
  const options = { manifest: resolve('plugins.json'), plugin: undefined, project: process.cwd() }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--manifest') options.manifest = resolve(argv[index += 1])
    else if (argument === '--plugin') options.plugin = argv[index += 1]
    else if (argument === '--project') options.project = resolve(argv[index += 1])
    else throw new Error(`unknown argument: ${argument}`)
  }
  if (options.plugin === undefined) throw new Error('missing --plugin')
  return options
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const options = parseArgs(process.argv.slice(2))
  const catalogue = JSON.parse(await readFile(options.manifest, 'utf8'))
  const { json } = await readManifest(options.project)
  if (mergePlugin(catalogue, options.plugin, json)) {
    await writeFile(options.manifest, `${JSON.stringify(catalogue, null, 2)}\n`)
    process.stdout.write('updated\n')
  } else {
    process.stdout.write('unchanged\n')
  }
}
