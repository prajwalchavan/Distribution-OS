/**
 * The seam between `@dos/offline` and the network.
 *
 * The engine talks to a `SyncTransport` — four functions — and not to the oRPC client, which is what
 * lets the eleven tests of docs/27 §13 run with no network at all. `transportFromApi` is the one
 * adapter an app needs: it takes the `api` half of `@dos/api-client`'s client (already carrying the
 * access token, the single-flight refresh and the 20 s deadline) and hands the engine the procedures.
 *
 * `sync.errors.list` and `delivery.gps.points` are wired only when the app's service serves them: the
 * shop's app has neither (`upload` and `errors.list` are STAFF), and only delivery-service mounts GPS.
 */
import type {
  ErrorsListInput,
  ErrorsListOutput,
  GpsInput,
  GpsOutput,
  ManifestInput,
  ManifestOutput,
  PullInput,
  PullOutput,
  UploadInput,
  UploadOutput,
} from './wire.js'
import type { GpsPostInput, GpsPostOutput, SyncTransport } from './types.js'

/** The shape of the client's `api` router this needs — structural, so nothing imports oRPC here. */
export interface SyncApiLike {
  sync: {
    manifest: (input: ManifestInput) => Promise<ManifestOutput>
    pull: (input: PullInput) => Promise<PullOutput>
    upload: (input: UploadInput) => Promise<UploadOutput>
    errors?: { list: (input: ErrorsListInput) => Promise<ErrorsListOutput> }
  }
  delivery?: { gps?: { points: (input: GpsInput) => Promise<GpsOutput> } }
}

export function transportFromApi(api: SyncApiLike): SyncTransport {
  const list = api.sync.errors?.list
  const points = api.delivery?.gps?.points
  return {
    manifest: (input) => api.sync.manifest(input),
    pull: (input) => api.sync.pull(input),
    upload: (input) => api.sync.upload(input),
    ...(list === undefined ? {} : { listErrors: (input: ErrorsListInput) => list(input) }),
    ...(points === undefined
      ? {}
      : {
          postGpsPoints: async (input: GpsPostInput): Promise<GpsPostOutput> => {
            const answer = await points({
              idempotencyKey: input.idempotencyKey,
              tripId: input.tripId,
              deviceId: input.deviceId,
              points: input.points.map((point) => ({ ...point })),
            })
            return {
              accepted: answer.accepted,
              duplicates: answer.duplicates,
              throttled: answer.throttled,
              retryAfterSeconds: answer.retryAfterSeconds,
            }
          },
        }),
  }
}
