/**
 * Plugin hub, browser half. Registers the "Plugins" settings page over the
 * harness's own `pluginManager` remote.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the shell's SlotMap merge (the 'settings.section' entry).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the slot registry Context merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls ctx.remote, including the pluginManager namespace and the
// forwarded plugin-manager events.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { HubSection } from './Section.tsx'
import type { HubSectionInjected, HubTranslate } from './Section.tsx'
import { createHubFace } from './hub-controller.ts'
import { en, zh } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The plugin hub page copy. */
    'settings.plugin-hub': keyof typeof en
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'settings.plugin-hub'

export type { HubSectionProps, HubSectionInjected } from './Section.tsx'
export type { HubRow, HubStatus, Manifest, ManifestEntry, Outcome } from './hub.ts'
export type { HubAction, HubFace } from './hub-controller.ts'

/**
 * Required services. `remote.pluginManager` is deliberately absent: it is
 * injected softly inside the face so a harness without plugin management still
 * shows this page with an explanation instead of dropping it.
 */
export const inject = ['slots', 'locale', 'remote']

/**
 * Register the page once the `settings.section` declaration is on the ledger.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'plugin-hub: copy dictionaries')
  const face = createHubFace(ctx)
  const t = ctx.locale.bind(NS) as HubTranslate
  const injected = (): HubSectionInjected => ({ ...face, t })

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'plugin-hub',
    order: 10,
    label: () => t('nav'),
    inject: injected,
  }, HubSection))
}
