// @vitest-environment jsdom

/**
 * The plugin hub page: which action each state offers, what it asks the
 * harness for, and how it reports the answer.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HubSection } from '../src/client/Section.tsx'
import type { HubSectionProps } from '../src/client/Section.tsx'
import { ManagementUnavailable } from '../src/client/hub-controller.ts'
import type { HubMode } from '../src/client/hub-controller.ts'
import type { HubRow, Outcome } from '../src/client/hub.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const t = (key: keyof typeof en, params?: Record<string, unknown>): string =>
  Object.entries(params ?? {}).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
    en[key] as string,
  )

/** The action callback's signature, so `mock.calls` keeps its argument types. */
type Act = NonNullable<HubSectionProps['act']>

const entry = {
  id: 'opencode',
  package: 'dsh-x6nux-opencode',
  name: 'OpenCode Go',
  description: '订阅模型',
  version: '0.2.1',
  tarball: 'https://example.invalid/opencode-latest/dsh-x6nux-opencode.tgz',
}

function row(overrides: Partial<HubRow> = {}): HubRow {
  return { entry, status: { kind: 'not-installed' }, enabled: false, removable: false, ...overrides }
}

/** Render the page with a stubbed face and wait for the first load to settle. */
async function mount(rows: HubRow[], act?: HubSectionProps['act'], mode: HubMode = 'manage') {
  const load = vi.fn(() => Promise.resolve({ mode, rows }))
  const fallback = vi.fn<Act>(() => Promise.resolve<Outcome>({ kind: 'applied' }))
  const onChanged = vi.fn(() => () => {})
  render(<HubSection t={t} load={load} act={act ?? fallback} onChanged={onChanged} />)
  await waitFor(() => { expect(screen.getByText(entry.name)).toBeTruthy() })
  return { load, act: act ?? fallback, onChanged }
}

