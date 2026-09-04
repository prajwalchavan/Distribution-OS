# ADR 0012: no websocket sse and gps endpoint

Status: accepted (2026-09-04).

## Decision

Realtime is SSE (dashboards, approvals, vehicle_positions) fanned out through LISTEN/NOTIFY on a dedicated connection; there is no WebSocket transport. GPS points bypass the PowerSync queue: the device buffers them locally and posts batches to `POST /gps/points` keyed by (trip_id, device_id, ts), so hundreds of location rows can never queue ahead of a cash receipt. Decisions D4, D5.
