/**
 * Verify one plugin against specific DSH releases.
 *
 * ```
 * node scripts/compat-verify.mjs                      # every release the plugin already declares
 * node scripts/compat-verify.mjs 0.1.6-alpha.3        # a candidate, added to the peer ranges for the run
 * node scripts/compat-verify.mjs --project plugins/x  # a plugin that is not the working directory
 * node scripts/compat-verify.mjs --json out.json      # also write structured results
 * ```
 *
 * Each release gets three layers, cheapest first, and the first failure stops
 * that release:
 *
 * 1. `typecheck` — compile both programs against that release's declarations.
 *    This covers every host export the source names statically; a missing one
 *    is a tsc error, so no separate symbol list has to be maintained.
 * 2. `offload` — `src/conversion/host-image-offload.ts` reaches for its symbols
 *    at runtime through a type assertion, which tsc cannot see. Probe that the
 *    release still offers one of the two image-offload vocabularies.
 * 3. `smoke` — install into a pnpm profile shaped like the one `dsh plugin add`
 *    produces, confirm the plugin's own resolution answers with that release,
 *    then run the plugin's `verify:installed` through the real Cordis Loader.
 *
 * pnpm rather than npm throughout: npm hoists the newest release satisfying the
 * peer range to the top level, so the plugin resolves a different harness than
 * the profile carries and every release appears to pass.
 *
 * Exit code 0 when every release passes, 1 otherwise.
 */

import { execFile } from 'node:child_process'
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { readManifest, readSupported } from './compat-versions.mjs'

const run = promisify(execFile)

/** Peers and dev dependencies that track the harness release. */
const DSH_PACKAGE = /^@deepseek-ai\/dsh-/

/** Entries a fresh install rebuilds, so the scratch copy leaves them out. */
const REBUILT = /^(?:node_modules|lib|\.git)$|\.tgz$/

/** Fixture packages the installed smoke resolves from the profile root. */
const PROFILE_FIXTURES = ['@deepseek-ai/cordis-plugin-loader@1.0.3', '@deepseek-ai/cordis@4.0.2']

/** Layer names in execution order, used in reports. */
export const STAGES = ['typecheck', 'offload', 'smoke']

/**
 * Run a command, capturing output whether it succeeds or fails.
 * @param command - executable name.
 * @param args - argument list.
 * @param cwd - working directory.
 * @returns exit status and combined output.
 */
async function attempt(command, args, cwd) {
  try {
    const { stdout, stderr } = await run(command, args, { cwd, maxBuffer: 64 * 1024 * 1024 })
    return { ok: true, output: `${stdout}${stderr}` }
  } catch (error) {
    const output = `${error.stdout ?? ''}${error.stderr ?? ''}` || String(error.message ?? error)
    return { ok: false, output }
  }
}

/**
 * Copy a plugin project into a scratch directory, leaving out everything a
 * fresh install rebuilds.
 * @param projectDir - plugin project root.
 * @param label - suffix for the scratch directory name.
 * @returns absolute path of the copy.
 */
async function copyProject(projectDir, label) {
  const target = await mkdtemp(join(tmpdir(), `dsh-compat-${label}-`))
  await cp(projectDir, target, { recursive: true, filter: source => !REBUILT.test(basename(source)) })
  return target
}

/**
 * Pin every harness dependency of a manifest copy to one release and, for the
 * peers, widen the range to include it. Without the widened peer range pnpm
 * resolves the candidate away and the profile ends up on an already-supported
 * release.
 * @param dir - scratch copy of the plugin project.
 * @param version - release to pin to.
 */
async function pinHarness(dir, version) {
  const { path, json } = await readManifest(dir)
  for (const section of ['dependencies', 'devDependencies']) {
    for (const name of Object.keys(json[section] ?? {})) {
      if (DSH_PACKAGE.test(name)) json[section][name] = version
    }
  }
  const supported = new Set(await readSupported(dir))
  supported.add(version)
  const range = [...supported].join(' || ')
  for (const name of Object.keys(json.peerDependencies ?? {})) {
    if (DSH_PACKAGE.test(name)) json.peerDependencies[name] = range
  }
  await writeFile(path, `${JSON.stringify(json, null, 2)}\n`)
}

/**
 * Layer 1: install that release's declarations and compile both programs.
 * @param dir - scratch copy with the harness already pinned.
 * @returns stage result.
 */
async function checkTypes(dir) {
  const install = await attempt('pnpm', ['install', '--ignore-scripts', '--no-frozen-lockfile'], dir)
  if (!install.ok) return { ok: false, output: install.output }
  return attempt('npm', ['run', 'typecheck'], dir)
}

/**
 * Layer 2: probe the image-offload vocabulary the runtime seam depends on.
 * Either generation is acceptable; neither means image requests would fail at
 * runtime on a release that type-checks fine.
 * @param dir - scratch copy with dependencies installed.
 * @returns stage result naming which vocabulary answered.
 */
async function checkOffload(dir) {
  const probe = `
    const llm = await import('@deepseek-ai/dsh-llm')
    const surface = typeof llm.requiredImageOffload === 'function' && typeof llm.projectOffloadedImages === 'function'
    const route = typeof llm.offloadRequestImagesWithPolicy === 'function'
    if (surface) console.log('surface-owned offload (requiredImageOffload + projectOffloadedImages)')
    else if (route) console.log('route-owned offload (offloadRequestImagesWithPolicy)')
    else {
      console.error('@deepseek-ai/dsh-llm exposes neither offload vocabulary; image requests cannot be projected')
      process.exit(1)
    }
  `
  return attempt(process.execPath, ['--input-type=module', '-e', probe], dir)
}

