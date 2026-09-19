/**
 * Both branches of the image-offload seam, each against a module graph shaped
 * like the release it serves, so the suite states the same expectations
 * whichever harness generation is installed. The `0.1.6` branch additionally
 * runs end to end in `conversion-context.spec.ts` against the real host.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { Message } from '@deepseek-ai/dsh-llm'

const ref: ImageAttachmentRef = {
  attachmentId: AttachmentId(`sha256:${'a'.repeat(64)}`),
  mediaType: 'image/png',
  bytes: 4,
  width: 4000,
  height: 2000,
}

/** Load the seam against a module graph shaped like a `0.1.5` install. */
async function legacySeam(offload = vi.fn((messages: readonly Message[]) => messages)) {
  vi.resetModules()
  // An ESM namespace answers `undefined` for an export a release does not
  // have; vitest's mock proxy refuses the access instead, so the removed
  // names are returned as `undefined` rather than left out.
  vi.doMock('@deepseek-ai/dsh-llm', async (importOriginal) => ({
    ...await importOriginal<Record<string, unknown>>(),
    requiredImageOffload: undefined,
    projectOffloadedImages: undefined,
    offloadRequestImagesWithPolicy: offload,
  }))
  return { seam: await import('../src/conversion/host-image-offload.ts'), offload }
}

/** Load the seam against a module graph shaped like a `0.1.6` install. */
async function surfaceSeam(
  required = vi.fn(() => 0),
  project = vi.fn((messages: readonly Message[]) => messages),
) {
  vi.resetModules()
  vi.doMock('@deepseek-ai/dsh-llm', async (importOriginal) => ({
    ...await importOriginal<Record<string, unknown>>(),
    requiredImageOffload: required,
    projectOffloadedImages: project,
    offloadRequestImagesWithPolicy: undefined,
  }))
  return { seam: await import('../src/conversion/host-image-offload.ts'), required, project }
}

afterEach(() => {
  vi.doUnmock('@deepseek-ai/dsh-llm')
  vi.doUnmock('@deepseek-ai/dsh-attachment')
  vi.resetModules()
})

describe('host image request target', () => {
  // A budget above the source keeps the source dimensions, so the assertion
  // states the shape without restating the projection's own arithmetic.
  it('carries the pixel budget 0.1.5 reads and the dimensions 0.1.6 reads', async () => {
    const { seam } = await legacySeam()
    const budget = { maxPixels: ref.width * ref.height, maxBytes: 7 }
    expect(seam.requestImageTarget(ref, budget))
      .toEqual({ width: ref.width, height: ref.height, maxPixels: budget.maxPixels, maxBytes: 7 })
  })
})

describe('host image offload seam on 0.1.5', () => {
  it('truncates its own oldest occurrences instead of refusing the request', async () => {
    const projected: Message[] = []
    const { seam, offload } = await legacySeam(vi.fn(() => projected))
    const messages: Message[] = []
    const result = seam.projectRequestImages(messages, 8, () => 5, () => 'gone')
    expect(result).toBe(projected)
    const policy = offload.mock.calls[0]?.[1] as {
      representation: string
      maxBytes: number
      byteLength: (value: ImageAttachmentRef) => number
      placeholder: (value: ImageAttachmentRef) => string
    }
    expect(policy.representation).toBe('base64')
    expect(policy.maxBytes).toBe(8)
    expect(policy.byteLength(ref)).toBe(5)
    expect(policy.placeholder(ref)).toBe('gone')
  })

  it('leaves history untouched when the request declares no payload bound', async () => {
    const { seam, offload } = await legacySeam()
    const messages: Message[] = []
    expect(seam.projectRequestImages(messages, undefined, () => 1, () => '')).toBe(messages)
    expect(offload).not.toHaveBeenCalled()
  })

  it('sends an occurrence a later release marked offloaded, having no mark to read', async () => {
    const { seam } = await legacySeam()
    expect(seam.isOffloaded({ type: 'image', offloaded: true } as { type: 'image' })).toBe(false)
  })
})

describe('host image offload seam on 0.1.6', () => {
  // The count also reaches the surface as the failure's `offloadImages`,
  // which only a `0.1.6` `LlmError` carries; `conversion-context.spec.ts`
  // asserts that field against the installed host.
  it('refuses with the count the surface must still offload', async () => {
    const { seam } = await surfaceSeam(vi.fn(() => 2))
    expect(() => seam.projectRequestImages([], 8, () => 5, () => 'gone'))
      .toThrow(/2 more oldest occurrence/)
    expect(() => seam.projectRequestImages([], 8, () => 5, () => 'gone'))
      .toThrow(expect.objectContaining({ code: 'IMAGE_OFFLOAD_REQUIRED' }))
  })

  it('renders the marks the surface already made once the request fits', async () => {
    const projected: Message[] = []
    const { seam, project } = await surfaceSeam(vi.fn(() => 0), vi.fn(() => projected))
    expect(seam.projectRequestImages([], 8, () => 5, () => 'gone')).toBe(projected)
    expect(project.mock.calls[0]?.[1]?.(ref)).toBe('gone')
  })

  it('reads the surface mark off a durable occurrence', async () => {
    const { seam } = await surfaceSeam()
    expect(seam.isOffloaded({ type: 'image', offloaded: true } as { type: 'image' })).toBe(true)
    expect(seam.isOffloaded({ type: 'image' })).toBe(false)
  })
})
