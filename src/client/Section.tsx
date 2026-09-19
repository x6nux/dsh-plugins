/**
 * The plugin hub settings page: one row per catalogue plugin, with its local
 * state and the four actions.
 *
 * State lives in this component rather than a DSH snapshot store — the page is
 * a single instance and nothing else reads it, so a store would only add a
 * layer between the button and the call.
 */

import { useCallback, useEffect, useState } from 'react'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import { Button, Switch, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TagTone } from '@deepseek-ai/dsh-client-ui-primitives'
import type { HubAction, HubFace } from './hub-controller.ts'
import { ManagementUnavailable } from './hub-controller.ts'
import type { HubRow, Outcome } from './hub.ts'
import type { HubKey } from './locales.ts'
import css from './Section.module.css'

/** Page copy lookup, including `{name}` template params. */
export type HubTranslate = (key: HubKey, params?: Record<string, unknown>) => string

/** Injected dependencies of {@link HubSection} (slot `inject`). */
export interface HubSectionInjected extends HubFace {
  t: HubTranslate
}

/** Props delivered by the slot outlet: the inject face spread flat. */
export type HubSectionProps = Partial<InjectFace<HubSectionInjected>>

/** Failure codes the harness reports, mapped to their copy. */
const ERROR_KEYS: Record<string, HubKey> = {
  'management-required': 'errorManagementRequired',
  unaddressable: 'errorUnaddressable',
  'unknown-plugin': 'errorUnknownPlugin',
  'invalid-spec': 'errorInvalidSpec',
  'ambiguous-install': 'errorAmbiguousInstall',
  'not-bundle': 'errorNotBundle',
  'not-removable': 'errorNotRemovable',
  'stop-profile': 'errorStopProfile',
  'bundle-in-use': 'errorBundleInUse',
  'stale-approval': 'errorStaleApproval',
  'operation-error': 'errorOperationError',
}

/**
 * Render one outcome as a sentence.
 * @param t - copy lookup.
 * @param outcome - what the mutation reported.
 * @returns the line to show under the row.
 */
export function outcomeText(t: HubTranslate, outcome: Outcome): string {
  switch (outcome.kind) {
    case 'applied':
      return t('outcomeApplied')
    case 'restart-required':
      return t('outcomeRestart')
    case 'overridden':
      return t('outcomeOverridden')
    case 'cancelled':
      return t('outcomeCancelled')
    default: {
      if (outcome.pendingBuilds !== undefined) {
        return t('outcomeBuildBlocked', { packages: outcome.pendingBuilds.join(', ') })
      }
      const key = outcome.code === undefined ? undefined : ERROR_KEYS[outcome.code]
      const reason = key === undefined ? outcome.diagnostic ?? t('errorUnknown') : t(key)
      return t('outcomeFailed', { reason })
    }
  }
}

/** The status badge's text and tone. */
function statusBadge(t: HubTranslate, row: HubRow): { text: string; tone: TagTone } {
  const { entry, status } = row
  if (status.kind === 'not-installed') return { text: t('statusNotInstalled'), tone: 'quiet' }
  if (!row.enabled) return { text: t('statusDisabled'), tone: 'neutral' }
  if (status.kind === 'outdated') {
    return { text: t('statusOutdated', { installed: status.installed, version: entry.version }), tone: 'warning' }
  }
  if (status.kind === 'unknown-version') return { text: t('statusUnknownVersion'), tone: 'neutral' }
  return { text: t('statusCurrent', { version: entry.version }), tone: 'success' }
}

interface PluginRowProps {
  row: HubRow
  t: HubTranslate
  busy: boolean
  outcome?: Outcome
  onAct: (action: HubAction, row: HubRow) => void
}

