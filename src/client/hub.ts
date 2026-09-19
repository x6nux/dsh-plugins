/**
 * Pure logic behind the plugin hub page: read the catalogue, decide each
 * plugin's state against what is installed, and build the install spec.
 *
 * Kept free of DSH and React so the decisions that matter — is this out of
 * date, what exactly gets handed to pnpm — are testable on their own.
 *
 * @module dsh-x6nux-plugin-hub/client/hub
 */

import type { BundleInfo, ChangeResult } from '@deepseek-ai/dsh-api-remotes/client'

/** Where the catalogue lives; the repository's own copy on the default branch. */
export const MANIFEST_URL = 'https://raw.githubusercontent.com/x6nux/dsh-plugins/main/plugins.json'

/** One plugin as the catalogue describes it. */
export interface ManifestEntry {
  /** Release tag prefix, also the branch suffix. */
  id: string
  /** npm package name, which is what the harness lists installed bundles by. */
  package: string
  name: string
  description: string
  /** Version the rolling release currently holds. */
  version: string
  /** Fixed asset URL of the rolling release. */
  tarball: string
}

/** The catalogue document. */
export interface Manifest {
  repository: string
  plugins: readonly ManifestEntry[]
}

/** What the page shows for one catalogue entry. */
export type HubStatus =
  | { kind: 'not-installed' }
  | { kind: 'current' }
  | { kind: 'outdated'; installed: string }
  /** Installed, but the bundle reports no version to compare. */
  | { kind: 'unknown-version' }

/** One rendered row: the catalogue entry plus the local facts. */
export interface HubRow {
  entry: ManifestEntry
  status: HubStatus
  enabled: boolean
  removable: boolean
  /** Why the harness refuses to manage this bundle, when it does. */
  readOnlyReason?: string
}

/** Split a semver string into comparable parts. */
function parseVersion(version: string) {
  const [core = '', prerelease] = version.split('-')
  const [major = 0, minor = 0, patch = 0] = core.split('.').map(Number)
  if (prerelease === undefined) return { major, minor, patch, tag: '', ordinal: 0, stable: true }
  const [tag = '', ordinal = '0'] = prerelease.split('.')
  return { major, minor, patch, tag, ordinal: Number(ordinal), stable: false }
}

/**
 * Order two versions oldest first. A stable release outranks any prerelease of
 * the same core version; prerelease tags order alphabetically, which is the
 * intended `alpha < beta < rc`.
 * @param a - left version.
 * @param b - right version.
 * @returns negative when `a` is older, positive when newer, zero when equal.
 */
export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a)
  const right = parseVersion(b)
  if (left.major !== right.major) return left.major - right.major
  if (left.minor !== right.minor) return left.minor - right.minor
  if (left.patch !== right.patch) return left.patch - right.patch
  if (left.stable !== right.stable) return left.stable ? 1 : -1
  if (left.tag !== right.tag) return left.tag < right.tag ? -1 : 1
  return left.ordinal - right.ordinal
}

/**
 * Read the catalogue.
 *
 * A timestamp is appended because raw.githubusercontent serves
 * `cache-control: max-age=300`; without it a release published minutes ago
 * still looks unavailable.
 *
 * @param fetchImpl - the fetch to use; injected so tests need no network.
 * @param url - catalogue location.
 * @param now - clock, for a deterministic cache-buster in tests.
 * @returns the parsed catalogue.
 * @throws If the response is not ok or does not hold a plugin array.
 */
export async function fetchManifest(
  fetchImpl: typeof fetch,
  url: string = MANIFEST_URL,
  now: () => number = Date.now,
): Promise<Manifest> {
  const response = await fetchImpl(`${url}?t=${String(now())}`)
  if (!response.ok) throw new Error(`catalogue request failed with ${String(response.status)}`)
  const document = await response.json() as Partial<Manifest>
  if (!Array.isArray(document.plugins)) throw new Error('catalogue holds no plugin list')
  return { repository: document.repository ?? '', plugins: document.plugins }
}

/**
 * Join the catalogue with the harness's installed bundles.
 *
 * Only catalogue entries become rows: the page manages this repository's
 * plugins and deliberately leaves everything else in the profile alone,
 * including bundles the harness itself ships and refuses to remove.
 *
 * @param manifest - the catalogue.
 * @param bundles - `pluginManager.listBundles()` result.
 * @returns one row per catalogue entry, catalogue order preserved.
 */
export function mergeRows(manifest: Manifest, bundles: readonly BundleInfo[]): HubRow[] {
  const byName = new Map(bundles.map(bundle => [bundle.name, bundle]))
  return manifest.plugins.map((entry) => {
    const bundle = byName.get(entry.package)
    return {
      entry,
      status: statusOf(entry, bundle),
      enabled: bundle?.enabled ?? false,
      removable: bundle?.removable ?? false,
      ...bundle?.readOnlyReason === undefined ? {} : { readOnlyReason: bundle.readOnlyReason },
    }
  })
}

/** Decide one row's state. A bundle present but not installed by the profile counts as absent. */
function statusOf(entry: ManifestEntry, bundle: BundleInfo | undefined): HubStatus {
  if (bundle === undefined || !bundle.installed) return { kind: 'not-installed' }
  if (bundle.version === undefined || bundle.version.length === 0) return { kind: 'unknown-version' }
  if (compareVersions(bundle.version, entry.version) < 0) return { kind: 'outdated', installed: bundle.version }
  return { kind: 'current' }
}

/**
 * The spec handed to `installBundle`, for a first install and an update alike.
 *
 * The query string is what makes an update work at all: pnpm indexes its
 * tarball store by URL and serves an unchanged URL from that store without
 * asking the remote, so the fixed rolling-release address alone would keep
 * reinstalling the copy already on disk. The value only has to change between
 * versions, so the catalogue's version is used.
 *
 * @param entry - catalogue entry.
 * @returns the install spec.
 */
export function installSpec(entry: ManifestEntry): string {
  return `${entry.tarball}?v=${entry.version}`
}

/** What a mutation did, reduced to what the page has to say about it. */
export type Outcome =
  | { kind: 'applied' }
  /** Saved, but not live until the harness restarts. */
  | { kind: 'restart-required' }
  | { kind: 'overridden' }
  | { kind: 'cancelled' }
  | { kind: 'failed'; code?: string; diagnostic?: string; pendingBuilds?: readonly string[] }

/**
 * Read a `ChangeResult`.
 *
 * The remote does not throw on a domain failure — it answers with
 * `application: 'failed'` and an error code — so a caller that only catches
 * exceptions would report every refusal as a success.
 *
 * @param result - the mutation result.
 * @returns the outcome to render.
 */
export function describeChange(result: ChangeResult): Outcome {
  switch (result.application) {
    case 'applied':
      return { kind: 'applied' }
    case 'restart-required':
      return { kind: 'restart-required' }
    case 'overridden':
      return { kind: 'overridden' }
    case 'cancelled':
      return { kind: 'cancelled' }
    default:
      return {
        kind: 'failed',
        ...result.error?.code === undefined ? {} : { code: result.error.code },
        ...result.error?.diagnostic === undefined ? {} : { diagnostic: result.error.diagnostic },
        ...result.pendingBuilds === undefined || result.pendingBuilds.length === 0
          ? {}
          : { pendingBuilds: result.pendingBuilds },
      }
  }
}
