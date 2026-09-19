/**
 * Read and write a plugin's supported DSH release list.
 *
 * The single source of truth is the plugin's own `peerDependencies`: every
 * `@deepseek-ai/dsh-*` peer carries the same explicit `a || b || c` range, and
 * a package manager resolves against exactly that, so it has to stay correct.
 * Any second copy of the list would drift from it. `README.md` holds a
 * human-readable line derived from the same source and is rewritten in step.
 *
 * Explicit enumeration is required rather than a range: node-semver only lets
 * a prerelease satisfy a comparator whose [major, minor, patch] tuple matches
 * and which itself carries a prerelease, so `>=0.1.5-rc.1 <0.1.7` matches
 * `0.1.5-rc.2` but not `0.1.6-alpha.1`. Every DSH release to date is a
 * prerelease.
 */

import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Peers whose version tracks the installed harness release. */
const DSH_PEER = /^@deepseek-ai\/dsh-/

/** Heading of the README section that restates the list for humans. */
const README_HEADING = '## 兼容的 DSH 版本'

/** A line listing versions as `` `a`、`b` `` — the shape written under the heading. */
const README_LIST = /^`[^`\n]+`(?:、`[^`\n]+`)*$/m

/**
 * Split one semver string into comparable parts.
 * @param version - release string such as `0.1.6-alpha.2`.
 * @returns core numbers plus the prerelease tag and its ordinal.
 */
function parseVersion(version) {
  const [core, prerelease] = version.split('-')
  const [major = 0, minor = 0, patch = 0] = core.split('.').map(Number)
  if (prerelease === undefined) return { major, minor, patch, tag: '', ordinal: 0, stable: true }
  const [tag = '', ordinal = '0'] = prerelease.split('.')
  return { major, minor, patch, tag, ordinal: Number(ordinal), stable: false }
}

/**
 * Order two DSH releases oldest first. A stable release outranks any
 * prerelease of the same core version; prerelease tags order alphabetically,
 * which happens to be the intended `alpha < beta < rc`.
 * @param a - left release string.
 * @param b - right release string.
 * @returns negative when `a` is older, positive when newer, zero when equal.
 */
export function compareVersions(a, b) {
  const left = parseVersion(a)
  const right = parseVersion(b)
  for (const key of ['major', 'minor', 'patch']) {
    if (left[key] !== right[key]) return left[key] - right[key]
  }
  if (left.stable !== right.stable) return left.stable ? 1 : -1
  if (left.tag !== right.tag) return left.tag < right.tag ? -1 : 1
  return left.ordinal - right.ordinal
}

/**
 * Load one plugin manifest as both text and parsed object. The text is kept so
 * a rewrite can be a targeted string replacement that preserves key order and
 * formatting instead of re-serializing the whole document.
 * @param projectDir - plugin project root.
 * @returns manifest path, raw text, and parsed object.
 */
export async function readManifest(projectDir) {
  const path = join(projectDir, 'package.json')
  const text = await readFile(path, 'utf8')
  return { path, text, json: JSON.parse(text) }
}

/**
 * The DSH releases one plugin declares support for.
 * @param projectDir - plugin project root.
 * @returns releases oldest first.
 * @throws If the harness peers do not all carry the same range, which means a
 *   hand edit missed one and the plugin would install against an untested
 *   release.
 */
export async function readSupported(projectDir) {
  const { json } = await readManifest(projectDir)
  const peers = Object.entries(json.peerDependencies ?? {}).filter(([name]) => DSH_PEER.test(name))
  if (peers.length === 0) throw new Error(`${projectDir}: no @deepseek-ai/dsh-* peer dependencies`)
  const ranges = new Set(peers.map(([, range]) => range))
  if (ranges.size > 1) {
    const detail = peers.map(([name, range]) => `  ${name}: ${range}`).join('\n')
    throw new Error(`${projectDir}: harness peer ranges disagree; one edit missed a peer:\n${detail}`)
  }
  return [...ranges][0].split('||').map(part => part.trim()).filter(part => part.length > 0).sort(compareVersions)
}

/**
 * Rewrite the supported list in the manifest and the README.
 * @param projectDir - plugin project root.
 * @param versions - full replacement list; order does not matter.
 * @returns the normalized range string that was written.
 */
export async function writeSupported(projectDir, versions) {
  const ordered = [...new Set(versions)].sort(compareVersions)
  const range = ordered.join(' || ')
  const { path, text, json } = await readManifest(projectDir)
  const previous = await readSupported(projectDir)
  let next = text
  for (const name of Object.keys(json.peerDependencies ?? {})) {
    if (!DSH_PEER.test(name)) continue
    const needle = `"${name}": "${previous.join(' || ')}"`
    if (!next.includes(needle)) throw new Error(`${path}: could not locate the range for ${name}`)
    next = next.replace(needle, `"${name}": "${range}"`)
  }
  await writeFile(path, next)
  await writeReadme(projectDir, ordered)
  return range
}

/**
 * Replace the version list under the README's compatibility heading.
 * @param projectDir - plugin project root.
 * @param ordered - releases oldest first.
 */
async function writeReadme(projectDir, ordered) {
  const path = join(projectDir, 'README.md')
  const text = await readFile(path, 'utf8')
  const start = text.indexOf(README_HEADING)
  if (start < 0) throw new Error(`${path}: missing "${README_HEADING}" section`)
  const head = text.slice(0, start)
  const body = text.slice(start)
  const match = README_LIST.exec(body)
  if (match === null) throw new Error(`${path}: no version list line under "${README_HEADING}"`)
  const listed = ordered.map(version => `\`${version}\``).join('、')
  await writeFile(path, head + body.slice(0, match.index) + listed + body.slice(match.index + match[0].length))
}
