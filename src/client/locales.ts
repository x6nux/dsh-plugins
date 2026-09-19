/** Plugin hub page copy. Both dictionaries carry the same keys. */

export const en = {
  nav: 'Plugins',
  title: 'x6nux plugins',
  intro: 'Install, update, remove and switch the plugins published in x6nux/dsh-plugins.',
  refresh: 'Refresh',
  loading: 'Reading the catalogue…',
  manifestFailed: 'Could not read the plugin catalogue: {reason}',
  managerUnavailable: 'This harness does not expose plugin management, so nothing can be changed from here.',
  empty: 'The catalogue lists no plugins.',

  statusNotInstalled: 'Not installed',
  statusCurrent: 'Up to date · {version}',
  statusOutdated: '{installed} → {version}',
  statusUnknownVersion: 'Installed, version unknown',
  statusDisabled: 'Disabled',
  readOnly: 'Managed elsewhere',

  install: 'Install',
  update: 'Update',
  remove: 'Remove',
  enabledLabel: 'Enabled',
  working: 'Working…',

  outcomeApplied: 'Done.',
  outcomeRestart: 'Saved. Restart DSH for it to take effect.',
  outcomeOverridden: 'Saved, but a profile override still decides what loads.',
  outcomeCancelled: 'Cancelled.',
  outcomeFailed: 'Failed: {reason}',
  outcomeBuildBlocked: 'pnpm blocked build scripts for: {packages}. Press the button again to approve them and retry.',

  errorManagementRequired: 'this bundle has to be changed through the DSH CLI',
  errorUnaddressable: 'the harness cannot address this bundle',
  errorUnknownPlugin: 'the harness does not know this plugin',
  errorInvalidSpec: 'the install address was refused',
  errorAmbiguousInstall: 'the address matched more than one bundle',
  errorNotBundle: 'the package is not a DSH bundle',
  errorNotRemovable: 'this bundle cannot be removed',
  errorStopProfile: 'stop the profile first',
  errorBundleInUse: 'another plugin still depends on this bundle',
  errorStaleApproval: 'the build approval no longer applies; retry',
  errorOperationError: 'the package operation failed',
  errorUnknown: 'unknown reason',
} as const

export const zh: Record<keyof typeof en, string> = {
  nav: '插件',
  title: 'x6nux 插件',
  intro: '安装、更新、卸载和启停 x6nux/dsh-plugins 里发布的插件。',
  refresh: '刷新',
  loading: '正在读取插件清单…',
  manifestFailed: '读取插件清单失败：{reason}',
  managerUnavailable: '当前 DSH 未提供插件管理能力，这里无法做任何更改。',
  empty: '清单里没有插件。',

  statusNotInstalled: '未安装',
  statusCurrent: '已是最新 · {version}',
  statusOutdated: '{installed} → {version}',
  statusUnknownVersion: '已安装，版本未知',
  statusDisabled: '已禁用',
  readOnly: '由别处管理',

  install: '安装',
  update: '更新',
  remove: '卸载',
  enabledLabel: '启用',
  working: '处理中…',

  outcomeApplied: '完成。',
  outcomeRestart: '已保存，重启 DSH 后生效。',
  outcomeOverridden: '已保存，但 profile 中的覆盖项仍决定实际加载内容。',
  outcomeCancelled: '已取消。',
  outcomeFailed: '失败：{reason}',
  outcomeBuildBlocked: 'pnpm 拦下了这些包的构建脚本：{packages}。再点一次按钮即可批准并重试。',

  errorManagementRequired: '这个包只能通过 DSH 命令行更改',
  errorUnaddressable: 'DSH 无法定位这个包',
  errorUnknownPlugin: 'DSH 不认识这个插件',
  errorInvalidSpec: '安装地址被拒绝',
  errorAmbiguousInstall: '这个地址匹配到多个包',
  errorNotBundle: '这个包不是 DSH 插件包',
  errorNotRemovable: '这个包不可卸载',
  errorStopProfile: '请先停止该 profile',
  errorBundleInUse: '还有其他插件依赖这个包',
  errorStaleApproval: '构建批准已失效，请重试',
  errorOperationError: '包管理操作失败',
  errorUnknown: '原因未知',
}

/** Copy key of this page. */
export type HubKey = keyof typeof en
