/**
 * The shopkeeper service (:3006) — the composition itself lives in `@dos/core` (`libs/core/src/service/definitions.ts`), and
 * this package re-exports it as its own `service`.
 *
 * WHY IT IS THERE AND NOT HERE. The founder's deployment decision (2026-09-05, docs/26 §7) is that a
 * small installation runs ONE process with all eight services behind path prefixes (`runAll()`), and
 * a large one runs eight processes. Both mount THIS object. Two copies of the module list — one in
 * the package, one in the all-in-one runtime — would eventually serve different modules or different
 * roles on the same URL, and nothing would notice. The package is still an independent, separately
 * runnable service (docs/19): its port, README, spec and `main.ts` are its own.
 */
export { retailerServiceDefinition as service } from '@dos/core'
