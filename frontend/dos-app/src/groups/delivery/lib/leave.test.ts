/**
 * DOS-167 — what the delivery app says when a driver signs out, or switches distributor, with
 * deliveries, receipts or returns that have not reached the office.
 *
 * The founder's rule (2026-09-13, answer A): the changes stay on this phone for that person only and go
 * the next time that person signs in here; "Send now" while there is a signal; throwing a change away
 * is never offered at sign-out. The sheet names the count and the person, and for a switch the
 * distributor the changes wait for. Every word is in `src/strings.ts`.
 *
 * Pure rules plus a read of the sheet's source: importing a component in Node pulls in `react-native`,
 * which does not resolve outside Metro. `@types/node` is deliberately absent from an app, so the two
 * Node functions are imported through non-literal specifiers.
 */
import { describe, expect, it } from 'vitest'

import { strings } from '../strings'
import {
  leaveButtons,
  leaveNow,
  leaveSentence,
  sendNowThenLeave,
  tapLeave,
  type LeaveSteps,
  type WaitingCounts,
} from './leave'

interface NodeFs {
  readFileSync: (path: string, encoding: 'utf8') => string
}

interface NodeUrl {
  fileURLToPath: (url: URL) => string
}

const NODE_FS: string = 'node:fs'
const NODE_URL: string = 'node:url'

/** A file next to this spec. `fileURLToPath`, never `URL.pathname`: the path has a space. */
async function readBeside(name: string): Promise<string> {
  const { readFileSync } = (await import(NODE_FS)) as NodeFs
  const { fileURLToPath } = (await import(NODE_URL)) as NodeUrl
  return readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8')
}

const catalogue: Readonly<Record<string, string>> = strings

const LEAVE_KEYS = [
  'leave.title',
  'leave.bodySignOut',
  'leave.bodySwitch',
  'leave.attention',
  'leave.sendNow',
  'leave.signOutKeep',
  'leave.switchAnyway',
  'leave.noSignal',
] as const

const GANESH = 'Ganesh More'
const TARSUN = 'Tarsun Enterprises, Kalyan'

