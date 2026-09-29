import { contract } from '@dos/contracts'
import { ApiRefusal } from './client.js'
import { Ctx, type RunOptions } from './context.js'
import { allRows } from './coverage.js'
import { makeDay, takeShift } from './day.js'
import { finishEarlier } from './finish.js'
import { pages } from './helpers.js'
import { addDays, isDemoId } from './ids.js'
import { TESTER_KEYS } from './people.js'
import { leftOutNote, planCounts } from './plan.js'
import { ensureStanding, switchOffFormer, vanRegNo, type Standing } from './setup.js'
import { KNOWN_GAPS, Summary, type Section } from './summary.js'
import { readWorld } from './world.js'

/**
 * ONE RUN. Sign in as the owner, read the distributor, make sure the standing pieces are there, then the two
 * halves: finish every earlier day the tool left open, and make `date`. When the day before has no van of the
 * tool — the very first run, or a night the server was down — the day before is made and finished first, so
 * "yesterday's trip settled" is there. At the end, what the run left behind is read back through the API.
 */
export interface RunResult {
  summary: Summary
  exitCode: number
  leadIn: string | null
}

async function guard(
  ctx: Ctx,
  section: Section,
  what: string,
  fn: () => Promise<unknown>,
): Promise<void> {
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

/**
 * What must be read and made before a day can be: the distributor as the API sees it, the refusal of a date
 * before one already made, whether the day before needs making, and the standing pieces.
 */
async function prepare(
  ctx: Ctx,
  date: string,
): Promise<{ standing: Standing; leadIn: string | null }> {
  const world = await readWorld(ctx)
  ctx.log(
    `  read: ${String(world.shops.length)} shops, ${String(world.beatIds.length)} beats, ${String(world.items.length)} listed items (${String(world.items.filter((i) => i.ratePaise > 0 && i.available > 0).length)} priced and in stock), ${String(world.suppliers.length)} suppliers`,
  )
  // Rule 3b: the shops the product offers the tool no way to bill without real money reaching its bill are left
  // out, and the report says how many (counts only).
  const leftOut = leftOutNote(world.shops)
  if (leftOut) ctx.summary.note(leftOut)
  // A day after one the tool has already made cannot be made before it: the vans are on later trips.
  const later = await pages(
    (cursor) =>
      ctx.read(contract.delivery.trips.list, {
        from: addDays(date, 1),
        limit: 200,
        ...(cursor ? { cursor } : {}),
      }),
    5,
  )
  // A trip only PLANNED for a later date is the van load the night before planned (`vanToLoad`), not a later day;
  // a cancelled one carried nothing.
  const madeLater = later.find(
    (t) => isDemoId(t.id) && t.state !== 'planned' && t.state !== 'cancelled',
  )
  if (madeLater)
    throw new Error(
      `the tool has already made ${madeLater.tripDate}: run it for that date or a later one`,
    )
  // The day before has no van of the tool (the first run, or a night the server was down): make it and
  // finish it first, so today opens with "yesterday's trip settled". Van 1's trip of the day before only planned
  // (the van load of the night before it) is not a day made, nor is a cancelled trip. Whichever driver the tool had
  // then counts: a day its former tester logins made is a day made (D6).
  const yesterday = addDays(date, -1)
  const van1 = world.vehicles.find((v) => v.regNo === vanRegNo(ctx.tenantId, 1))?.id
  const dayBefore = await pages(
    (cursor) =>
      ctx.read(contract.delivery.trips.list, {
        from: yesterday,
        to: yesterday,
        limit: 200,
        ...(cursor ? { cursor } : {}),
      }),
    5,
  )
  const hadYesterday = dayBefore.some(
    (t) =>
      isDemoId(t.id) && t.state !== 'cancelled' && !(t.state === 'planned' && t.vehicleId === van1),
  )
  const leadIn = hadYesterday ? null : yesterday
  const standing = await ensureStanding(ctx, world, date, leadIn ?? date)
  ctx.log(
    `  standing: ${String(Object.keys(standing.repBeats).length)} rep beat(s), ${String(Object.keys(standing.creditShops).length)} shop(s) over a limit, ${String(standing.slotShops.length)} stand-in shop(s), ${String(Object.keys(standing.vans).length)} van(s)`,
  )
  return { standing, leadIn }
}

export async function runFill(opts: RunOptions): Promise<RunResult> {
  const summary = new Summary()
  summary.dryRun = !opts.commit
  const ctx = new Ctx(opts, summary)
  if (!(await ctx.api.health())) throw new Error(`the API at ${opts.api} does not answer /health`)
  await ctx.signInOwner()
  const date = opts.date
  try {
    ctx.log(
      `distributor ${opts.tenant} (${ctx.tenantId}), business date ${date}, ${opts.commit ? 'COMMIT' : 'dry run: nothing is written'}`,
    )
    if (!opts.commit)
      summary.note(
        'a dry run writes nothing of the business; signing the owner in and out is recorded by the sign-in service as every sign-in is (a session, its sign-in and sign-out events, the device)',
      )
    // The API stopping in the middle of the reads and the standing pieces is an answer too: what was made
    // before it stopped is counted, the summary and the report are still written, and the next run heals.
    let prepared: Awaited<ReturnType<typeof prepare>> | null = null
    try {
      prepared = await prepare(ctx, date)
    } catch (e) {
      if (!(e instanceof ApiRefusal)) throw e
      summary.refusedOne('masters', 'read the distributor and the standing pieces', e.label)
      ctx.log(`  run stopped before the day: ${e.label}; the next run takes it from here`)
    }
    const leadIn = prepared?.leadIn ?? null
    if (prepared) {
      const { standing } = prepared
      if (leadIn) {
        ctx.log(
          `the tool has no van on ${leadIn}: making that day first, so ${date} opens with a day behind it`,
        )
        await guard(ctx, 'yesterday', 'finish', () => finishEarlier(ctx, leadIn))
        await guard(ctx, 'yesterday', `make ${leadIn}`, () => makeDay(ctx, leadIn, standing))
      }
      // Whose shift of the date this run makes (D6), known before the finishing half keys anything of the date.
      await guard(ctx, 'masters', 'shift of the date', () => takeShift(ctx, date))
      ctx.log(`finishing what earlier days left open`)
      await guard(ctx, 'yesterday', 'finish', () => finishEarlier(ctx, date))
      ctx.log(`making ${date}`)
      let counts: Record<string, number> = {}
      await guard(ctx, 'driver', `make ${date}`, async () => {
        counts = planCounts(await makeDay(ctx, date, standing))
      })
      if (!opts.commit) summary.note(`the day's plan: ${JSON.stringify(counts)}`)
      // Every tester login signs in with the demo password: a login whose password someone changed is healed
      // here (the owner sets a temporary one, the tester sets the demo password again), so the logins file is a
      // complete, working list after a run.
      if (opts.commit)
        await guard(ctx, 'people', 'logins', async () => {
          for (const key of TESTER_KEYS) await ctx.as(key)
        })
      // D6: the logins the tool used for testers before are switched off, now that their open work is finished
      // or carried by today's testers.
      await guard(ctx, 'people', 'former logins', () => switchOffFormer(ctx, date))
    }

    const read = await allRows(
      ctx.api,
      { owner: ctx.owner, userIds: Object.fromEntries(ctx.userIds) },
      date,
    ).catch((e: unknown) => {
      summary.note(
        `could not read the result back: ${e instanceof ApiRefusal ? e.label : String(e)}`,
      )
      return { seen: [], notes: [] }
    })
    for (const s of read.seen) {
      const gap = KNOWN_GAPS[`${s.row}:${s.feature}`]
      summary.feature(
        s.row,
        s.feature,
        s.ok ? 'there' : gap ? 'gap' : opts.commit ? 'missing' : 'would',
      )
    }
    for (const n of read.notes) summary.note(n)
    return { summary, exitCode: summary.exitCode(), leadIn }
  } finally {
    ctx.saveLogins()
    await ctx.signOutAll()
    if (ctx.referencesTaken > 0)
      summary.note(
        `${String(ctx.referencesTaken)} payment reference(s) the product named as already taken: each receipt was recorded with the tool's next reference (DOS-310)`,
      )
    const s = ctx.api.stats
    summary.note(
      `API calls: ${String(s.reads)} reads (${String(s.notFound)} of them "not made yet"), ${String(s.writes)} writes, ${String(s.refusals)} refused, ${String(s.signIns)} sign-ins`,
    )
  }
}
