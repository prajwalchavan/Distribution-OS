import { contract } from '@dos/contracts'
import { ApiRefusal } from './client.js'
import { Ctx, type RunOptions } from './context.js'
import { allRows } from './coverage.js'
import { makeDay } from './day.js'
import { finishEarlier } from './finish.js'
import { pages } from './helpers.js'
import { addDays, isDemoId } from './ids.js'
import { planCounts } from './plan.js'
import { ensureStanding } from './setup.js'
import { KNOWN_GAPS, Summary, type Section } from './summary.js'
import { readWorld } from './world.js'

/**
 * ONE RUN. Sign in as the owner, read the distributor, make sure the standing pieces are there, then the two
 * halves: finish every earlier day the tool left open, and make `date`. On the very first run — no van of the
 * tool has ever gone out — the day before is made and finished first, so "yesterday's trip settled" is there
 * from the start. At the end, what the run left behind is read back through the API.
 */
export interface RunResult {
  summary: Summary
  exitCode: number
  leadIn: string | null
}

async function guard(ctx: Ctx, section: Section, what: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn()
  } catch (e) {
    if (e instanceof ApiRefusal) {
      ctx.summary.refusedOne(section, what, e.label)
      ctx.log(`  step stopped: ${section}/${what} ${e.label}`)
      return
    }
    throw e
  }
}

export async function runFill(opts: RunOptions): Promise<RunResult> {
  const summary = new Summary()
  summary.dryRun = !opts.commit
  const ctx = new Ctx(opts, summary)
  if (!(await ctx.api.health())) throw new Error(`the API at ${opts.api} does not answer /health`)
  await ctx.signInOwner()
  const date = opts.date
  try {
    ctx.log(`distributor ${opts.tenant} (${ctx.tenantId}), business date ${date}, ${opts.commit ? 'COMMIT' : 'dry run: nothing is written'}`)
    const world = await readWorld(ctx)
    ctx.log(
      `  read: ${String(world.shops.length)} shops, ${String(world.beatIds.length)} beats, ${String(world.items.length)} listed items (${String(world.items.filter((i) => i.ratePaise > 0 && i.available > 0).length)} priced and in stock), ${String(world.suppliers.length)} suppliers`,
    )
    const toolTrips = await pages(
      (cursor) => ctx.read(contract.delivery.trips.list, { limit: 200, ...(cursor ? { cursor } : {}) }),
      5,
    )
    const leadIn = toolTrips.some((t) => isDemoId(t.id)) ? null : addDays(date, -1)
    const standing = await ensureStanding(ctx, world, date, leadIn ?? date)
    ctx.log(
      `  standing: ${String(Object.keys(standing.repBeats).length)} rep beat(s), ${String(Object.keys(standing.creditShops).length)} shop(s) over a limit, ${String(standing.slotShops.length)} stand-in shop(s), ${String(Object.keys(standing.vans).length)} van(s)`,
    )
    if (leadIn) {
      ctx.log(`first run: making ${leadIn} first, so today opens with a day behind it`)
      await guard(ctx, 'yesterday', 'finish', () => finishEarlier(ctx, leadIn))
      await guard(ctx, 'yesterday', `make ${leadIn}`, () => makeDay(ctx, leadIn, standing))
    }
    ctx.log(`finishing what earlier days left open`)
    await guard(ctx, 'yesterday', 'finish', () => finishEarlier(ctx, date))
    ctx.log(`making ${date}`)
    let counts: Record<string, number> = {}
    await guard(ctx, 'driver', `make ${date}`, async () => {
      counts = planCounts(await makeDay(ctx, date, standing))
    })
    if (!opts.commit) summary.note(`the day's plan: ${JSON.stringify(counts)}`)

    const read = await allRows(ctx.api, { owner: ctx.owner }, date).catch((e: unknown) => {
      summary.note(`could not read the result back: ${e instanceof ApiRefusal ? e.label : String(e)}`)
      return { seen: [], notes: [] }
    })
    for (const s of read.seen) {
      const gap = KNOWN_GAPS[`${s.row}:${s.feature}`]
      summary.feature(s.row, s.feature, s.ok ? 'there' : gap ? 'gap' : opts.commit ? 'missing' : 'would')
    }
    for (const n of read.notes) summary.note(n)
    return { summary, exitCode: summary.exitCode(), leadIn }
  } finally {
    ctx.saveLogins()
    await ctx.signOutAll()
    const s = ctx.api.stats
    summary.note(
      `API calls: ${String(s.reads)} reads (${String(s.notFound)} of them "not made yet"), ${String(s.writes)} writes, ${String(s.refusals)} refused, ${String(s.signIns)} sign-ins`,
    )
  }
}
