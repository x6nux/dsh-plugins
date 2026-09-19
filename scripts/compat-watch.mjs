/**
 * Watch for DSH releases a plugin has not been verified against yet.
 *
 * ```
 * node scripts/compat-watch.mjs --project plugin-checkout                     # report only
 * node scripts/compat-watch.mjs --project plugin-checkout --branch plugin/x --apply
 * node scripts/compat-watch.mjs --project plugin-checkout --version 0.1.7-alpha.1
 * ```
 *
 * Without `--apply` nothing is written and GitHub is not touched, so the same
 * command that CI runs can be run locally to see what it would do.
 *
 * With `--apply`, a release that passes every layer is added to the plugin's
 * peer ranges and README on a branch of its own and opened as a pull request;
 * a release that fails opens an issue naming the layer and carrying the full
 * output. Both paths look for an existing pull request or issue first, so a
 * schedule that fires every few hours does not pile up duplicates.
 *
 * Only releases newer than the highest supported one are candidates. Older
 * unlisted releases are skipped: a plugin that works on a newer harness is not
 * obliged to claim support for everything behind it, and testing them on every
 * tick would spend minutes to learn nothing new.
 */

import { execFile } from 'node:child_process'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { compareVersions, readManifest, readSupported, writeSupported } from './compat-versions.mjs'
import { verifyRelease } from './compat-verify.mjs'

const run = promisify(execFile)

/** The harness package whose releases drive the watch. */
const HARNESS = '@deepseek-ai/dsh'

/**
 * Every release published for the harness.
 * @returns version strings in registry order.
 */
async function publishedReleases() {
  const { stdout } = await run('npm', ['view', HARNESS, 'versions', '--json'], { maxBuffer: 8 * 1024 * 1024 })
  const parsed = JSON.parse(stdout)
  return Array.isArray(parsed) ? parsed : [parsed]
}

/**
 * Releases newer than everything the plugin already declares.
 * @param supported - releases the plugin declares, oldest first.
 * @param published - every published release.
 * @returns candidate releases, oldest first.
 */
function candidatesOf(supported, published) {
  const highest = supported[supported.length - 1]
  return published
    .filter(version => compareVersions(version, highest) > 0)
    .sort(compareVersions)
}

/**
 * Run a `gh` subcommand, returning stdout or undefined when it fails. A failure
 * here means the lookup could not be answered, which the caller treats as "no
 * existing item" only for queries and as fatal for mutations.
 * @param args - gh arguments.
 * @param cwd - working directory, which determines the repository.
 * @returns stdout on success.
 */
async function gh(args, cwd) {
  const { stdout } = await run('gh', args, { cwd, maxBuffer: 8 * 1024 * 1024 })
  return stdout
}

/**
 * Whether a pull request already exists for one head branch, in any state, so
 * a merged or closed one is not proposed again.
 * @param head - head branch name.
 * @param cwd - repository directory.
 * @returns true when one exists.
 */
async function pullRequestExists(head, cwd) {
  const stdout = await gh(['pr', 'list', '--head', head, '--state', 'all', '--json', 'number'], cwd)
  return JSON.parse(stdout).length > 0
}

/**
 * Whether an issue with this exact title already exists, in any state.
 * @param title - issue title.
 * @param cwd - repository directory.
 * @returns true when one exists.
 */
async function issueExists(title, cwd) {
  const stdout = await gh(['issue', 'list', '--search', `in:title "${title}"`, '--state', 'all', '--json', 'title'], cwd)
  return JSON.parse(stdout).some(issue => issue.title === title)
}

/**
 * Commit the widened compatibility list on a fresh branch and open a pull
 * request against the plugin's own branch.
 * @param context - plugin directory, plugin name, base branch, and release.
 * @param result - the passing verification result, quoted in the body.
 */
