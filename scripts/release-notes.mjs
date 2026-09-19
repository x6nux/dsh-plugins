/**
 * Generate release notes for one plugin tag.
 *
 * ```
 * node scripts/release-notes.mjs --project . --plugin opencode --tag opencode-v0.2.0 --out notes.md
 * ```
 *
 * The notes carry the install command with the exact asset URL, because that is
 * the only way this plugin is installed — there is no registry entry to point
 * at — and the compatibility list read from the manifest, so it can never
 * disagree with what the build actually declares.
 *
 * The install URL points at the rolling `<plugin>-latest` release and the asset
 * name carries no version, so it never changes. The upgrade command appends
 * `?v=<version>`: pnpm indexes its tarball store by URL, and an unchanged URL
 * is served from that store no matter what the remote now holds — `remove` then
 * `add`, and `--force`, were both measured to keep the stale copy. A changing
 * query string is what makes pnpm fetch again, and it is easier to follow than
 * a version inside the path because only the tail moves.
 */

import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readManifest, readSupported } from './compat-versions.mjs'

/**
 * The `owner/repo` this plugin belongs to. `GITHUB_REPOSITORY` is authoritative
 * inside Actions; the manifest's repository URL is the local fallback.
 * @param manifest - parsed plugin manifest.
 * @returns slug such as `x6nux/dsh-plugins`.
 */
function repositorySlug(manifest) {
  if (process.env.GITHUB_REPOSITORY !== undefined && process.env.GITHUB_REPOSITORY.length > 0) {
    return process.env.GITHUB_REPOSITORY
  }
  const url = manifest.repository?.url ?? ''
  const match = /github\.com[/:]([^/]+\/[^/.]+)/.exec(url)
  if (match === null) throw new Error('cannot determine the repository; set GITHUB_REPOSITORY or repository.url')
  return match[1]
}

/**
 * Build the notes body.
 * @param options - project directory, plugin name, and tag.
 * @returns markdown.
 */
export async function releaseNotes({ project, plugin, tag }) {
  const { json } = await readManifest(project)
  const supported = await readSupported(project)
  const slug = repositorySlug(json)
  const asset = `${json.name}.tgz`
  const base = `https://github.com/${slug}/releases/download/${plugin}-latest/${asset}`
  const pinned = `https://github.com/${slug}/releases/download/${tag}/${asset}`
  return [
    '## 安装',
    '',
    '```sh',
    `dsh plugin --profile web add ${base}`,
    '```',
    '',
    '把 `web` 换成你的 profile 名（`headless`、`desktop-tauri` 等），安装后重启 DSH。'
      + '这个 URL 永远指向最新版，资产名不带版本号，不用去查版本。',
    '',
    '这个 tgz 是预先构建好的成品，安装时不执行任何构建脚本，所以不需要在 profile 的'
      + ' `pnpm-workspace.yaml` 里配置 `allowBuilds`，也不需要任何登录凭证。',
    '',
    '## 升级',
    '',
    '```sh',
    `dsh plugin --profile web add '${base}?v=${json.version}'`,
    '```',
    '',
    '**升级必须带上这个查询参数。** pnpm 按 URL 索引它的 tarball 缓存，URL 一模一样时直接'
      + '复用本地副本、根本不去看远端有没有变化——实测 `remove` 后再 `add` 和 `--force` 都拿不到新版本。'
      + '尾部加一个会变的参数就能让它重新下载；用哪个值不重要，上面填的是本版版本号。',
    '',
    '不必先卸载，配置和 API Key 都会保留。',
    '',
    '需要锁定这一版（不随 latest 走）时用带 tag 的 URL：',
    '',
    '```sh',
    `dsh plugin --profile web add ${pinned}`,
    '```',
    '',
    '## 兼容的 DSH 版本',
    '',
    supported.map(version => `\`${version}\``).join('、'),
    '',
    '上面每个版本都验证过：两个程序对着该版本的类型声明编译、插件自己的运行时探针（如果有）、'
      + '以及在独立的 pnpm profile 中确认解析到该版本后经真实 Cordis Loader 加载运行。',
    '',
    `插件包名 \`${json.name}\`，版本 \`${json.version}\`。`,
  ].join('\n')
}

/** Parse argv into note options. */
function parseArgs(argv) {
  const options = { project: process.cwd(), plugin: undefined, tag: undefined, out: undefined }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--project') options.project = resolve(argv[index += 1])
    else if (argument === '--plugin') options.plugin = argv[index += 1]
    else if (argument === '--tag') options.tag = argv[index += 1]
    else if (argument === '--out') options.out = resolve(argv[index += 1])
    else throw new Error(`unknown argument: ${argument}`)
  }
  for (const required of ['plugin', 'tag']) {
    if (options[required] === undefined) throw new Error(`missing --${required}`)
  }
  return options
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const options = parseArgs(process.argv.slice(2))
  const notes = await releaseNotes(options)
  if (options.out === undefined) process.stdout.write(`${notes}\n`)
  else await writeFile(options.out, `${notes}\n`)
}
