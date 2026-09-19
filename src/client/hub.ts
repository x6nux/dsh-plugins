/**
 * Pure logic behind the plugin hub page: read the catalogue, decide each
 * plugin's state against what is installed, and build the install spec.
 *
 * Kept free of DSH and React so the decisions that matter — is this out of
 * date, what exactly gets handed to pnpm — are testable on their own.
 *
 * @module dsh-x6nux-plugin-hub/client/hub
 */

/*
 * The harness shapes below are declared here rather than imported from
 * `@deepseek-ai/dsh-api-remotes/client`. `@deepseek-ai/dsh-plugin-manager` —
 * which contributes `BundleInfo`, `ChangeResult` and the `pluginManager`
 * remote — first shipped in `0.1.6-alpha.2`, so importing those names would
 * stop this plugin from compiling against the two releases before it, on which
 * it still has a job to do (see {@link mergeInventoryRows}).
 *
 * Only the fields this page reads are declared, so a harness that adds fields
 * stays compatible. `scripts/compat-probe.mjs` checks each supported release
 * still carries the methods these shapes are handed to, which is the part tsc
 * can no longer see.
 */

/** One installed bundle, as `pluginManager.listBundles()` reports it. */
export interface BundleInfo {
  readonly name: string
  readonly version?: string
  readonly enabled: boolean
  /** False for a bundle the profile knows of but does not hold. */
  readonly installed: boolean
  readonly removable: boolean
  /** Why the harness refuses to change this bundle, when it does. */
  readonly readOnlyReason?: string
}

/** What a `pluginManager` mutation answers with. */
export interface ChangeResult {
  readonly application: 'applied' | 'restart-required' | 'overridden' | 'failed' | 'cancelled'
  readonly error?: { readonly code?: string; readonly diagnostic?: string }
  /** Packages whose install scripts pnpm refused to run. */
  readonly pendingBuilds?: readonly string[]
}

/** One Loader entry in the read-only inventory every supported release offers. */
export interface InventoryEntry {
  /** Module specifier the Loader entry imports, which is the package name. */
  readonly moduleName: string
  readonly enabled: boolean
  /** Root-fiber lifecycle, `'failed'` when the entry threw while loading. */
  readonly fiberPhase: 'pending' | 'loading' | 'active' | 'failed' | 'unloading' | null
}

/** The `pluginInventory.list()` snapshot. */
export interface InventorySnapshot {
  readonly entries: readonly InventoryEntry[]
}

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
  /** Installed, but the source of truth reports no version to compare. */
  | { kind: 'unknown-version' }
  /** Installed, and its root fiber threw while loading. */
  | { kind: 'failed' }

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
 * Join the catalogue with the read-only Loader inventory.
 *
 * This is what the page has to work with on a release without
 * `pluginManager`: the inventory names the module each Loader entry imports
 * and whether it is enabled, but carries no version, so an installed plugin
 * can only be reported as present, not as out of date. Every row is marked
 * unremovable because nothing here can change the profile.
 *
 * @param manifest - the catalogue.
 * @param snapshot - `pluginInventory.list()` result.
 * @returns one row per catalogue entry, catalogue order preserved.
 */
export function mergeInventoryRows(manifest: Manifest, snapshot: InventorySnapshot): HubRow[] {
  const byModule = new Map(snapshot.entries.map(entry => [entry.moduleName, entry]))
  return manifest.plugins.map((plugin) => {
    const entry = byModule.get(plugin.package)
    if (entry === undefined) {
      return { entry: plugin, status: { kind: 'not-installed' }, enabled: false, removable: false }
    }
    return {
      entry: plugin,
      status: entry.fiberPhase === 'failed' ? { kind: 'failed' } : { kind: 'unknown-version' },
      enabled: entry.enabled,
      removable: false,
    }
  })
}

/**
 * The `dsh plugin` command that installs or updates one plugin.
 *
 * `dsh plugin --profile <name> <args>` forwards its arguments to pnpm in the
 * profile directory, so this is a pnpm `add` of the same spec the managed path
 * hands to `installBundle` — cache-buster included, for the same reason.
 *
 * @param entry - catalogue entry.
 * @param profile - profile name, `web` unless the deployment renamed it.
 * @returns the command to copy.
 */
export function installCommand(entry: ManifestEntry, profile = 'web'): string {
  return `dsh plugin --profile ${profile} add '${installSpec(entry)}'`
}

/**
 * The `dsh plugin` command that removes one plugin.
 * @param entry - catalogue entry.
 * @param profile - profile name.
 * @returns the command to copy.
 */
export function removeCommand(entry: ManifestEntry, profile = 'web'): string {
  return `dsh plugin --profile ${profile} remove ${entry.package}`
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
