/**
 * Which plan a distributorship is on — read from ONE place (DOS-113).
 *
 * The plan is stored twice by design: `tenants.plan` is what every service reads, `subscriptions.plan`
 * is what this console edits, and the product writes both together wherever it writes either
 * (`admin.tenants.create` takes one `plan` and writes it into both; `admin.subscriptions.upsert`
 * updates the tenant row whenever the plan changes). A screen that prints both prints the same fact
 * twice when they agree and a contradiction when they do not — which is exactly what a walk found:
 * Tarsun read "Pilot" in the header chip and "Pro" in the Subscription block of the same page.
 *
 * So: the SUBSCRIPTION's plan, because that is the plan being paid for and the one this console can
 * change; the tenant row only for a distributorship that has no subscription at all, where it is the
 * only plan there is.
 */
export interface PlannedDistributor {
  plan: string
  subscription: { plan: string } | null
}

export function planShown(item: PlannedDistributor): string {
  return item.subscription?.plan ?? item.plan
}