describe('plugin hub page', () => {
  it('renders nothing until the slot supplies every seat', () => {
    const { container } = render(<HubSection t={t} />)
    expect(container.firstChild).toBeNull()
  })

  it('offers install for a plugin the profile does not hold', async () => {
    const act = vi.fn<Act>(() => Promise.resolve<Outcome>({ kind: 'applied' }))
    await mount([row()], act)
    expect(screen.getByText(t('statusNotInstalled'))).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: t('install') }))
    await waitFor(() => { expect(act).toHaveBeenCalled() })
    expect(act.mock.calls[0]?.[0]).toBe('install')
  })

  it('offers update for an outdated plugin and names both versions', async () => {
    const act = vi.fn<Act>(() => Promise.resolve<Outcome>({ kind: 'applied' }))
    await mount([row({ status: { kind: 'outdated', installed: '0.2.0' }, enabled: true, removable: true })], act)
    expect(screen.getByText(t('statusOutdated', { installed: '0.2.0', version: '0.2.1' }))).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: t('update') }))
    await waitFor(() => { expect(act.mock.calls[0]?.[0]).toBe('update') })
  })

  it('offers no update button when the installed version is current', async () => {
    await mount([row({ status: { kind: 'current' }, enabled: true, removable: true })])
    expect(screen.getByText(t('statusCurrent', { version: '0.2.1' }))).toBeTruthy()
    expect(screen.queryByRole('button', { name: t('update') })).toBeNull()
  })

  it('removes an installed plugin the harness says is removable', async () => {
    const act = vi.fn<Act>(() => Promise.resolve<Outcome>({ kind: 'applied' }))
    await mount([row({ status: { kind: 'current' }, enabled: true, removable: true })], act)
    fireEvent.click(screen.getByRole('button', { name: t('remove') }))
    await waitFor(() => { expect(act.mock.calls[0]?.[0]).toBe('remove') })
  })

  it('hides remove when the harness refuses it', async () => {
    await mount([row({ status: { kind: 'current' }, enabled: true, removable: false })])
    expect(screen.queryByRole('button', { name: t('remove') })).toBeNull()
  })

  it('switches a plugin off and back on', async () => {
    const act = vi.fn<Act>(() => Promise.resolve<Outcome>({ kind: 'applied' }))
    const { unmount } = { unmount: cleanup }
    await mount([row({ status: { kind: 'current' }, enabled: true, removable: true })], act)
    fireEvent.click(screen.getByRole('switch', { name: t('enabledLabel') }))
    await waitFor(() => { expect(act.mock.calls[0]?.[0]).toBe('disable') })
    unmount()

    const enable = vi.fn<Act>(() => Promise.resolve<Outcome>({ kind: 'applied' }))
    await mount([row({ status: { kind: 'current' }, enabled: false, removable: true })], enable)
    expect(screen.getByText(t('statusDisabled'))).toBeTruthy()
    fireEvent.click(screen.getByRole('switch', { name: t('enabledLabel') }))
    await waitFor(() => { expect(enable.mock.calls[0]?.[0]).toBe('enable') })
  })

  // A saved-but-not-live change reads as success unless the page says otherwise.
  it('tells the user to restart when the change is not live yet', async () => {
    const act = vi.fn<Act>(() => Promise.resolve<Outcome>({ kind: 'restart-required' }))
    await mount([row()], act)
    fireEvent.click(screen.getByRole('button', { name: t('install') }))
    await waitFor(() => { expect(screen.getByText(t('outcomeRestart'))).toBeTruthy() })
  })

  it('names the blocked packages and retries with them approved', async () => {
    const act = vi.fn()
      .mockResolvedValueOnce({ kind: 'failed', pendingBuilds: ['protobufjs'] } satisfies Outcome)
      .mockResolvedValueOnce({ kind: 'applied' } satisfies Outcome)
    await mount([row()], act as unknown as HubSectionProps['act'])
    fireEvent.click(screen.getByRole('button', { name: t('install') }))
    await waitFor(() => {
      expect(screen.getByText(t('outcomeBuildBlocked', { packages: 'protobufjs' }))).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: t('install') }))
    await waitFor(() => { expect(act).toHaveBeenCalledTimes(2) })
    expect(act.mock.calls[1]?.[2]).toEqual(['protobufjs'])
  })

  it('translates a failure code instead of showing the raw code', async () => {
    const act = vi.fn<Act>(() => Promise.resolve<Outcome>({ kind: 'failed', code: 'bundle-in-use' }))
    await mount([row({ status: { kind: 'current' }, enabled: true, removable: true })], act)
    fireEvent.click(screen.getByRole('button', { name: t('remove') }))
    await waitFor(() => {
      expect(screen.getByText(t('outcomeFailed', { reason: t('errorBundleInUse') }))).toBeTruthy()
    })
  })

  // On 0.1.5-rc.2 and 0.1.6-alpha.1 the harness has no pluginManager, so the
  // page must not offer buttons it cannot honour.
  describe('on a harness that can only read the inventory', () => {
    it('offers commands instead of buttons', async () => {
      await mount([row({ status: { kind: 'unknown-version' }, enabled: true })], undefined, 'read-only')
      expect(screen.queryByRole('button', { name: t('install') })).toBeNull()
      expect(screen.queryByRole('button', { name: t('remove') })).toBeNull()
      expect(screen.queryByRole('switch', { name: t('enabledLabel') })).toBeNull()
      expect(screen.getByText(`dsh plugin --profile web add '${entry.tarball}?v=${entry.version}'`)).toBeTruthy()
      expect(screen.getByText(`dsh plugin --profile web remove ${entry.package}`)).toBeTruthy()
    })

    it('says why the page is read-only and that switching needs a newer DSH', async () => {
      await mount([row()], undefined, 'read-only')
      expect(screen.getByText(t('readOnlyMode'))).toBeTruthy()
      expect(screen.getByText(t('readOnlyToggle'))).toBeTruthy()
    })

    it('offers no remove command for a plugin that is not installed', async () => {
      await mount([row()], undefined, 'read-only')
      expect(screen.getByText(`dsh plugin --profile web add '${entry.tarball}?v=${entry.version}'`)).toBeTruthy()
      expect(screen.queryByText(`dsh plugin --profile web remove ${entry.package}`)).toBeNull()
    })

    it('marks a plugin whose fiber failed to load', async () => {
      await mount([row({ status: { kind: 'failed' }, enabled: true })], undefined, 'read-only')
      expect(screen.getByText(t('statusFailed'))).toBeTruthy()
    })
  })

  it('explains itself when the harness exposes no plugin management', async () => {
    const load = vi.fn(() => Promise.reject(new ManagementUnavailable()))
    render(<HubSection t={t} load={load} act={vi.fn()} onChanged={vi.fn(() => () => {})} />)
    await waitFor(() => { expect(screen.getByText(t('managerUnavailable'))).toBeTruthy() })
  })

  it('reports a catalogue read failure with its reason', async () => {
    const load = vi.fn(() => Promise.reject(new Error('catalogue request failed with 500')))
    render(<HubSection t={t} load={load} act={vi.fn()} onChanged={vi.fn(() => () => {})} />)
    await waitFor(() => {
      expect(screen.getByText(t('manifestFailed', { reason: 'catalogue request failed with 500' }))).toBeTruthy()
    })
  })

  it('reloads when the harness reports a change made elsewhere', async () => {
    let notify = (): void => {}
    const load = vi.fn(() => Promise.resolve({ mode: 'manage' as HubMode, rows: [row()] }))
    render(
      <HubSection
        t={t}
        load={load}
        act={vi.fn()}
        onChanged={(listener) => { notify = listener; return () => {} }}
      />,
    )
    await waitFor(() => { expect(load).toHaveBeenCalledTimes(1) })
    notify()
    await waitFor(() => { expect(load).toHaveBeenCalledTimes(2) })
  })
})