/**
 * Layer 3: install the built tarball into a fresh pnpm profile and run the
 * plugin's own installed smoke against it.
 * @param dir - scratch copy with the harness pinned and dependencies installed.
 * @param version - release the profile must carry.
 * @param packageName - plugin package name, used to check resolution.
 * @returns stage result; on success the output ends with the smoke's PASS line.
 */
async function checkSmoke(dir, version, packageName) {
  const pack = await attempt('npm', ['pack', '--silent'], dir)
  if (!pack.ok) return { ok: false, output: pack.output }
  const tarball = pack.output.trim().split('\n').filter(line => line.endsWith('.tgz')).pop()
  if (tarball === undefined) return { ok: false, output: `npm pack produced no tarball:\n${pack.output}` }

  const profile = await mkdtemp(join(tmpdir(), `dsh-profile-${version}-`))
  try {
    await writeFile(join(profile, 'package.json'), `${JSON.stringify({ name: 'dsh-compat-profile', private: true }, null, 2)}\n`)
    const harness = await attempt('pnpm', [
      'add', '--ignore-scripts',
      `@deepseek-ai/dsh@${version}`, `@deepseek-ai/dsh-llm@${version}`, ...PROFILE_FIXTURES,
    ], profile)
    if (!harness.ok) return { ok: false, output: harness.output }
    const plugin = await attempt('pnpm', ['add', '--ignore-scripts', join(dir, tarball)], profile)
    if (!plugin.ok) return { ok: false, output: plugin.output }

    const resolved = await resolvedHarness(profile, packageName)
    if (resolved !== version) {
      return {
        ok: false,
        output: `the installed plugin resolves @deepseek-ai/dsh-llm@${resolved}, not ${version};`
          + ' the profile would have tested a different harness',
      }
    }
    const smoke = await attempt('npm', ['run', 'verify:installed', '--silent', '--', profile], dir)
    // Report the resolution alongside the smoke output so every run states
    // which harness it actually exercised, not just that something passed.
    return { ...smoke, output: `plugin resolves @deepseek-ai/dsh-llm@${resolved}\n${smoke.output}` }
  } finally {
    await rm(profile, { recursive: true, force: true })
  }
}

/**
 * The harness release the installed plugin itself resolves, read through the
 * plugin's own require path rather than the profile root.
 * @param profile - profile directory.
 * @param packageName - plugin package name.
 * @returns resolved version, or a diagnostic string when resolution fails.
 */
async function resolvedHarness(profile, packageName) {
  const probe = `
    const { createRequire } = require('node:module')
    const root = createRequire(${JSON.stringify(join(profile, 'package.json'))})
    const fromPlugin = createRequire(root.resolve(${JSON.stringify(packageName)}))
    process.stdout.write(require(fromPlugin.resolve('@deepseek-ai/dsh-llm/package.json')).version)
  `
  const result = await attempt(process.execPath, ['-e', probe], profile)
  return result.ok ? result.output.trim() : `unresolved (${result.output.trim()})`
}

/**
 * Verify one release end to end.
 * @param projectDir - plugin project root.
 * @param version - release to verify.
 * @returns result with the failing stage when unsuccessful.
 */
export async function verifyRelease(projectDir, version) {
  const { json } = await readManifest(projectDir)
  const dir = await copyProject(projectDir, version)
  try {
    await pinHarness(dir, version)
    const layers = [
      ['typecheck', () => checkTypes(dir)],
      ['offload', () => checkOffload(dir)],
      ['smoke', () => checkSmoke(dir, version, json.name)],
    ]
    const details = {}
    for (const [stage, execute] of layers) {
      const result = await execute()
      details[stage] = result.output.trim()
      if (!result.ok) return { version, ok: false, stage, details }
    }
    return { version, ok: true, details }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** Parse argv into options and the release list. */
function parseArgs(argv) {
  const options = { project: process.cwd(), json: undefined, versions: [] }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--project') options.project = resolve(argv[index += 1])
    else if (argument === '--json') options.json = resolve(argv[index += 1])
    else if (argument.startsWith('--')) throw new Error(`unknown option: ${argument}`)
    else options.versions.push(argument)
  }
  return options
}

/**
 * Verify a list of releases and report one line each.
 * @param projectDir - plugin project root.
 * @param versions - releases to verify; empty means the declared list.
 * @returns per-release results.
 */
export async function verifyReleases(projectDir, versions) {
  const targets = versions.length > 0 ? versions : await readSupported(projectDir)
  const results = []
  for (const version of targets) {
    const result = await verifyRelease(projectDir, version)
    results.push(result)
    if (result.ok) {
      const [resolution] = result.details.smoke.split('\n')
      process.stdout.write(`PASS ${version} — ${resolution}\n`)
    } else {
      process.stdout.write(`FAIL ${version} (${result.stage})\n${result.details[result.stage]}\n`)
    }
  }
  return results
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const options = parseArgs(process.argv.slice(2))
  const results = await verifyReleases(options.project, options.versions)
  if (options.json !== undefined) await writeFile(options.json, `${JSON.stringify(results, null, 2)}\n`)
  process.exitCode = results.every(result => result.ok) ? 0 : 1
}
