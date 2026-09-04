/**
 * Trip-scoped background location (docs/07-offline-sync.md §7.5, docs/08-frontend-architecture.md).
 * `TaskManager.defineTask` must run at module top level; the task buffers points in a device-local table
 * OUTSIDE PowerSync and posts batches to POST /gps/points. Implemented in the Delivery slice (weeks 16–18).
 */
export const LOCATION_TASK = 'dos-trip-location'
