# Plugin Hub

DSH 插件：在设置页里安装、更新、卸载、启用、禁用 [x6nux/dsh-plugins](https://github.com/x6nux/dsh-plugins) 发布的插件。

装上它之后，其余插件都不用再手敲 tarball 地址，也不用自己拼升级用的查询参数。

## 兼容的 DSH 版本

`0.1.6-alpha.2`

插件管理能力由 DSH 自身提供（`pluginManager` 远端），而这个远端是 `0.1.6-alpha.2` 才加进 `dsh-api-remotes` 装配的——`0.1.5-rc.1`、`0.1.5-rc.2`、`0.1.6-alpha.1` 的装配里没有它，装上本插件也无从管理任何东西，所以不列为兼容版本。同仓库的其他插件仍兼容那三个版本。

更新的 DSH 版本由仓库的兼容性巡检自动验证并加进这个列表。若某个部署没有开放管理能力，设置页照常打开，只显示一条说明而不提供操作按钮。

## 安装

它自己仍需手动安装一次——先有管理器，才能管别的插件：

```sh
dsh plugin --profile web add https://github.com/x6nux/dsh-plugins/releases/download/manager-latest/dsh-x6nux-plugin-hub.tgz
```

重启 `dsh web`，打开 **设置 → 插件**。

插件是预先构建好的成品，安装时不执行构建脚本，不需要 `allowBuilds`，也不需要登录凭证。历史版本见 [Releases](https://github.com/x6nux/dsh-plugins/releases?q=manager)。

## 使用

页面按仓库清单列出每个插件，一行一个：

| 状态 | 按钮 |
| --- | --- |
| 未安装 | 安装 |
| 已安装、有新版（显示 `旧版本 → 新版本`） | 更新、卸载、启用开关 |
| 已是最新 | 卸载、启用开关 |

- **更新**：地址上自动带 `?v=<清单版本>`。这个参数不可省——pnpm 按 URL 索引 tarball 缓存，URL 不变就直接复用本地副本，不会去看远端有没有变化。
- **启用 / 禁用**：不动磁盘上的包，只切换是否加载。想彻底移除用「卸载」。
- **需要重启**：改动保存后若未即时生效，行内会提示重启 DSH。这是 DSH 的 `restart-required` 结果，不是错误。
- **构建脚本被拦**：提示里列出被 pnpm 拦下的包名，再点一次同一个按钮即批准它们并重试。
- 别处（命令行、其他窗口）做的改动会通过 DSH 的变更事件推送过来，列表自动刷新。

更新管理器自己也走同一个「更新」按钮，新界面在重启后出现。

## 清单

页面读的是 main 分支上的 [`plugins.json`](https://github.com/x6nux/dsh-plugins/blob/main/plugins.json)，发版流水线自动写入新版本号。清单地址写死在代码里，没有设置项。

只列这个仓库的插件，DSH 内置的包不出现在这里——避免误操作不可移除的内置项。

清单托管在 `raw.githubusercontent.com`，缓存 5 分钟；请求带时间戳参数绕过它，但 CDN 边缘仍可能短暂滞后。刚发布的版本若没立刻出现，点「刷新」或稍等一会儿。

## 开发

```sh
npm ci
npm run typecheck   # host 与 client 两套程序分别检查
npm test            # 纯逻辑、页面组件、构建产物（pretest 先构建）
npm run build       # lib/index.js 与 lib/client.js
```

Host 侧只有一个挂载日志：五个操作全部通过客户端调用 DSH 自带的 `pluginManager` 远端完成，没有自建契约，也没有需要 host 转发的请求。

## 许可

MIT
