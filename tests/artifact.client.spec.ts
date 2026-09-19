// @vitest-environment jsdom
/** The distributed factory must resolve against the DSH module table and register its page. */
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import * as React from 'react'
import * as jsx from 'react/jsx-runtime'
import * as store from '@deepseek-ai/dsh-client-store'
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives'
import { expect, it, vi } from 'vitest'

// The build injects the package name into the factory banner and the CSS
// marker, so both assertions read it from the manifest rather than restating
// it — renaming the package then needs no test edit.
const { name: packageName } = JSON.parse(readFileSync('package.json', 'utf8')) as { name: string }

it('loads the built client and registers the plugin page using published platform modules', () => {
  const table = new Map<string, unknown>([
    ['react', React], ['react/jsx-runtime', jsx],
    ['@deepseek-ai/dsh-client-store', store],
    ['@deepseek-ai/dsh-client-ui-primitives', primitives],
  ])
  let registration: { id: string; factory: (require: (id: string) => unknown) => { apply: (ctx: unknown) => void } } | undefined
  const styles = new Set(document.head.querySelectorAll('style'))
  try {
    runInNewContext(readFileSync('lib/client.js', 'utf8'), {
      document, window: { __ModuleLoader__: { load: (entry: typeof registration) => { registration = entry } } },
    })
    expect(registration?.id).toBe(packageName)

    const client = registration!.factory((id) => {
      if (!table.has(id)) throw new Error(`Unprovided module: ${id}`)
      return table.get(id)
    })
    const slots = vi.fn(() => () => {})
    const effects: Array<() => void> = []
    client.apply({
      // createHubFace injects remote.pluginManager softly; a harness without
      // management never runs the callback, which is the posture under test.
      inject: vi.fn(),
      effect: (install: () => (() => void)) => { effects.push(install()) },
      locale: { register: () => () => {}, bind: () => (key: string) => key },
      remote: { $on: () => () => {} },
      slots: { inject: (_name: string, install: () => void) => { install() }, register: slots },
    })
    expect(slots).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'plugin-hub', name: 'settings.section' }),
      expect.any(Function),
    )
    expect(document.querySelector(`style[data-plugin="${packageName}"]`)).not.toBeNull()
    for (const dispose of effects.reverse()) dispose()
  } finally {
    for (const style of document.head.querySelectorAll('style')) if (!styles.has(style)) style.remove()
  }
})
