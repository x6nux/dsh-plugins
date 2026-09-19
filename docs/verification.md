# Verification

Verified on macOS with Node.js 24.14.1 and npm-installed DSH 0.1.6-alpha.1. The plugin's dependencies came from npm, with no workspace aliases, symlinks into a checkout, or unpublished DSH exports.

One published plugin build supports DSH `0.1.5-rc.1`, `0.1.5-rc.2`, `0.1.6-alpha.1`, and `0.1.6-alpha.2`; the peer ranges name exactly those releases and `src/conversion/host-image-offload.ts` resolves the image-offload vocabulary of whichever one is installed. Development declarations come from `0.1.6-alpha.2`. See "Multi-release verification" below for what was run against each.

## Local checks

- `npm run typecheck`: strict Host and Client programs against installed declarations.
- `npm test`: builds both artifacts, then runs the adapter, catalog, configuration, settings, loader, image/history conversion, and browser-factory suites.
- `npm pack`: builds a distributable tarball containing the bundle patch, Host ESM, browser module factory, type declarations, license, and documentation.

The published UI primitives bundle references a missing source map. Vitest prints an upstream missing-map warning; it does not affect execution or assertions.

## Isolated installed checks

Create an empty temporary consumer directory and install the compatible CLI plus the tarball there:

```sh
npm init -y
npm install --ignore-scripts @deepseek-ai/dsh@0.1.6-alpha.1 /absolute/path/to/dsh-x6nux-opencode-0.1.0.tgz
```

Set `DSH_HOME` to that consumer's `home` directory before invoking its CLI. Install the bundle into the headless profile:

```sh
DSH_HOME="$PWD/home" ./node_modules/.bin/dsh plugin --profile headless add /absolute/path/to/dsh-x6nux-opencode-0.1.0.tgz
DSH_HOME="$PWD/home" ./node_modules/.bin/dsh --profile headless --dump-config
```

The tested pnpm installation initially stopped for dependency build-policy decisions. In the temporary profile's `pnpm-workspace.yaml`, set `allowBuilds` entries for `@google/genai` and `protobufjs` to `false`, preserving other generated fields, then repeat installation. This keeps those scripts disabled. The second installation completed and added the bundle to the profile manifest.

From this plugin project, run:

```sh
npm run verify:installed -- /absolute/path/to/consumer
npm run verify:headless -- /absolute/path/to/consumer
```

The installed smoke resolves the tarball's module and its shared DSH services from the consumer, mounts them through the actual Cordis Loader without an import mock, queries the catalog, streams three requests, checks session-header stability and isolation, checks authorization and User-Agent, and disposes the adapter to verify route removal. The fixture gateway binds an OS-allocated loopback port and closes it after the test.

The headless smoke invokes the consumer's official `dsh --profile headless` launcher with a temporary profile overlay and a local gateway. It selects the OpenCode Go provider, completes a task with `standalone-ok`, checks the outgoing session header, and removes the temporary overlay. The test has a bounded child-process timeout and waits for teardown.

## Browser verification

The tarball was installed into a separate Web profile in the same temporary Harness home. The official `dsh web` server started on an OS-allocated port. Browser inspection confirmed the OpenCode Go settings entry, API-key field, advanced configuration, and a successful model-list response. Toggling the provider off and on updated the page through the Host settings service. No real API key was entered, and no real paid model completion was requested.

The browser-factory test additionally evaluates the distributed `lib/client.js` against the published React/store/UI module table, checks the package ID, mounts the settings section, and verifies CSS insertion.

## Subscription usage verification (0.1.1)

The usage tests invoke the actual published Typert Host gateway against a local HTTP fixture, checking the Bearer credential, credential changes, all three windows, and failure handling. Browser component tests check provider switching, polling cleanup, monthly details, and failed-refresh behavior. Adapter tests cover non-zero cached input in OpenAI, DeepSeek, and Kimi usage fields.

The local Web profile was also checked against the real read-only OpenCode Go usage endpoint. The button renders immediately before the model selector, and its details show rolling, weekly, and monthly percentages and local reset times. This check sends no model-generation request. The manual Remote codec supports both the published DSH `schema` shape and the current source build's `create()` shape.

## Dynamic model catalog verification

The dynamic catalog change passes all 140 tests plus the Host/Client build. Its offline regression fixtures cover Union Alpha and an arbitrary future id absent from pi-ai, immediate discovery and picker refresh, metadata arriving after a model id, HTTP ETag revalidation, concurrent refreshes, metadata outages, gateway outages, removal of retired models, malformed metadata, and supported reasoning controls. Real SDK streams against a local HTTP gateway verify Chat Completions, Responses, and Anthropic Messages paths for models with no built-in entry, including the Anthropic SDK's `/v1/messages` suffix.

A read-only check against the live OpenCode Go listing and models.dev resolved 36 of 38 advertised ids, including `union-alpha`; `deepseek-flash` and `hy3-preview` had no metadata. Those ids remain visible with a configuration diagnostic. This check did not send a generation request or establish that every advertised id is currently callable for an account.

## Multi-release verification

Each supported release was installed into its own pnpm profile, the layout `dsh plugin add` produces, so the plugin's peer resolution answers with the harness the profile carries rather than with the newest release in the range:

```sh
npm init -y
pnpm add --ignore-scripts @deepseek-ai/dsh@<release> @deepseek-ai/dsh-llm@<release> \
  @deepseek-ai/cordis-plugin-loader@1.0.3 @deepseek-ai/cordis@4.0.2
pnpm add --ignore-scripts /absolute/path/to/dsh-x6nux-opencode-<version>.tgz
```

Resolution was read back from the installed plugin's own require path before each run; every profile answered with its own release. `npm run verify:installed` then passed on all four: package resolution, catalog, streamed text, session headers, attribution, authorization, and route removal.

The Host and Client type programs compile against both `0.1.5-rc.2` and `0.1.6-alpha.2` declarations. `tests/host-image-offload.spec.ts` covers both offload branches by shaping the module graph like the release each serves, so it states the same expectations whichever harness is installed.

Under `0.1.5-rc.2`, four cases in `tests/conversion-context.spec.ts` fail by design: they assert the `0.1.6` surface-owned contract — an `IMAGE_OFFLOAD_REQUIRED` refusal and request versions skipped for marked occurrences — which that release does not have. Every other conversion case passes there against the real `0.1.5` modules.

`npm run verify:headless` was not completed for this change: the CLI in these temporary pnpm profiles exits silently without writing a profile home, so the headless launcher path is unverified across releases. The installed smoke covers the same adapter through the real Cordis Loader.

## Remaining limits

Real paid OpenCode Go completions, Desktop, non-macOS platforms, and DSH releases outside the four named above are not verified. The Web settings page and usage pill were exercised only against `0.1.6-alpha.*`; on `0.1.5-rc.*` the Client program compiles and the bundled client modules are unchanged, but no browser session was run. The automated gateway tests preserve the adapter's request and replay semantics but cannot establish account validity or live provider availability.
