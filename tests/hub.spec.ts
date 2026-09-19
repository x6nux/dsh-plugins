/** The decisions the page makes before it touches the harness. */
import { describe, expect, it, vi } from 'vitest'
import type {
  BundleInfo as HostBundleInfo,
  ChangeResult as HostChangeResult,
  PluginInventorySnapshot,
} from '@deepseek-ai/dsh-api-remotes/client'
import {
  compareVersions,
  describeChange,
  fetchManifest,
  installCommand,
  installSpec,
  mergeInventoryRows,
  mergeRows,
  removeCommand,
} from '../src/client/hub.ts'
import type {
  BundleInfo,
  ChangeResult,
  InventorySnapshot,
  Manifest,
  ManifestEntry,
} from '../src/client/hub.ts'

/**
 * Compile-time assertion, never called: the harness shapes this plugin
 * declares structurally must still accept the real ones.
 *
 * `hub.ts` declares them itself because `pluginManager` — and with it
 * `BundleInfo` and `ChangeResult` — only exists from `0.1.6-alpha.2` on, while
 * the plugin compiles against two releases before that. This file is checked
 * by `tsconfig.test.json` against the development harness alone, so a field
 * renamed upstream fails here rather than silently reading `undefined` in the
 * browser.
 */
function assertHostShapes(
  bundle: HostBundleInfo,
  change: HostChangeResult,
  snapshot: PluginInventorySnapshot,
): [BundleInfo, ChangeResult, InventorySnapshot] {
  return [bundle, change, snapshot]
}
void assertHostShapes

const opencode: ManifestEntry = {
  id: 'opencode',
  package: 'dsh-x6nux-opencode',
  name: 'OpenCode Go',
  description: '订阅模型',
  version: '0.2.1',
  tarball: 'https://example.invalid/releases/download/opencode-latest/dsh-x6nux-opencode.tgz',
}

const manifest: Manifest = { repository: 'x6nux/dsh-plugins', plugins: [opencode] }

function bundle(overrides: Partial<BundleInfo> = {}): BundleInfo {
  return { name: opencode.package, enabled: true, installed: true, removable: true, ...overrides }
}

function change(overrides: Partial<ChangeResult> = {}): ChangeResult {
  return { application: 'applied', ...overrides }
}

/** One Loader entry as the read-only inventory reports it. */
function inventory(entries: InventorySnapshot['entries']): InventorySnapshot {
  return { entries }
}

describe('compareVersions', () => {
  it('orders prereleases before the stable release of the same core version', () => {
    const shuffled = ['0.2.1', '0.2.1-rc.1', '0.2.1-alpha.2', '0.2.1-alpha.10', '0.2.0']
    expect([...shuffled].sort(compareVersions)).toEqual([
      '0.2.0', '0.2.1-alpha.2', '0.2.1-alpha.10', '0.2.1-rc.1', '0.2.1',
    ])
  })

  it('compares prerelease ordinals numerically, not as text', () => {
    expect(compareVersions('0.1.6-alpha.2', '0.1.6-alpha.10')).toBeLessThan(0)
  })
})

describe('fetchManifest', () => {
  it('busts the raw cache so a release published minutes ago is visible', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(Response.json(manifest)))
    const result = await fetchManifest(fetchImpl as unknown as typeof fetch, 'https://example.invalid/plugins.json', () => 1234)
    expect(fetchImpl).toHaveBeenCalledWith('https://example.invalid/plugins.json?t=1234')
    expect(result.plugins[0]?.package).toBe(opencode.package)
  })

  it('rejects a non-ok response', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(new Response('nope', { status: 404 })))
    await expect(fetchManifest(fetchImpl as unknown as typeof fetch, 'https://example.invalid/x.json'))
      .rejects.toThrow(/404/)
  })

  it('rejects a document without a plugin list', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(Response.json({ repository: 'x' })))
    await expect(fetchManifest(fetchImpl as unknown as typeof fetch, 'https://example.invalid/x.json'))
      .rejects.toThrow(/no plugin list/)
  })
})

describe('mergeRows', () => {
  it('reports a plugin the profile does not hold as not installed', () => {
    const [row] = mergeRows(manifest, [])
    expect(row?.status).toEqual({ kind: 'not-installed' })
    expect(row?.enabled).toBe(false)
    expect(row?.removable).toBe(false)
  })

  it('reports an older installed version as outdated, naming both versions', () => {
    const [row] = mergeRows(manifest, [bundle({ version: '0.2.0' })])
    expect(row?.status).toEqual({ kind: 'outdated', installed: '0.2.0' })
  })

  it('reports a matching version as current', () => {
    const [row] = mergeRows(manifest, [bundle({ version: '0.2.1' })])
    expect(row?.status).toEqual({ kind: 'current' })
  })

  it('does not call a newer installed version outdated', () => {
    const [row] = mergeRows(manifest, [bundle({ version: '0.3.0' })])
    expect(row?.status).toEqual({ kind: 'current' })
  })

  it('reports a bundle with no version separately from an outdated one', () => {
    const [row] = mergeRows(manifest, [bundle({ version: undefined })])
    expect(row?.status).toEqual({ kind: 'unknown-version' })
  })

  it('treats a bundle the profile does not own as not installed', () => {
    const [row] = mergeRows(manifest, [bundle({ installed: false, version: '0.2.1' })])
    expect(row?.status).toEqual({ kind: 'not-installed' })
  })

  it('carries enabled, removable and the read-only reason through', () => {
    const [row] = mergeRows(manifest, [
      bundle({ version: '0.2.1', enabled: false, removable: false, readOnlyReason: 'management-required' }),
    ])
    expect(row?.enabled).toBe(false)
    expect(row?.removable).toBe(false)
    expect(row?.readOnlyReason).toBe('management-required')
  })

  it('ignores bundles the catalogue does not name', () => {
    const rows = mergeRows(manifest, [bundle({ name: '@deepseek-ai/dsh-llm', version: '1.0.0' })])
    expect(rows).toHaveLength(1)
    expect(rows[0]?.status).toEqual({ kind: 'not-installed' })
  })
})

