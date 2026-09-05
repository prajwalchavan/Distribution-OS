# ADR 0010: powersync for staff only

Status: accepted (2026-09-04).

## Decision

PowerSync over Postgres logical replication is the sync engine for the four staff roles only. The retailer surface is online-first (oRPC + TanStack Query) and never a PowerSync client, because PowerSync bills per peak client and retailers do not need offline writes. `frontend/libs/offline` is the only PowerSync-touching code so the engine can be swapped or self-hosted. Decisions D2, D10.
