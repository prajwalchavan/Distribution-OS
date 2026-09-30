import { authContract, contract } from '@dos/contracts'
import { ApiRefusal, type Session } from './client.js'
import type { Ctx } from './context.js'
import { demoKey, stableUuid } from './ids.js'
import {
  DEMO_PASSWORD,
  SHOPKEEPERS,
  shopKeyOf,
  shopPersonId,
  shopUsernameCandidates,
  testerPhone,
  type Shopkeeper,
} from './people.js'
import type { World } from './world.js'

/**
 * THE SHOPKEEPER LOGINS `shop1…3`, made the way a shopkeeper makes one (founder, 2026-09-29, docs/22 §8 "The
 * shopkeeper is independent"; brief rule 4):
 *
 *  1. the account SIGNS UP BY ITSELF (`auth.signUp`) with an invented person's name, a mobile number from the
 *     tester block and the demo password — it belongs to no distributor;
 *  2. it ASKS to be joined to its stand-in shop by the SHOP CODE printed on that shop's bills (`auth.joins.ask`),
 *     the code read by the owner from the shop's page;
 *  3. the tool's MANAGER approves the request from the desk (`retailers.joins.approve`);
 *  4. the account's next refresh lands on that shop, and it signs in with the demo password from then on.
 *
 * Each step is the API the apps call. A repeat run finds the account (its user id carries the tool's mark, like a
 * tester's) already reaching its shop and writes nothing. A plain username or number that is somebody else's is
 * never taken: the sign-up's one sentence does not say which, so the tool takes the next plain name (`shop4` for
 * `shop1`), whose number is drawn afresh. Rule 5 stands: nothing the tool prints names a shop, a number or a
 * password — the steps are counted, and the notes carry usernames only.
 */
export async function ensureShopkeepers(
  ctx: Ctx,
  world: World,
  date: string,
  slotShops: readonly string[],
): Promise<void> {
  const phones = new Set([...world.staffPhones, ...world.shopPhones])
  for (const [i, keeper] of SHOPKEEPERS.entries()) {
    const shopId = slotShops[i]
    if (!shopId) {
      ctx.summary.note(`${keeper.key}: no shop stands in for it today, so it is not joined to one`)
      continue
    }
    if (!ctx.commit) {
      ctx.summary.wouldOne('people', 'shopkeeper joined')
      continue
    }
    const s = await shopkeeperSession(ctx, keeper, date, phones)
    if (!s) continue
    if (await reaches(ctx, s, shopId)) {
      ctx.summary.foundOne('people', 'shopkeeper joined')
      continue
    }
    await join(ctx, keeper, s, shopId, date)
  }
}

/**
 * The shopkeeper's session: the tool's own account signed in with the demo password, else a new one signed up.
 * Null when no candidate username could be signed up (each refusal counted).
 */
async function shopkeeperSession(
  ctx: Ctx,
  keeper: Shopkeeper,
  date: string,
  phones: Set<string>,
): Promise<Session | null> {
  const have = ctx.shopSessions.get(keeper.key)
  if (have) return have
  for (const username of shopUsernameCandidates(keeper.key, ctx.suffix)) {
    try {
      const s = await ctx.api.signIn(username, DEMO_PASSWORD, ctx.opts.tenant, { account: true })
      if (shopKeyOf(ctx.tenantId, s.userId, ctx.suffix) === keeper.key && !s.mustChangePassword) {
        ctx.shopSessions.set(keeper.key, s)
        ctx.summary.foundOne('people', 'shopkeeper login')
        return s
      }
      // Somebody else's login that answers to the demo password: never the tool's to use.
      await ctx.api.signOut(s)
      continue
    } catch (e) {
      if (!(e instanceof ApiRefusal)) throw e
      // 401: no such login, or somebody else's password. A sign-up tells nothing more than "in use".
    }
    const phone = testerPhone(ctx.tenantId, username, phones)
    try {
      const s = await ctx.api.signUp(
        {
          id: shopPersonId(ctx.tenantId, date, keeper.key, ctx.suffix),
          phone,
          username,
          password: DEMO_PASSWORD,
          name: keeper.name,
          shopName: keeper.shopName,
        },
        ctx.opts.tenant,
      )
      phones.add(phone)
      ctx.shopSessions.set(keeper.key, s)
      ctx.summary.madeOne('people', 'shopkeeper signed up')
      return s
    } catch (e) {
      if (e instanceof ApiRefusal && e.status === 409) {
        ctx.summary.note(
          `the plain username ${username} (or the number drawn for it) is somebody else's: the next free one is tried`,
        )
        continue
      }
      ctx.summary.refusedOne(
        'people',
        'shopkeeper signed up',
        e instanceof ApiRefusal ? e.label : 'error',
      )
      return null
    }
  }
  ctx.summary.refusedOne('people', 'shopkeeper signed up', 'no free username')
  return null
}

/**
 * Does this account reach the shop at this distributor now? An account with no distributor is refreshed first (a
 * distributor may have approved since); one open on another distributor is switched to this one.
 */
async function reaches(ctx: Ctx, s: Session, shopId: string): Promise<boolean> {
  if (s.account === true && (!(await ctx.api.renew(s)) || s.account === true)) return false
  if (s.tenantId !== ctx.tenantId && !(await ctx.api.switchTo(s, ctx.tenantId))) return false
  try {
    const shops = await ctx.api.call(s, contract.retailers.list, { limit: 100, activeOnly: false })
    return shops.items.some((shop) => shop.id === shopId)
  } catch (e) {
    if (e instanceof ApiRefusal) return false
    throw e
  }
}

/** Ask by the shop's code, have the tool's manager approve, and open the account on the shop. */
async function join(
  ctx: Ctx,
  keeper: Shopkeeper,
  s: Session,
  shopId: string,
  date: string,
): Promise<void> {
  const page = await ctx.read(contract.retailers.get, { id: shopId })
  const code = 'shopCode' in page.item ? page.item.shopCode : undefined
  if (!code) {
    ctx.summary.refusedOne('people', 'join asked', 'no shop code')
    return
  }
  const parts = [keeper.key, shopId, ...(ctx.suffix ? [ctx.suffix] : [])]
  const asked = await ctx.writeAuth('people', 'join asked', s, authContract.joins.ask, {
    idempotencyKey: demoKey(date, 'join', ...parts),
    // Not the tool's mark: a request is the shopkeeper's, and one per shop per day at most.
    id: stableUuid(`demo-fill:join:${ctx.tenantId}:${date}:${parts.join(':')}`),
    by: 'code',
    code,
  })
  if (!asked) return
  if (asked.item.state !== 'approved') {
    const approved = await ctx.write(
      'people',
      'join approved',
      () => ctx.as('manager'),
      contract.retailers.joins.approve,
      {
        idempotencyKey: demoKey(date, 'join', ...parts, 'approve'),
        id: asked.item.id,
        membershipId: stableUuid(`demo-fill:membership:${asked.item.id}`),
      },
    )
    if (!approved) return
  }
  if (!(await reaches(ctx, s, shopId)))
    ctx.summary.refusedOne('people', 'shopkeeper joined', 'shop not reached after approval')
  else ctx.summary.madeOne('people', 'shopkeeper joined')
}
