/**
 * The page's seam onto the harness.
 *
 * Two releases are in play. `0.1.6-alpha.2` carries the `pluginManager`
 * remote, which installs, removes and switches bundles; the two before it
 * carry only `pluginInventory`, a read-only snapshot of the Loader entries.
 * The page therefore runs in one of two modes, decided here by what the
 * harness actually exposes rather than by a version string.
 *
 * Both namespaces are read off `ctx.remote` at call time instead of being
 * captured through an injection callback: the remote service is a declared
 * dependency, so it is already mounted when the page renders, and reading it
 * late means no ordering assumption can go stale.
 *
 * @module dsh-x6nux-plugin-hub/client/hub-controller
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: the assembly's own Context merge, which every supported release
// ships. `RemoteResult` comes from it rather than from the Typert protocol
// package directly, which this plugin does not depend on.
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import {
  describeChange,
  fetchManifest,
  installSpec,
  mergeInventoryRows,
  mergeRows,
  MANIFEST_URL,
} from './hub.ts'
import type { BundleInfo, ChangeResult, HubRow, InventorySnapshot, Manifest, Outcome } from './hub.ts'

/** What a row's buttons can ask for. Install and update are the same call. */
export type HubAction = 'install' | 'update' | 'remove' | 'enable' | 'disable'

/** Raised when the harness exposes neither plugin namespace. */
export class ManagementUnavailable extends Error {
  constructor() {
    super('this harness exposes no plugin namespace')
    this.name = 'ManagementUnavailable'
  }
}

/** The methods of `remote.pluginManager` this page calls. */
interface PluginManagerFace {
  listBundles: () => Promise<RemoteResult<readonly BundleInfo[]>>
  installBundle: (
    spec: string,
    options: { enabled?: boolean; approvedBuilds?: string[] },
  ) => Promise<RemoteResult<ChangeResult>>
  removeBundle: (name: string) => Promise<RemoteResult<ChangeResult>>
  setBundleEnabled: (name: string, enabled: boolean) => Promise<RemoteResult<ChangeResult>>
}

/** The method of `remote.pluginInventory` this page calls. */
interface PluginInventoryFace {
  list: () => Promise<RemoteResult<InventorySnapshot>>
}

/** How much the harness lets this page do. */
export type HubMode =
  /** `pluginManager` is present: every action works. */
  | 'manage'
  /** Only `pluginInventory`: rows are readable, changes need the CLI. */
  | 'read-only'

/** One page load. */
export interface HubView {
  mode: HubMode
  rows: HubRow[]
}

/** The face handed to the section component. */
export interface HubFace {
  /** Read the catalogue and the local state, merged into rows. */
  load: () => Promise<HubView>
  /**
   * Run one action. Only valid in `manage` mode.
   * @param approvedBuilds - package names to approve install scripts for,
   *   taken from a previous `build-blocked` failure.
   */
  act: (action: HubAction, row: HubRow, approvedBuilds?: readonly string[]) => Promise<Outcome>
  /** Subscribe to the harness's own change notifications. */
  onChanged: (listener: () => void) => () => void
}

/** Options, all injected so tests need neither network nor a harness. */
export interface HubFaceOptions {
  manifestUrl?: string
  fetchImpl?: typeof fetch
}

/**
 * Read one remote namespace by name.
 *
 * Declaration-merged namespaces are properties of the remote service, and
 * `pluginManager` is absent from two of the three supported releases, so its
 * name cannot be written as a typed property access.
 *
 * @param ctx - client root context.
 * @param name - namespace name.
 * @returns the namespace, or undefined on a harness without it.
 */
function namespaceOf<T>(ctx: ClientContext, name: string): T | undefined {
  const remote = ctx.remote as unknown as Record<string, T | undefined>
  return remote[name]
}

/**
 * Build the page's face.
 *
 * @param ctx - client root context.
 * @param options - manifest location and fetch override.
 * @returns the face, valid for the lifetime of `ctx`.
 */
export function createHubFace(ctx: ClientContext, options: HubFaceOptions = {}): HubFace {
  const manifestUrl = options.manifestUrl ?? MANIFEST_URL
  const fetchImpl = options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init))
  const manager = (): PluginManagerFace | undefined => namespaceOf<PluginManagerFace>(ctx, 'pluginManager')

  /** The management face, or a typed refusal the page can render. */
  const required = (): PluginManagerFace => {
    const face = manager()
    if (face === undefined) throw new ManagementUnavailable()
    return face
  }

  const load = async (): Promise<HubView> => {
    // The catalogue is read first so a harness that manages nothing still
    // shows what exists, with each row's local state filled in as far as it
    // can be.
    const manifest: Manifest = await fetchManifest(fetchImpl, manifestUrl)
    const managing = manager()
    if (managing !== undefined) {
      const listed = await managing.listBundles()
      if (!listed.ok) throw new Error('the harness refused to list installed plugins')
      return { mode: 'manage', rows: mergeRows(manifest, listed.value) }
    }
    const inventory = namespaceOf<PluginInventoryFace>(ctx, 'pluginInventory')
    if (inventory === undefined) throw new ManagementUnavailable()
    const snapshot = await inventory.list()
    if (!snapshot.ok) throw new Error('the harness refused to list the plugin inventory')
    return { mode: 'read-only', rows: mergeInventoryRows(manifest, snapshot.value) }
  }

  const act = async (
    action: HubAction,
    row: HubRow,
    approvedBuilds?: readonly string[],
  ): Promise<Outcome> => {
    const pluginManager = required()
    const result = await (action === 'install' || action === 'update'
      ? pluginManager.installBundle(installSpec(row.entry), {
        enabled: true,
        ...approvedBuilds === undefined || approvedBuilds.length === 0 ? {} : { approvedBuilds: [...approvedBuilds] },
      })
      : action === 'remove'
        ? pluginManager.removeBundle(row.entry.package)
        : pluginManager.setBundleEnabled(row.entry.package, action === 'enable'))
    if (!result.ok) throw new Error(`the harness refused the ${action} request`)
    return describeChange(result.value)
  }

  // Only the managing harness forwards this event, and only it can produce a
  // change worth reloading for, so a read-only harness subscribes to nothing.
  const onChanged = (listener: () => void): (() => void) => {
    if (manager() === undefined) return () => {}
    const on = ctx.remote.$on as unknown as (event: string, handler: () => void) => () => void
    return on('plugin-manager/changed', () => { listener() })
  }

  return { load, act, onChanged }
}
