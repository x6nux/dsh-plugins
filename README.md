# dsh-plugins

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 第三方插件的聚合仓库。

## 布局

插件不放在目录里，而是**各占一个 `plugin/*` 分支**，分支根目录就是那个插件的完整项目。`main` 分支不含任何插件代码，只放所有插件共用的东西：

```
main
├── plugins.json        插件清单：每个插件的包名、当前版本、tgz 地址
├── scripts/            共享脚本：兼容性验证、巡检、Release notes、清单维护
└── .github/workflows/  共享工作流（plugin-ci、plugin-release 为 workflow_call；dsh-compat 为定时）

plugin/opencode         OpenCode Go 订阅模型插件（包名 dsh-x6nux-opencode）
plugin/manager          插件管理面板（包名 dsh-x6nux-plugin-hub）
```

GitHub Actions 从**触发事件的那个 ref** 读取工作流文件，所以只放在 `main` 上的工作流不会因为 push 到插件分支而运行。因此每个插件分支保留两个几行长的 caller（`ci.yml`、`release.yml`），用 `workflow_call` 指向 `main` 上的实现，逻辑仍然只有一份。`dsh-compat.yml` 是定时任务，`schedule` 和 `workflow_dispatch` 总是读默认分支，所以它只存在于 `main`。

## 插件

| 插件 | 分支 | 包名 | 说明 |
|---|---|---|---|
| opencode | [`plugin/opencode`](../../tree/plugin/opencode) | `dsh-x6nux-opencode` | 在 DSH 中使用 OpenCode Go 订阅模型：流式回复、工具调用、图片输入、Web 设置页、套餐用量 |
| manager | [`plugin/manager`](../../tree/plugin/manager) | `dsh-x6nux-plugin-hub` | 在设置页里安装、更新、卸载、启停本仓库的插件，升级用的 cache-buster 自动拼好 |

插件的兼容版本各自声明，不必一致：manager 依赖 `pluginManager` 远端，那是 `0.1.6-alpha.2` 才加进 `dsh-api-remotes` 装配的，所以它只兼容该版本；opencode 兼容四个版本。

## 安装

插件不发布到 npm。每次发版把构建好的 tgz 挂在两个 Release 上：版本化的 `<插件>-v<版本>` 作为不可变记录，滚动的 `<插件>-latest` 作为固定安装地址。资产名不带版本号，所以安装 URL 永不变化：

```sh
dsh plugin --profile web add https://github.com/x6nux/dsh-plugins/releases/download/opencode-latest/dsh-x6nux-opencode.tgz
```

tgz 是预构建成品，安装时不执行构建脚本，所以不需要配置 pnpm 的 `allowBuilds`，也不需要任何登录凭证。

**升级时要在 URL 末尾加一个会变的查询参数**（如 `?v=0.2.1`）。pnpm 按 URL 索引它的 tarball 缓存，URL 一模一样时直接复用本地副本而不去看远端——实测 `remove` 后再 `add` 和 `add --force` 都拿不到新内容，只有 URL 变了才会重新下载。每个 Release 的说明里都带好了现成的升级命令。

具体版本和说明见各插件分支的 README 与 [Releases](../../releases)。

> 不用 GitHub Packages 的原因：它的 npm registry 即使对 public 包也要求 PAT 认证，每台安装机器都得配 `.npmrc`。Release 资产是匿名可下载的。

## 发布一个插件版本

在插件分支上改好 `package.json` 的 `version`，然后打带插件名前缀的 tag：

```sh
git tag opencode-v0.2.1
git push origin opencode-v0.2.1
```

`plugin-release` 会校验 tag 与 manifest 的版本一致、跑完类型检查和测试、对每个声明兼容的 DSH 版本做一遍完整验证，然后打包出不带版本号的 tgz，建版本化 Release，并重建 `<插件>-latest` 这个滚动 Release 指向同一个包。tag 与 version 不一致会直接失败。

滚动 Release 是删掉重建而不是改资产，这样它的 tag 跟着本次发布的提交走；建它时传 `--latest=false`，GitHub 的 "Latest" 徽章留给版本化 Release。

最后它会把刚发布的版本写回 `main` 的 `plugins.json` 并提交 —— 那份清单是插件管理面板判断"已装版本 vs 可用版本"的依据，必须和滚动 Release 的实际内容一致。清单里的 `name` 和 `description` 是人工维护的展示文案，脚本不会覆盖，只有新插件第一次发版时才从它的 `package.json` 取默认值。

## 兼容性巡检

`dsh-compat` 每 6 小时跑一次，也可以手动触发。它遍历所有 `plugin/*` 分支，把 npm 上 `@deepseek-ai/dsh` 的已发布版本减去插件已声明支持的版本，对每个更新的候选版本跑三层验证：

1. **typecheck** — 两个程序对着候选版本的类型声明编译。覆盖源码静态引用的每一个宿主导出，少一个 tsc 就报错。
2. **probe** — 源码里通过类型断言在运行时取的宿主符号 tsc 看不见，需要单独探测。这一层由插件自己实现（`scripts/compat-probe.mjs`），共享脚本只负责调用；没有这个文件的插件跳过该层。
3. **smoke** — 建一个和 `dsh plugin add` 同布局的 pnpm profile（插件声明的每个宿主 peer 都按候选版本钉住，否则 pnpm 会自己挑范围内最新的），先确认插件自身解析到的宿主确实是候选版本（否则会测成另一个版本而全绿），再经真实 Cordis Loader 加载并跑插件自己的 `verify:installed`。

通过 → 在 `compat/<插件>-dsh-<版本>` 分支上把版本加进 peer 范围和 README，对插件分支开 PR。
失败 → 开一个标题为 `DSH <版本> 与 <插件> 不兼容` 的 issue，正文带失败阶段和完整输出。

两条路径都会先查是否已有同名 PR / issue，所以定时任务不会堆重复条目。

## 本地跑这些脚本

脚本只用 Node 内置模块，`main` 分支不需要安装依赖。需要 `pnpm`（`corepack enable pnpm`）和 `gh`（仅 `--apply` 时）。

```sh
# 验证插件声明支持的每个 DSH 版本
node scripts/compat-verify.mjs --project /path/to/plugin-checkout

# 验证一个候选版本（自动临时加进 peer 范围）
node scripts/compat-verify.mjs --project /path/to/plugin-checkout 0.1.7-alpha.1

# 巡检，只报告不改动
node scripts/compat-watch.mjs --project /path/to/plugin-checkout

# 预览某个 tag 的 Release notes
node scripts/release-notes.mjs --project /path/to/plugin-checkout --plugin opencode --tag opencode-v0.2.0
```

`compat-verify` 会把插件复制到临时目录、在副本里把宿主版本钉到目标版本后安装，所以不会碰你的工作区，也不要求工作区已安装依赖。

## 加一个新插件

1. 从空白开始建分支：`git switch --orphan plugin/<名字>`
2. 放入插件项目（`package.json` 在分支根，`peerDependencies` 里的 `@deepseek-ai/dsh-*` 用显式列举的兼容版本范围，README 里带一节 `## 兼容的 DSH 版本`）
3. 从 `plugin/opencode` 复制两个 caller 到 `.github/workflows/`，把 `plugin:` 改成新名字，`release.yml` 的 tag 前缀也改掉
4. 在 `main` 的插件表格里加一行

第 2 步的两个约定是共享脚本的读写目标：peer 范围是兼容列表的唯一来源，README 那一节是它的人类可读副本。
