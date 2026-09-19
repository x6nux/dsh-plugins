/**
 * Image-offload seam across the two harness generations this plugin installs
 * into. The vocabulary moved between them, so the published bundle resolves
 * the installed one at load instead of pinning a single host release.
 *
 * `0.1.6-alpha.*` gives the offload decision to the surface: the durable
 * message marks each offloaded occurrence, `requiredImageOffload` reports how
 * many more a route still needs removed, the route refuses with
 * `IMAGE_OFFLOAD_REQUIRED` carrying that count, and `projectOffloadedImages`
 * renders the marks the surface already made.
 *
 * `0.1.5-rc.*` has neither the marks nor that failure: a route truncates its
 * own oldest occurrences through `offloadRequestImagesWithPolicy` and sends
 * what remains. The same release also reads a whole-image pixel budget where
 * `0.1.6` reads exact target dimensions; {@link requestImageTarget} answers
 * both at once rather than choosing.
 *
 * Every declaration here is written structurally rather than imported from
 * the host, so this module type-checks against either generation.
 *
 * @module dsh-x6nux-opencode/conversion/host-image-offload
 */

import * as llm from '@deepseek-ai/dsh-llm'
import { LlmError } from '@deepseek-ai/dsh-llm'
import type { Message } from '@deepseek-ai/dsh-llm'
import { requestImageDimensions } from '@deepseek-ai/dsh-attachment'
import type { AttachmentStore, ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'

/** Failure code a `0.1.6` route raises when the surface must offload more occurrences. */
const IMAGE_OFFLOAD_REQUIRED = 'IMAGE_OFFLOAD_REQUIRED'

/** One durable image occurrence, carrying the surface mark only `0.1.6` sets. */
interface OffloadableImageBlock {
  type: 'image'
  attachment: ImageAttachmentRef
  offloaded?: true
}

/** The `0.1.6` surface-owned offload vocabulary; absent on `0.1.5`. */
interface SurfaceOffloadApi {
  requiredImageOffload: (
    messages: readonly Message[],
    budget: { representation: 'base64'; maxBytes: number },
    versionBytes: (block: OffloadableImageBlock) => number,
  ) => number
  projectOffloadedImages: (
    messages: readonly Message[],
    placeholder: (ref: ImageAttachmentRef) => string,
  ) => readonly Message[]
}

/** The `0.1.5` route-owned offload vocabulary; absent on `0.1.6`. */
interface RouteOffloadApi {
  offloadRequestImagesWithPolicy: (
    messages: readonly Message[],
    policy: {
      representation: 'base64'
      maxBytes: number
      byteLength: (ref: ImageAttachmentRef) => number
      placeholder: (ref: ImageAttachmentRef) => string
    },
  ) => readonly Message[]
}

const host = llm as unknown as Partial<SurfaceOffloadApi & RouteOffloadApi>

/** Whether the installed host owns the offload decision and marks its result. */
const surfaceOffload = typeof host.requiredImageOffload === 'function'
  && typeof host.projectOffloadedImages === 'function'

/**
 * Whether one durable occurrence is already offloaded, so no request version
 * is derived for it. Always false on `0.1.5`: that release projects every
 * occurrence itself and would ask for the byte length of one this conversion
 * skipped. A mark left on durable history by a later release — a downgraded
 * install reading its own log back — is therefore sent as an image again,
 * within the same request budget, instead of failing the request.
 */
export function isOffloaded(block: { type: 'image' }): boolean {
  return surfaceOffload && (block as OffloadableImageBlock).offloaded === true
}

/** Per-route budgets from which each request image's target is derived. */
export interface RequestImageBudget {
  /** Total-pixel budget; larger sources are downscaled proportionally. */
  maxPixels: number
  /** Encoded-byte target for one request image. */
  maxBytes: number
}

/**
 * Deterministic request target for one source under the route budgets.
 *
 * `0.1.5` reads a whole-image pixel budget and `0.1.6` reads the exact target
 * dimensions the route derived from it. Both derive their variant identity
 * from the fields they read and ignore the rest, so one object carrying both
 * serves either service — and no probe has to decide which one answers, which
 * matters because the store instance comes from the harness rather than from
 * this plugin's own module resolution.
 *
 * @param ref - durable normalized attachment whose request version is derived.
 * @param budget - route pixel and encoded-byte budgets.
 * @returns the request target in both vocabularies.
 */
export function requestImageTarget(
  ref: ImageAttachmentRef,
  budget: RequestImageBudget,
): Parameters<AttachmentStore['readImageRequest']>[1] {
  const target = {
    ...requestImageDimensions(ref.width, ref.height, budget.maxPixels),
    maxPixels: budget.maxPixels,
    maxBytes: budget.maxBytes,
  }
  return target as Parameters<AttachmentStore['readImageRequest']>[1]
}

/**
 * Resolve the exact request history under one accumulated base64 bound.
 *
 * On `0.1.6` the bound is the surface's to satisfy: an excess fails with
 * `IMAGE_OFFLOAD_REQUIRED` naming how many more oldest occurrences must be
 * offloaded, and the returned history renders the marks already present. On
 * `0.1.5` the route removes its own oldest occurrences to fit and returns
 * what remains, because no surface will act on the refusal.
 *
 * @param messages - derived request history, oldest first.
 * @param maxBytes - accumulated base64 payload bound; omission leaves it unchecked.
 * @param versionBytes - exact request-version byte length of one retained occurrence.
 * @param placeholder - model-visible replacement for one offloaded occurrence.
 * @returns the history to convert, with offloaded occurrences as placeholder text.
 * @throws {LlmError} `IMAGE_OFFLOAD_REQUIRED` on `0.1.6` when retained images exceed `maxBytes`.
 */
export function projectRequestImages(
  messages: readonly Message[],
  maxBytes: number | undefined,
  versionBytes: (ref: ImageAttachmentRef) => number,
  placeholder: (ref: ImageAttachmentRef) => string,
): readonly Message[] {
  const { requiredImageOffload, projectOffloadedImages, offloadRequestImagesWithPolicy } = host
  if (surfaceOffload && requiredImageOffload !== undefined && projectOffloadedImages !== undefined) {
    if (maxBytes !== undefined) {
      const offloadImages = requiredImageOffload(
        messages,
        { representation: 'base64', maxBytes },
        block => versionBytes(block.attachment),
      )
      if (offloadImages > 0) {
        // `offloadImages` is not declared on the `0.1.5` failure type, which
        // this module also compiles against; the branch only runs on `0.1.6`,
        // where the field is read back off the failure.
        const failure = { offloadImages } as unknown as ConstructorParameters<typeof LlmError>[2]
        throw new LlmError(
          `pi-ai request images exceed the ${maxBytes}-byte base64 bound; ${offloadImages} more oldest occurrence(s) must be offloaded.`,
          IMAGE_OFFLOAD_REQUIRED,
          failure,
        )
      }
    }
    return projectOffloadedImages(messages, placeholder)
  }
  if (typeof offloadRequestImagesWithPolicy !== 'function') {
    throw new LlmError(
      'llm-opencode-go: the installed harness exposes no image-offload projection; images cannot be sent',
      'UNSUPPORTED_CONTENT',
    )
  }
  if (maxBytes === undefined) return messages
  return offloadRequestImagesWithPolicy(messages, {
    representation: 'base64',
    maxBytes,
    byteLength: versionBytes,
    placeholder,
  })
}