/** One catalogue plugin. */
function PluginRow(props: PluginRowProps) {
  const { row, t, busy, outcome } = props
  const badge = statusBadge(t, row)
  const installed = row.status.kind !== 'not-installed'
  const locked = row.readOnlyReason !== undefined
  return (
    <li className={css.row}>
      <div className={css.head}>
        <span className={css.name}>{row.entry.name}</span>
        <Tag tone={badge.tone}>{badge.text}</Tag>
        {locked ? <Tag tone="outline">{t('readOnly')}</Tag> : null}
      </div>
      <p className={css.description}>{row.entry.description}</p>
      <div className={css.actions}>
        {!installed
          ? (
            <Button
              variant="primary"
              size="sm"
              disabled={busy || locked}
              onClick={() => { props.onAct('install', row) }}
            >
              {busy ? t('working') : t('install')}
            </Button>
          )
          : null}
        {installed && row.status.kind === 'outdated'
          ? (
            <Button
              variant="primary"
              size="sm"
              disabled={busy || locked}
              onClick={() => { props.onAct('update', row) }}
            >
              {busy ? t('working') : t('update')}
            </Button>
          )
          : null}
        {installed && row.removable
          ? (
            <Button
              variant="outline"
              size="sm"
              disabled={busy || locked}
              onClick={() => { props.onAct('remove', row) }}
            >
              {t('remove')}
            </Button>
          )
          : null}
        {installed
          ? (
            <Switch
              checked={row.enabled}
              label={t('enabledLabel')}
              disabled={busy || locked}
              {...locked ? { title: t('readOnly') } : {}}
              onChange={(next) => { props.onAct(next ? 'enable' : 'disable', row) }}
            />
          )
          : null}
      </div>
      {outcome === undefined ? null : <p className={css.outcome}>{outcomeText(t, outcome)}</p>}
    </li>
  )
}

/** The page once every injected seat is present. */
function Loaded(props: HubSectionInjected) {
  const { t, load, act, onChanged } = props
  const [rows, setRows] = useState<readonly HubRow[] | undefined>(undefined)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const [unavailable, setUnavailable] = useState(false)
  const [busy, setBusy] = useState<string | undefined>(undefined)
  const [outcomes, setOutcomes] = useState<Readonly<Record<string, Outcome>>>({})
  // Build approvals carried from a `build-blocked` failure, so pressing the
  // same button again retries with them instead of failing the same way.
  const [approvals, setApprovals] = useState<Readonly<Record<string, readonly string[]>>>({})

  const refresh = useCallback(async () => {
    try {
      setRows(await load())
      setFailure(undefined)
      setUnavailable(false)
    } catch (error) {
      if (error instanceof ManagementUnavailable) setUnavailable(true)
      else setFailure(error instanceof Error ? error.message : String(error))
    }
  }, [load])

  useEffect(() => { void refresh() }, [refresh])

  useEffect(() => onChanged(() => { void refresh() }), [onChanged, refresh])

  const run = (action: HubAction, row: HubRow): void => {
    const target = row.entry.package
    setBusy(target)
    void (async () => {
      try {
        const outcome = await act(action, row, approvals[target])
        setOutcomes(previous => ({ ...previous, [target]: outcome }))
        setApprovals(previous => (outcome.kind === 'failed' && outcome.pendingBuilds !== undefined
          ? { ...previous, [target]: outcome.pendingBuilds }
          : { ...previous, [target]: [] }))
        await refresh()
      } catch (error) {
        setOutcomes(previous => ({
          ...previous,
          [target]: { kind: 'failed', diagnostic: error instanceof Error ? error.message : String(error) },
        }))
      } finally {
        setBusy(undefined)
      }
    })()
  }

  return (
    <section className={css.page}>
      <header className={css.pageHead}>
        <h2 className={css.title}>{t('title')}</h2>
        <Button variant="ghost" size="sm" onClick={() => { void refresh() }}>{t('refresh')}</Button>
      </header>
      <p className={css.intro}>{t('intro')}</p>
      {unavailable ? <p className={css.notice}>{t('managerUnavailable')}</p> : null}
      {failure === undefined ? null : <p className={css.notice}>{t('manifestFailed', { reason: failure })}</p>}
      {rows === undefined && !unavailable && failure === undefined
        ? <p className={css.notice}>{t('loading')}</p>
        : null}
      {rows !== undefined && rows.length === 0 ? <p className={css.notice}>{t('empty')}</p> : null}
      {rows === undefined
        ? null
        : (
          <ul className={css.list}>
            {rows.map(row => (
              <PluginRow
                key={row.entry.package}
                row={row}
                t={t}
                busy={busy === row.entry.package}
                {...outcomes[row.entry.package] === undefined ? {} : { outcome: outcomes[row.entry.package] }}
                onAct={run}
              />
            ))}
          </ul>
        )}
    </section>
  )
}

/**
 * The settings page. Renders nothing until the slot supplies every seat, which
 * is also what keeps the hooks below unconditional.
 */
export function HubSection(props: HubSectionProps) {
  const { t, load, act, onChanged } = props
  if (t === undefined || load === undefined || act === undefined || onChanged === undefined) return null
  return <Loaded t={t} load={load} act={act} onChanged={onChanged} />
}
