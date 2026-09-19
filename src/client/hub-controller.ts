/**
 * The page's seam onto the harness. Every mutation is a `pluginManager` call —
 * that remote is part of the `dsh-api-remotes` assembly, so there is no
 * contract to mount and no Host code behind this.
 *
 * @module dsh-x6nux-plugin-hub/client/hub-controller
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { describeChange, fetchManifest, installSpec, mergeRows, MANIFEST_URL } from './hub.ts'
import type { HubRow, Manifest, Outcome } from './hub.ts'

/** What a row's buttons can ask for. Install and update are the same call. */
export type HubAction = 'install' | 'update' | 'remove' | 'enable' | 'disable'

/** Raised when the harness exposes no plugin management. */
export class ManagementUnavailable extends Error {
  constructor() {
    super('plugin management is not available in this harness')
    this.name = 'ManagementUnavailable'
  }
}

/** The face handed to the section component. */
export interface HubFace {
  /** Read the catalogue and the installed bundles, merged into rows. */
  load: () => Promise<HubRow[]>
  /**
   * Run one action.
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
 * Build the page's face.
 *
 * `remote.pluginManager` is injected softly rather than declared on the
 * plugin's `inject`: a harness without management should still show this page
 * with an explanation, not drop the plugin entirely.
 *
 * @param ctx - client root context.
 * @param options - manifest location and fetch override.
 * @returns the face, valid for the lifetime of `ctx`.
 */
export function createHubFace(ctx: ClientContext, options: HubFaceOptions = {}): HubFace {
  const manifestUrl = options.manifestUrl ?? MANIFEST_URL
  const fetchImpl = options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init))
  let manager: ClientContext['remote']['pluginManager'] | undefined

  ctx.inject(['remote.pluginManager'], (ready) => {
    manager = ready.remote.pluginManager
    /* v8 ignore next 2 -- fiber teardown never runs in unit tests */
    ready.effect(() => () => { manager = undefined }, 'plugin-hub: management seam')
  })

  /** The live management face, or a typed refusal the page can render. */
  const required = (): NonNullable<typeof manager> => {
    if (manager === undefined) throw new ManagementUnavailable()
    return manager
  }

  const load = async (): Promise<HubRow[]> => {
    // The catalogue is read first so a harness without management still shows
    // what exists, with the rows marked not-installed.
    const manifest: Manifest = await fetchManifest(fetchImpl, manifestUrl)
    const listed = await required().listBundles()
    if (!listed.ok) throw new Error('the harness refused to list installed plugins')
    return mergeRows(manifest, listed.value)
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

  const onChanged = (listener: () => void): (() => void) => ctx.remote.$on('plugin-manager/changed', () => { listener() })

  return { load, act, onChanged }
}