describe('DOS-167 the delivery leave sheet', () => {
  it('DOS-167 leaveSentence names the count, the person and the rule for sign-out and for a switch', async () => {
    // Three doorstep deliveries saved in a dead spot.
    const queued = leaveSentence({
      mode: 'signOut',
      pending: 3,
      rejected: 0,
      name: GANESH,
      tenantName: TARSUN,
      persistent: true,
    })
    expect(queued.title).toBe('3 changes have not reached the office')
    expect(queued.attention).toBeNull()
    expect(queued.body).toBe(
      'They stay on this phone for Ganesh More only and go the next time Ganesh More signs in here. Nobody else can see them.',
    )

    // Two receipts the office refused, nothing queued.
    const refused = leaveSentence({
      mode: 'signOut',
      pending: 0,
      rejected: 2,
      name: GANESH,
      tenantName: TARSUN,
      persistent: true,
    })
    expect(refused.title).toContain('2 need attention')
    expect(refused.attention).toBeNull()
    expect(refused.body).toContain(GANESH)

    // Both: the queued count is the title, the refused count the line under it.
    const both = leaveSentence({
      mode: 'signOut',
      pending: 1,
      rejected: 2,
      name: GANESH,
      tenantName: TARSUN,
      persistent: true,
    })
    expect(both.title).toBe('1 change has not reached the office')
    expect(both.attention).toBe('2 need attention')

    // A switch names the distributor the changes wait for, not the person.
    const switching = leaveSentence({
      mode: 'switch',
      pending: 4,
      rejected: 0,
      name: GANESH,
      tenantName: TARSUN,
      persistent: true,
    })
    expect(switching.title).toBe('4 changes have not reached the office')
    expect(switching.body).toBe(
      'They go when you come back to Tarsun Enterprises, Kalyan on this phone.',
    )
    expect(switching.body).not.toContain(GANESH)

    // Every word comes from this app's catalogue.
    for (const key of LEAVE_KEYS) expect(catalogue[key], key).toBeTypeOf('string')
    expect(queued.title).toBe(catalogue['leave.title']?.replace('{n}', '3'))
    expect(switching.body).toBe(catalogue['leave.bodySwitch']?.replace('{tenantName}', TARSUN))

    // And the sheet itself holds no sentence of its own: no quoted text with a space, no text between
    // tags, and every key it asks for exists (the one kit key is the kit's own Cancel).
    const sheet = (await readBeside('./leave-sheet.tsx'))
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    const quoted = [...sheet.matchAll(/'([^'\n]*)'|"([^"\n]*)"|`([^`]*)`/g)].map(
      (match) => match[1] ?? match[2] ?? match[3] ?? '',
    )
    expect(quoted.filter((text) => /\s/.test(text))).toEqual([])
    const between = [...sheet.matchAll(/>\s*([^<>{}\s][^<>{}]*)</g)]
      .map((match) => (match[1] ?? '').trim())
      .filter((text) => /[A-Za-z]/.test(text))
    expect(between).toEqual([])
    const asked = [...sheet.matchAll(/t\('([^']+)'/g)].map((match) => match[1] ?? '')
    expect(asked.length).toBeGreaterThan(0)
    for (const key of asked)
      if (key !== 'action.cancel') expect(catalogue[key], key).toBeTypeOf('string')
  })

  it("DOS-167 the sheet counts one change in the singular, tells the truth about refusals, and keeps every button under the kit's 20 characters", () => {
    // One doorstep delivery saved in a dead spot.
    const one = leaveSentence({
      mode: 'signOut',
      pending: 1,
      rejected: 0,
      name: GANESH,
      tenantName: TARSUN,
      persistent: true,
    })
    // One receipt the office refused and nothing queued: it waits in Needs attention, it does not go.
    const refusedOnly = leaveSentence({
      mode: 'signOut',
      pending: 0,
      rejected: 1,
      name: GANESH,
      tenantName: TARSUN,
      persistent: true,
    })
    const refusedSwitch = leaveSentence({
      mode: 'switch',
      pending: 0,
      rejected: 2,
      name: GANESH,
      tenantName: TARSUN,
      persistent: true,
    })
    // Two queued and one refused: the sheet tells the two apart.
    const both = leaveSentence({
      mode: 'signOut',
      pending: 2,
      rejected: 1,
      name: GANESH,
      tenantName: TARSUN,
      persistent: true,
    })
    const NEW_KEYS = [
      'leave.title.one',
      'leave.attention.one',
      'leave.bodySignOutRefused',
      'leave.bodySignOutBoth',
      'leave.bodySwitchRefused',
      'leave.bodySwitchBoth',
    ]
    const BUTTON_KEYS = ['leave.sendNow', 'leave.signOutKeep', 'leave.switchAnyway']

    expect({
      oneTitle: one.title,
      refusedOnlyTitle: refusedOnly.title,
      refusedOnlyAttention: refusedOnly.attention,
      refusedOnlySaysTheyWait: refusedOnly.body.includes('do not go by themselves'),
      refusedOnlyPromisesTheyGo: refusedOnly.body.includes('go the next time'),
      refusedSwitchSaysTheyWait: refusedSwitch.body.includes('do not go by themselves'),
      bothAttention: both.attention,
      bothNamesTheQueued: both.body.includes('queued ones'),
      bothNamesTheRefused: both.body.includes('needing attention'),
      missingKeys: NEW_KEYS.filter((key) => typeof catalogue[key] !== 'string'),
      // types.ts: a button label is at most 20 characters.
      longButtons: BUTTON_KEYS.filter((key) => (catalogue[key] ?? '').length > 20),
    }).toEqual({
      oneTitle: '1 change has not reached the office',
      refusedOnlyTitle: '1 needs attention',
      refusedOnlyAttention: null,
      refusedOnlySaysTheyWait: true,
      refusedOnlyPromisesTheyGo: false,
      refusedSwitchSaysTheyWait: true,
      bothAttention: '1 needs attention',
      bothNamesTheQueued: true,
      bothNamesTheRefused: true,
      missingKeys: [],
      longButtons: [],
    })
  })

  /*
   * Ruling 2 (u), merge review minor 2. `end()` keeps the file by itself when its re-count finds something waiting — a
   * delivery in hand at the tap. The other distributorships are swept on every sign-out, a kept one included: the
   * sweep deletes only files with nothing unsent. (This app keeps no drafts.)
   */
  it('DOS-167 a file kept by the re-count keeps the drafts, and the sweep runs on every sign-out', async () => {
    function recorded(kept: boolean): { calls: string[]; steps: LeaveSteps } {
      const calls: string[] = []
      const steps: LeaveSteps = {
        waiting: async () => ({ pending: 0, rejected: 0 }),
        sendNow: async () => ({ pending: 0, rejected: 0 }),
        end: async ({ keepQueue }) => {
          calls.push(`end keepQueue=${String(keepQueue)}`)
          return { kept }
        },
        sweep: async () => {
          calls.push('sweep')
        },
        // The client's side (`useSession().signOutOnDevice`): the leaving runs inside, and the revoke follows it.
        signOutOnDevice: async (leave) => {
          calls.push('signOutOnDevice')
          await leave(Promise.resolve())
          calls.push('revoke')
        },
        switchDistributor: async (tenantId) => {
          calls.push(`switch ${tenantId}`)
        },
      }
      return { calls, steps }
    }
    // One tap with nothing counted, and a delivery in hand landed: the engine kept the file.
    const recount = recorded(true)
    await leaveNow({ mode: 'signOut' }, false, recount.steps)
    // "Sign out, keep here".
    const keep = recorded(true)
    await leaveNow({ mode: 'signOut' }, true, keep.steps)
    // Nothing waited and the file went.
    const gone = recorded(false)
    await leaveNow({ mode: 'signOut' }, false, gone.steps)

    expect({ recount: recount.calls, keep: keep.calls, gone: gone.calls }).toEqual({
      recount: ['signOutOnDevice', 'end keepQueue=false', 'sweep', 'revoke'],
      keep: ['signOutOnDevice', 'end keepQueue=true', 'sweep', 'revoke'],
      gone: ['signOutOnDevice', 'end keepQueue=false', 'sweep', 'revoke'],
    })
  })

  /*
   * Addendum (y). "Sign out, keep here" crashed natively inside `end()` (Android delivery 2 of 2, iOS 2 of 2), and on
   * iOS the relaunch came back signed in as the person who had chosen to sign out. The session is cleared on this
   * phone before `end()` touches the store, and the server's revoke goes last, with the token it kept.
   */
  it('DOS-167 the keep sign-out clears the stored session before the store is touched', async () => {
    function phoneOf(end: LeaveSteps['end']): {
      calls: string[]
      signedIn: () => boolean
      steps: LeaveSteps
    } {
      const calls: string[] = []
      let signedIn = true
      // The session's removal from the platform store, which the engine waits for before it touches the file.
      const stored = Promise.resolve()
      const steps: LeaveSteps = {
        waiting: async () => ({ pending: 1, rejected: 0 }),
        sendNow: async () => ({ pending: 1, rejected: 0 }),
        end: async (options) => {
          const after =
            options.after === stored ? 'stored' : options.after === undefined ? 'none' : 'another'
          calls.push(
            `end keepQueue=${String(options.keepQueue)} signedIn=${String(signedIn)} after=${after}`,
          )
          return end(options)
        },
        sweep: async () => {
          calls.push('sweep')
        },
        signOutOnDevice: async (leave) => {
          signedIn = false
          calls.push('signOutOnDevice')
          await leave(stored)
          calls.push('revoke')
        },
        switchDistributor: async (tenantId) => {
          calls.push(`switch ${tenantId}`)
        },
      }
      return { calls, signedIn: () => signedIn, steps }
    }

    // "Sign out, keep here".
    const keep = phoneOf(async () => ({ kept: true }))
    const [left] = await Promise.allSettled([leaveNow({ mode: 'signOut' }, true, keep.steps)])
    // The same, and the app dies inside end(): it never returns.
    const crash = phoneOf(() => new Promise<{ kept: boolean }>(() => {}))
    void leaveNow({ mode: 'signOut' }, true, crash.steps)
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect({
      keep: { left: left?.status, calls: keep.calls },
      crash: { signedIn: crash.signedIn(), calls: crash.calls },
    }).toEqual({
      keep: {
        left: 'fulfilled',
        calls: [
          'signOutOnDevice',
          'end keepQueue=true signedIn=false after=stored',
          'sweep',
          'revoke',
        ],
      },
      crash: {
        signedIn: false,
        calls: ['signOutOnDevice', 'end keepQueue=true signedIn=false after=stored'],
      },
    })
  })

  /*
   * Ruling 2 (t). A browser that cannot keep the device store (not cross-origin isolated, no OPFS, an open that
   * failed) holds the queue in memory, and it goes with the tab: "keep here" would be a promise nothing keeps.
   */
  it('DOS-167 a browser that cannot keep offers no keep: Send now or wait', () => {
    const memorySignOut = leaveSentence({
      mode: 'signOut',
      pending: 2,
      rejected: 1,
      name: GANESH,
      tenantName: TARSUN,
      persistent: false,
    })
    const memorySwitch = leaveSentence({
      mode: 'switch',
      pending: 2,
      rejected: 0,
      name: GANESH,
      tenantName: TARSUN,
      persistent: false,
    })
    expect({
      buttons: {
        persistentOnline: leaveButtons({ mode: 'signOut', online: true, persistent: true }),
        persistentOffline: leaveButtons({ mode: 'signOut', online: false, persistent: true }),
        memoryOnline: leaveButtons({ mode: 'signOut', online: true, persistent: false }),
        memoryOffline: leaveButtons({ mode: 'signOut', online: false, persistent: false }),
        switchMemoryOnline: leaveButtons({ mode: 'switch', online: true, persistent: false }),
        switchMemoryOffline: leaveButtons({ mode: 'switch', online: false, persistent: false }),
      },
      bodies: [memorySignOut.body, memorySwitch.body],
      promisesToKeep: [memorySignOut.body, memorySwitch.body].filter((body) =>
        body.includes('stay on this phone'),
      ),
      // The count and the refusals read the same on any store.
      title: memorySignOut.title,
      attention: memorySignOut.attention,
    }).toEqual({
      buttons: {
        persistentOnline: ['sendNow', 'keep', 'cancel'],
        persistentOffline: ['keep', 'cancel'],
        memoryOnline: ['sendNow', 'cancel'],
        memoryOffline: ['cancel'],
        switchMemoryOnline: ['sendNow', 'cancel'],
        switchMemoryOffline: ['cancel'],
      },
      bodies: [catalogue['leave.bodyMemory'], catalogue['leave.bodyMemory']],
      promisesToKeep: [],
      title: '2 changes have not reached the office',
      attention: '1 needs attention',
    })
    expect(catalogue['leave.bodyMemory']).toBe(
      'This browser cannot keep them once you leave. Send them now while there is a signal — without one, stay signed in until there is. Anything refused can be fixed or discarded in Needs attention.',
    )
  })

  it('DOS-167 leaving decides on what waits in the file once it is open, clears the session on the phone before it ends the engine and never deletes what it did not count', async () => {
    const NOTHING: WaitingCounts = { pending: 0, rejected: 0 }

    /** The device and the session, writing down in order what the leave flow asked of them. */
    function phone(options: {
      waiting?: WaitingCounts | Error
      /** How long the file takes to open before it can be counted. */
      openMs?: number
      afterSend?: WaitingCounts | Error
      endFails?: boolean
    }): { calls: string[]; steps: LeaveSteps } {
      const calls: string[] = []
      const steps: LeaveSteps = {
        waiting: async () => {
          calls.push('waiting')
          await new Promise((resolve) => setTimeout(resolve, options.openMs ?? 0))
          const counts = options.waiting ?? NOTHING
          if (counts instanceof Error) throw counts
          calls.push(`counted ${String(counts.pending)}+${String(counts.rejected)}`)
          return counts
        },
        sendNow: async () => {
          calls.push('sendNow')
          const counts = options.afterSend ?? NOTHING
          if (counts instanceof Error) throw counts
          return counts
        },
        end: async ({ keepQueue }) => {
          calls.push(`end keepQueue=${String(keepQueue)}`)
          if (options.endFails === true) throw new Error('Access to closed resource')
        },
        sweep: async () => {
          calls.push('sweep')
        },
        // The client's side (`useSession().signOutOnDevice`): the leaving runs inside, and the revoke follows it.
        signOutOnDevice: async (leave) => {
          calls.push('signOutOnDevice')
          await leave(Promise.resolve())
          calls.push('revoke')
        },
        switchDistributor: async (tenantId) => {
          calls.push(`switch ${tenantId}`)
        },
      }
      return { calls, steps }
    }

    // The driver kept a doorstep delivery on this phone, signed in again and tapped Sign out while the
    // file was still opening. The count is waited for, and the sheet asks: nothing is ended and nobody
    // is signed out.
    const coldStart = phone({ waiting: { pending: 1, rejected: 0 }, openMs: 40 })
    await expect(tapLeave({ mode: 'signOut' }, coldStart.steps)).resolves.toBe('ask')
    expect(coldStart.calls).toEqual(['waiting', 'counted 1+0'])

    // A refusal waiting in the tray asks too, for a sign-out and for a switch.
    const refused = phone({ waiting: { pending: 0, rejected: 2 } })
    await expect(tapLeave({ mode: 'switch', tenantId: 'sai' }, refused.steps)).resolves.toBe('ask')
    expect(refused.calls).toEqual(['waiting', 'counted 0+2'])

    // Nothing waits: one tap. The session is cleared on this phone FIRST (addendum (y)), then the engine ends
    // (file deleted), the driver's other files are swept, and the revoke goes last.
    const clean = phone({})
    await expect(tapLeave({ mode: 'signOut' }, clean.steps)).resolves.toBe('left')
    expect(clean.calls).toEqual([
      'waiting',
      'counted 0+0',
      'signOutOnDevice',
      'end keepQueue=false',
      'sweep',
      'revoke',
    ])

    // The file could not be counted: it is never deleted, and the driver is still signed out.
    const unreadable = phone({ waiting: new Error('database disk image is malformed') })
    await expect(tapLeave({ mode: 'signOut' }, unreadable.steps)).resolves.toBe('left')
    expect(unreadable.calls).toEqual([
      'waiting',
      'signOutOnDevice',
      'end keepQueue=true',
      'sweep',
      'revoke',
    ])

    // Ending the engine threw: already signed out on this phone, and the rest of the leaving still runs.
    const endFails = phone({ endFails: true })
    await expect(tapLeave({ mode: 'signOut' }, endFails.steps)).resolves.toBe('left')
    expect(endFails.calls).toEqual([
      'waiting',
      'counted 0+0',
      'signOutOnDevice',
      'end keepQueue=false',
      'sweep',
      'revoke',
    ])

    // A switch with nothing waiting wipes nothing.
    const switching = phone({})
    await expect(tapLeave({ mode: 'switch', tenantId: 'sai' }, switching.steps)).resolves.toBe(
      'left',
    )
    expect(switching.calls).toEqual(['waiting', 'counted 0+0', 'switch sai'])

    // The sheet's Send now: everything went, so the leaving carries on by itself...
    const sent = phone({ afterSend: NOTHING })
    await expect(sendNowThenLeave({ mode: 'signOut' }, sent.steps)).resolves.toBe('left')
    expect(sent.calls).toEqual([
      'sendNow',
      'signOutOnDevice',
      'end keepQueue=false',
      'sweep',
      'revoke',
    ])
    // ...something is still waiting, or the send itself failed: the sheet stays.
    const stillWaiting = phone({ afterSend: { pending: 1, rejected: 0 } })
    await expect(sendNowThenLeave({ mode: 'signOut' }, stillWaiting.steps)).resolves.toBe('ask')
    expect(stillWaiting.calls).toEqual(['sendNow'])
    const sendFailed = phone({ afterSend: new Error('Network request failed') })
    await expect(sendNowThenLeave({ mode: 'signOut' }, sendFailed.steps)).resolves.toBe('ask')
    expect(sendFailed.calls).toEqual(['sendNow'])

    // "Sign out, keep here" keeps the queue and sweeps the other distributorships as every sign-out does
    // (ruling 2 (u)); "Switch anyway" only switches.
    const keep = phone({})
    await leaveNow({ mode: 'signOut' }, true, keep.steps)
    expect(keep.calls).toEqual(['signOutOnDevice', 'end keepQueue=true', 'sweep', 'revoke'])
    const anyway = phone({})
    await leaveNow({ mode: 'switch', tenantId: 'sai' }, true, anyway.steps)
    expect(anyway.calls).toEqual(['switch sai'])
  })

  /*
   * Addendum (z1). "Sign out" on the Settings screen called `useSession().signOut()` itself: no sheet, no `end()`, the
   * read set left on the phone, the other distributorships never swept, the session cleared only once the server's
   * revoke had answered — and on a browser that keeps nothing, the queue thrown away. Every sign-out button takes the
   * leave flow of `app/_layout.tsx`, through `useLeave()`. The layout's one other sign-out is the wrong-role screen's,
   * where no device store is ever opened.
   */
  it('DOS-167 every sign-out button in the app goes through the leave flow', async () => {
    const { readdirSync, readFileSync } = (await import(NODE_FS)) as NodeFs & {
      readdirSync: (path: string, options: { recursive: true; encoding: 'utf8' }) => string[]
    }
    const { fileURLToPath } = (await import(NODE_URL)) as NodeUrl
    const app = fileURLToPath(new URL('../../../../app/delivery', import.meta.url))
    const read = (file: string): string =>
      readFileSync(`${app}/${file}`, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
    const calls = (source: string): number => (source.match(/\bsignOut\s*\(/g) ?? []).length
    const screens = readdirSync(app, { recursive: true, encoding: 'utf8' })
      .filter((file) => file.endsWith('.tsx'))
      .sort()
    const outside = screens.filter((file) => file !== '_layout.tsx')

    // The session's own sign-out, called — `signOut()`, `useSession().signOut()` — or taken to be called later.
    const bypass = outside.filter((file) => {
      const source = read(file)
      return calls(source) > 0 || /[{,]\s*signOut\s*[,}]/.test(source)
    })
    // A button labelled "Sign out" that is not handed the layout's leave flow.
    const withoutTheFlow = outside.filter((file) => {
      const source = read(file)
      return source.includes("t('app.signOut')") && !/\buseLeave\(\)/.test(source)
    })
    // Inside the layout, a sign-out that is not the leave flow only on the wrong-role screen.
    const layout = read('_layout.tsx')
    const wrongRole = /<WrongRole[\s\S]*?\/>/.exec(layout)?.[0] ?? ''

    expect({
      read: outside.length > 0 && screens.includes('_layout.tsx'),
      bypass,
      withoutTheFlow,
      layoutBesideTheWrongRoleScreen: calls(layout) - calls(wrongRole),
    }).toEqual({ read: true, bypass: [], withoutTheFlow: [], layoutBesideTheWrongRoleScreen: 0 })
  })

  /*
   * Ruling 3 (ee), S-140. `persistent` is a TRI-STATE now: null while the device store has not resolved. Null takes
   * the same branch as false everywhere here — otherwise it took the worst half of each: the body promising "they
   * stay on this phone" with no keep button under it, the one combination that promises what the sheet then refuses.
   */
  it('DOS-167 an unresolved store is treated as one that cannot keep', () => {
    const unresolved = leaveSentence({
      mode: 'signOut',
      pending: 1,
      rejected: 0,
      name: GANESH,
      tenantName: TARSUN,
      persistent: null,
    })
    const switching = leaveSentence({
      mode: 'switch',
      pending: 1,
      rejected: 0,
      name: GANESH,
      tenantName: TARSUN,
      persistent: null,
    })

    expect({
      bodies: [unresolved.body, switching.body],
      promisesToKeep: [unresolved.body, switching.body].filter((body) =>
        body.includes('stay on this phone'),
      ),
      online: leaveButtons({ mode: 'signOut', online: true, persistent: null }),
      offline: leaveButtons({ mode: 'signOut', online: false, persistent: null }),
      switchOnline: leaveButtons({ mode: 'switch', online: true, persistent: null }),
    }).toEqual({
      bodies: [catalogue['leave.bodyMemory'], catalogue['leave.bodyMemory']],
      promisesToKeep: [],
      online: ['sendNow', 'cancel'],
      offline: ['cancel'],
      switchOnline: ['sendNow', 'cancel'],
    })
  })
})
