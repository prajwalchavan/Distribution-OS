# Backend module implementation pattern

The reference implementation is `catalog` + `tenant-catalog` (commit "catalog slice"). Every backend module follows it exactly; deviations need a reason in the PR.

## 1. Contract first (`shared/contracts/src/<module>.ts`)

- Zod 4 schemas for every input/output. Reuse `common.ts`: `IdSchema`, `PaiseSchema`, `PiecesSchema`, `BpsSchema`, `PhoneSchema`, `GstinSchema`, `StateCodeSchema`, `MutationBase` (adds `idempotencyKey`), `QueryBoolSchema` / `QueryIntSchema` for **GET inputs** (query strings arrive as strings; plain `z.boolean()` / `z.number()` would 400).
- Money is integer paise, quantities are integer pieces, percentages basis points. Dates are ISO strings.
- Output schemas never include purchase cost or margin unless the procedure is explicitly back-office (`requireRole(BACK_OFFICE)`), and such procedures are named so (`costs`, `upsertCost`).
- Procedures are declared in `contract.ts` under the module key with an explicit `oc.route({ method, path, summary })`; GET for reads, POST for mutations. Lists paginate with `limit` + `cursor` (the last row's UUIDv7 `id`) and return `{ items, nextCursor }`.
- Every mutation input extends `MutationBase` and carries the client-generated `id` (UUIDv7) of the row it creates.
- Export the file from `index.ts`, then `pnpm --filter @dos/contracts build` (the api consumes `dist/`).

## 2. Service (`backend-services/core/src/modules/<module>/<module>.service.ts`)

```ts
@Injectable()
export class XService {
  constructor(@Optional() @Inject(DB) private readonly db: Db | null) {}

  async mutate(input: In): Promise<Out> {
    requireRole(BACK_OFFICE) // clear 403; RLS remains the guarantee
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        /* writes with tx */
      }),
    )
  }
}
```

- `withTenant` opens the transaction, drops to `app_rw`, sets the tenant settings. Never query outside it.
- `idempotent` wraps every mutation (same key + same payload → stored response; different payload → 409).
- State changes go through `shared/domain` machines: `orderMachine.next(state, event)`; never assign a state string by hand. Money math through `@dos/domain` (`multiply`, `percentOf`, `allocate`, `splitGst`, `roundToRupee`).
- Cross-module calls use the other module's exported service (import from `../<module>/index.js`), never its tables. If module A needs to react to B, B writes an `outbox_events` row and the worker relays it.
- Map DB rows to contract shapes with small `toX(row)` functions at the bottom of the file; do not return Drizzle rows directly.

## 3. Controller + module

- One `@Controller()` with `@UseGuards(TenantGuard)`; each procedure: `@Implement(contract.x.y) y(@OwnsReply() _reply: unknown) { return implement(contract.x.y).handler(({ input }) => this.svc.y(input)) }`.
- `<module>.module.ts` imports `TenancyModule` (for the guard) plus the modules whose services it uses; exports its service. `index.ts` exports only the module, the service and deliberately shared helpers.
- Add the module to the `modules` list (and its contract key to `contractKeys`) of every service in `backend-services/*-service/src/service.ts` that should serve it, and export it from `backend-services/core/src/index.ts`.

## 4. Spec (`<module>.spec.ts`)

- Use `src/testing/app.ts`: `bootTestApp([Modules])`, `call(app, actor, 'GET'|'POST', url, payload)`, `Actor` headers.
- Wrap in `describeDb` (skips without `DATABASE_URL`). Create the fixtures the spec needs directly with `@dos/db` (tenant, users, memberships, and `bootstrapTenant(db, tenantId)` when accounts/locations/series are needed), keyed by a unique `run` suffix so specs can run in parallel against one database.
- Always include: the happy path, an idempotent replay, a role that must be refused (403) or must not see a row, and the 401 without context.
- Run: `DATABASE_URL=postgres://dos:dos@127.0.0.1:5439/dos pnpm --filter @dos/core test -- src/modules/<module>`.

## 5. Definition of done for a slice

`pnpm docs:readme` run (READMEs regenerated from the contract; CI checks they are current). `pnpm typecheck && pnpm lint && DATABASE_URL=... pnpm test` green from the repo root; contract, service, controller, module, spec present; no cost/margin column reachable by salesperson/delivery/retailer roles; CLAUDE.md untouched unless a new convention was introduced.

## 6. Notes added 2026-09-04

- The repo-root `.env` is auto-loaded (`loadDotenv()` from `@dos/db`), so `describeDb` specs run against the local database by default; keep fixtures unique per run.
- Document numbers come from `src/platform/numbering.ts` (`nextDocumentNumber`), moved out of procurement by the orders slice.
- Register offline-sync handlers for your tables in `onModuleInit` through `SyncRegistry` (see `modules/sync`); throw `SyncRejection` for business errors.