async function openPullRequest({ projectDir, plugin, branch, version }, result) {
  const head = `compat/${plugin}-dsh-${version}`
  if (await pullRequestExists(head, projectDir)) {
    process.stdout.write(`SKIP ${version}: pull request ${head} already exists\n`)
    return
  }
  const supported = await readSupported(projectDir)
  await writeSupported(projectDir, [...supported, version])
  await run('git', ['checkout', '-b', head], { cwd: projectDir })
  await run('git', ['add', 'package.json', 'README.md'], { cwd: projectDir })
  await run('git', ['commit', '-m', `${plugin}: 支持 DSH ${version}`], { cwd: projectDir })
  await run('git', ['push', '--set-upstream', 'origin', head], { cwd: projectDir })
  const body = [
    `巡检确认 \`${plugin}\` 兼容 DSH \`${version}\`，已把它加进 peer 范围和 README 的兼容列表。`,
    '',
    '三层验证均通过：',
    '',
    `- \`typecheck\` — 两个程序都对着 \`${version}\` 的类型声明编译通过`,
    `- \`probe\` — ${result.details.probe || '(无输出)'}`,
    `- \`smoke\` — 真实 pnpm profile 中确认解析到该版本，并经 Cordis Loader 加载运行`,
    '',
    '```',
    result.details.smoke,
    '```',
    '',
    `复现：\`node scripts/compat-verify.mjs --project <插件目录> ${version}\``,
  ].join('\n')
  await gh(['pr', 'create', '--base', branch, '--head', head, '--title', `${plugin}: 支持 DSH ${version}`, '--body', body], projectDir)
  process.stdout.write(`PR ${head}\n`)
}

/**
 * Open an issue naming the layer that rejected a release.
 * @param context - plugin directory, plugin name, and release.
 * @param result - the failing verification result.
 */
async function openIssue({ projectDir, plugin, version }, result) {
  const title = `DSH ${version} 与 ${plugin} 不兼容`
  if (await issueExists(title, projectDir)) {
    process.stdout.write(`SKIP ${version}: issue「${title}」already exists\n`)
    return
  }
  const body = [
    `巡检发现 DSH \`${version}\` 已发布，但 \`${plugin}\` 在 **${result.stage}** 阶段失败。`,
    '',
    `失败前通过的阶段：${Object.keys(result.details).filter(stage => stage !== result.stage).join('、') || '（无）'}`,
    '',
    `## ${result.stage} 输出`,
    '',
    '```',
    result.details[result.stage],
    '```',
    '',
    `复现：\`node scripts/compat-verify.mjs --project <插件目录> ${version}\``,
  ].join('\n')
  await gh(['issue', 'create', '--title', title, '--body', body], projectDir)
  process.stdout.write(`ISSUE ${title}\n`)
}

/** Parse argv into watch options. */
function parseArgs(argv) {
  const options = { project: process.cwd(), branch: undefined, plugin: undefined, apply: false, versions: [] }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--project') options.project = resolve(argv[index += 1])
    else if (argument === '--branch') options.branch = argv[index += 1]
    else if (argument === '--plugin') options.plugin = argv[index += 1]
    else if (argument === '--version') options.versions.push(argv[index += 1])
    else if (argument === '--apply') options.apply = true
    else throw new Error(`unknown argument: ${argument}`)
  }
  return options
}

/**
 * Check one plugin for unverified harness releases.
 * @param options - parsed watch options.
 * @returns per-candidate verification results.
 */
export async function watch(options) {
  const projectDir = options.project
  const { json } = await readManifest(projectDir)
  const plugin = options.plugin ?? options.branch?.split('/').pop() ?? json.name
  const supported = await readSupported(projectDir)
  const candidates = options.versions.length > 0
    ? options.versions
    : candidatesOf(supported, await publishedReleases())
  if (candidates.length === 0) {
    process.stdout.write(`no unverified DSH release; ${plugin} declares up to ${supported[supported.length - 1]}\n`)
    return []
  }
  process.stdout.write(`candidates: ${candidates.join(', ')}\n`)
  const results = []
  for (const version of candidates) {
    const result = await verifyRelease(projectDir, version)
    results.push(result)
    if (result.ok) {
      const [resolution] = result.details.smoke.split('\n')
      process.stdout.write(`PASS ${version} — ${resolution}\n`)
    } else {
      process.stdout.write(`FAIL ${version} (${result.stage})\n`)
    }
    if (!options.apply) continue
    if (result.ok) {
      if (options.branch === undefined) throw new Error('--apply needs --branch to open a pull request against')
      await openPullRequest({ projectDir, plugin, branch: options.branch, version }, result)
    } else {
      await openIssue({ projectDir, plugin, version }, result)
    }
  }
  return results
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = await watch(parseArgs(process.argv.slice(2)))
  // A failing candidate is reported through an issue, not through this exit
  // code: the watch itself did its job. Only an unexpected throw fails the run.
  process.exitCode = 0
  void results
}