describe('mergeInventoryRows', () => {
  // The fallback for a harness without pluginManager: the inventory names the
  // module and whether it is enabled, and carries no version at all.
  it('reports an installed plugin as present but of unknown version', () => {
    const [row] = mergeInventoryRows(manifest, inventory([
      { moduleName: opencode.package, enabled: true, fiberPhase: 'active' },
    ]))
    expect(row?.status).toEqual({ kind: 'unknown-version' })
    expect(row?.enabled).toBe(true)
  })

  it('never offers removal, because nothing here can change the profile', () => {
    const [row] = mergeInventoryRows(manifest, inventory([
      { moduleName: opencode.package, enabled: true, fiberPhase: 'active' },
    ]))
    expect(row?.removable).toBe(false)
  })

  it('carries a disabled entry through as disabled', () => {
    const [row] = mergeInventoryRows(manifest, inventory([
      { moduleName: opencode.package, enabled: false, fiberPhase: null },
    ]))
    expect(row?.enabled).toBe(false)
    expect(row?.status).toEqual({ kind: 'unknown-version' })
  })

  // A plugin whose root fiber threw is the state that sent a user here in the
  // first place, so it gets its own badge rather than reading as healthy.
  it('marks an entry whose fiber failed', () => {
    const [row] = mergeInventoryRows(manifest, inventory([
      { moduleName: opencode.package, enabled: true, fiberPhase: 'failed' },
    ]))
    expect(row?.status).toEqual({ kind: 'failed' })
  })

  it('reports a plugin with no Loader entry as not installed', () => {
    const [row] = mergeInventoryRows(manifest, inventory([
      { moduleName: '@deepseek-ai/dsh-llm', enabled: true, fiberPhase: 'active' },
    ]))
    expect(row?.status).toEqual({ kind: 'not-installed' })
    expect(row?.enabled).toBe(false)
  })
})

describe('installSpec', () => {
  // Without the query string pnpm serves the tarball from its URL-keyed store
  // and an update silently reinstalls the copy already on disk.
  it('appends the catalogue version so pnpm refetches', () => {
    expect(installSpec(opencode)).toBe(`${opencode.tarball}?v=0.2.1`)
  })
})

describe('CLI commands', () => {
  // `dsh plugin --profile <name> <args>` forwards to pnpm, so install and
  // update are one `add` — with the same cache-buster the managed path uses.
  it('quotes the spec so a shell does not glob the query string', () => {
    expect(installCommand(opencode)).toBe(
      `dsh plugin --profile web add '${opencode.tarball}?v=0.2.1'`,
    )
  })

  it('removes by package name', () => {
    expect(removeCommand(opencode)).toBe('dsh plugin --profile web remove dsh-x6nux-opencode')
  })

  it('names a non-default profile', () => {
    expect(removeCommand(opencode, 'headless')).toContain('--profile headless')
  })
})

describe('describeChange', () => {
  it('passes the four non-failure applications through', () => {
    expect(describeChange(change({ application: 'applied' })).kind).toBe('applied')
    expect(describeChange(change({ application: 'restart-required' })).kind).toBe('restart-required')
    expect(describeChange(change({ application: 'overridden' })).kind).toBe('overridden')
    expect(describeChange(change({ application: 'cancelled' })).kind).toBe('cancelled')
  })

  // The remote answers with `failed` rather than throwing, so a caller that
  // only catches exceptions would call every refusal a success.
  it('reports a failure with its code and diagnostic', () => {
    const outcome = describeChange(change({
      application: 'failed',
      error: { code: 'not-removable', diagnostic: 'bundle is required' },
    }))
    expect(outcome).toEqual({ kind: 'failed', code: 'not-removable', diagnostic: 'bundle is required' })
  })

  it('surfaces the packages whose build scripts pnpm blocked', () => {
    const outcome = describeChange(change({
      application: 'failed',
      error: { code: 'operation-error' },
      pendingBuilds: ['@google/genai', 'protobufjs'],
    }))
    expect(outcome).toMatchObject({ kind: 'failed', pendingBuilds: ['@google/genai', 'protobufjs'] })
  })

  it('omits an empty pending-build list', () => {
    const outcome = describeChange(change({ application: 'failed', pendingBuilds: [] }))
    expect(outcome).toEqual({ kind: 'failed' })
  })
})
