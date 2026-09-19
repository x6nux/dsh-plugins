/**
 * Runtime probe for `compat-verify`'s second layer: does the installed harness
 * still offer an image-offload vocabulary this plugin can use?
 *
 * `src/conversion/host-image-offload.ts` picks between the two generations at
 * runtime through a type assertion, so tsc never sees these symbols and a
 * release that dropped both would type-check clean and fail on the first image
 * request. Either vocabulary is acceptable; neither is a compatibility break.
 *
 * Run from the plugin project root with dependencies installed.
 */
const llm = await import('@deepseek-ai/dsh-llm')

const surface = typeof llm.requiredImageOffload === 'function'
  && typeof llm.projectOffloadedImages === 'function'
const route = typeof llm.offloadRequestImagesWithPolicy === 'function'

if (surface) console.log('surface-owned offload (requiredImageOffload + projectOffloadedImages)')
else if (route) console.log('route-owned offload (offloadRequestImagesWithPolicy)')
else {
  console.error('@deepseek-ai/dsh-llm exposes neither offload vocabulary; image requests cannot be projected')
  process.exit(1)
}
