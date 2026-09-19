/**
 * Plugin hub, Host half.
 *
 * Every operation this plugin offers — install, update, remove, enable,
 * disable — is already a method on the harness's own `pluginManager` Typert
 * remote, which the Web client calls directly. So there is deliberately no
 * Host-side service, no settings section, and no wire contract here: adding
 * one would put a second copy of the harness's own logic behind a slower path.
 *
 * The entry still has to exist, because installing this bundle inserts a
 * loader row (see `cordis.patch.yml`) and the loader imports this module to
 * apply it. It records that the hub is mounted and nothing else.
 *
 * @module dsh-x6nux-plugin-hub
 */

import type { Context } from '@deepseek-ai/cordis'

export const name = 'plugin-hub'

/**
 * Mount the hub. The browser half (`./client`) carries the settings page and
 * talks to `pluginManager` itself.
 * @param ctx - the plugin's context.
 */
export function apply(ctx: Context): void {
  ctx.logger.info('plugin-hub: mounted; the plugin catalogue is managed from the Web settings page')
}
