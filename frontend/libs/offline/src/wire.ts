/**
 * The wire shapes, named — never re-declared.
 *
 * `@dos/contracts` publishes the four `sync` procedures as Zod SCHEMAS (values). A device bundle has
 * no business carrying Zod or the oRPC contract at runtime, so every one of them is imported
 * `import type` and read through `z.input` / `z.infer`: the names below are erased entirely at build
 * time, and a column the backend renames still breaks this package's typecheck.
 *
 * Inputs use `z.input` (what a CALLER passes — a field with a default is optional there) and outputs
 * `z.infer` (what the server really answers).
 */
import type { z } from 'zod'
import type {
  GpsPointsInput,
  GpsPointsOutput,
  SyncErrorsListInput,
  SyncErrorsListOutput,
  SyncManifestInput,
  SyncManifestOutput,
  SyncPullInput,
  SyncPullOutput,
  SyncUploadInput,
  SyncUploadOutput,
} from '@dos/contracts'

export type ManifestInput = z.input<typeof SyncManifestInput>
export type ManifestOutput = z.infer<typeof SyncManifestOutput>
export type PullInput = z.input<typeof SyncPullInput>
export type PullOutput = z.infer<typeof SyncPullOutput>
export type UploadInput = z.input<typeof SyncUploadInput>
export type UploadOutput = z.infer<typeof SyncUploadOutput>
export type ErrorsListInput = z.input<typeof SyncErrorsListInput>
export type ErrorsListOutput = z.infer<typeof SyncErrorsListOutput>
export type GpsInput = z.input<typeof GpsPointsInput>
export type GpsOutput = z.infer<typeof GpsPointsOutput>

export type { SyncColumn, SyncColumnType, SyncOp, SyncTableManifest } from '@dos/contracts'
