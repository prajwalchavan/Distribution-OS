/**
 * DOS-400 — "App sign-in" on the shop's page, shared by the owner and the manager (architect's ruling
 * of 2026-09-29, docs/22 §8). It lives at install level, beside `src/pricing/editors.tsx`, because a
 * group may import `src/` and never another group (docs/31 §6.4).
 *
 * With no sign-in: "This shop cannot use the app yet" and "Give this shop a sign-in", which asks for the
 * shopkeeper's mobile first when the shop has none — or, when the shop's own already has a sign-in made
 * at another business (ruling R1), for another mobile of the shopkeeper, which becomes the shop's (QA
 * DOS-428) — then shows the username and the first password ONCE, large, with Copy and Share. With one: the username, since when, and two quiet actions — a new first
 * password, and stopping the sign-in — each of which says what will happen and asks once before it acts.
 *
 * `retailers.signIn.*` is the owner's and the manager's alone (PERMISSIONS): for the accountant the row
 * still says whether the shop signs in, and offers nothing. The field never receives `appSignIn`, so
 * for it this renders nothing at all.
 *
 * THE FIRST PASSWORD is made by THIS device (`./sign-in-forms.ts`) when a dialog opens, sent once, and
 * kept only in this component's state until the desk closes the dialog that shows it. The server keeps
 * a hash and answers without it, so a reload, a retry or another device can never show it again.
 *
 * Screens import only `@dos/ui` for rendering, and so does this file.
 */
import type { Retailer } from '@dos/contracts'
import { useApi, useMutation, useRefusal } from '@dos/api-client/react'
import { Button, Dialog, Row, Stack, TextInput, Txt, useColors, useStrings } from '@dos/ui'
import { clipboard, share } from '@dos/ui/platform'
import { useState, type ReactNode } from 'react'

import { useMayWrite } from '../pricing/editors'
import {
  afterSharedNumber,
  firstPassword,
  givePayload,
  handOverSentence,
  hasMobile,
  isSharedNumber,
  newGiveIntent,
  passwordPayload,
  SHOWN_ONCE_BUTTONS,
  stopPayload,
  toldWords,
  toMobile,
  type GiveIntent,
  type ToldWords,
} from './sign-in-forms'

/** What the shown-once dialog says under Copy and Share when nothing could be copied or shared. */
type HandOver = 'copied' | 'copyRefused' | 'shareFailed' | null

/**
 * `askMobile`: the dialog shows the mobile field — the shop has no mobile, or its own was refused
 * because its sign-in was made at another business and the desk enters another one (R1, DOS-428).
 */
type GiveStep = { kind: 'give'; mobile: string; problem: string | null; askMobile: boolean }

type Step =
  | GiveStep
  | { kind: 'shown'; username: string; password: string; handOver: HandOver }
  | { kind: 'told'; username: string | null; words: ToldWords }
  | { kind: 'password'; password: string }
  | { kind: 'stop' }
  | null

export interface ShopSignInRowProps {
  shop: Retailer
  /** The group's own way of printing an instant ("29 Sep, 9:53 am"). */
  when: (iso: string) => string
  /** The screen's toast, for "Sign-in stopped". */
  onToast: (message: string) => void
}

export function ShopSignInRow({ shop, when, onToast }: ShopSignInRowProps): React.JSX.Element {
  const t = useStrings()
  const colors = useColors()
  const api = useApi()
  const may = useMayWrite()
  const [step, setStep] = useState<Step>(null)
  /** One intent per "give" dialog: a retry sends the same ids, the same password, the same key. */
  const [intent, setIntent] = useState<GiveIntent | null>(null)

  const give = useMutation(
    (input: { shopId: string; intent: GiveIntent }, meta) =>
      api.api.retailers.signIn.give(givePayload(input.shopId, input.intent, meta.idempotencyKey)),
    { invalidates: [['retailers']] },
  )
  const newPassword = useMutation(
    (input: { shopId: string; password: string }, meta) =>
      api.api.retailers.signIn.setPassword(
        passwordPayload(input.shopId, input.password, meta.idempotencyKey),
      ),
    { invalidates: [['retailers']] },
  )
  const stop = useMutation(
    (shopId: string, meta) =>
      api.api.retailers.signIn.stop(stopPayload(shopId, meta.idempotencyKey)),
    { invalidates: [['retailers']] },
  )
  const refusal = useRefusal(
    [give, newPassword, stop],
    step === null ? null : `${shop.id}:${step.kind}`,
  )
  const refusalText =
    refusal === undefined
      ? null
      : refusal.kind === 'network'
        ? t('app.writeNoConnection')
        : refusal.message

  const signIn = shop.appSignIn
  if (signIn === undefined) return <></>
  const mayGive = may('retailers.signIn.give')
  const mayReset = may('retailers.signIn.setPassword')
  const mayStop = may('retailers.signIn.stop')
  const needsMobile = !hasMobile(shop.phone)
  const username = signIn?.username ?? null

  const close = (): void => {
    setStep(null)
  }

  const confirmGive = (asked: GiveStep): void => {
    const typed = asked.mobile
    let phone: string | null = null
    if (asked.askMobile) {
      phone = toMobile(typed)
      if (phone === null) {
        setStep({ ...asked, problem: t('si.mobileBad') })
        return
      }
    }
    // The same dialog, the same number: the same intent, so a retry replays instead of making another.
    const current = intent !== null && intent.phone === phone ? intent : newGiveIntent(phone)
    setIntent(current)
    void give.mutateAsync({ shopId: shop.id, intent: current }).then(
      (result) => {
        setIntent(null)
        if (result.outcome === 'created' && result.signIn.username !== null) {
          setStep({
            kind: 'shown',
            username: result.signIn.username,
            password: current.password,
            handOver: null,
          })
        } else {
          setStep({
            kind: 'told',
            username: result.signIn.username,
            words: toldWords(result.outcome, result.passwordChosen),
          })
        }
      },
      (error: unknown) => {
        /*
         * A number whose sign-in another business made (ruling R1): say what the desk can do, on the
         * mobile field of this same dialog, so another number of the shopkeeper is entered right here
         * and saved on the shop (DOS-428). Nothing was written. Every other refusal prints in the
         * dialog, which stays open.
         */
        if (!isSharedNumber(error)) return
        setIntent(null)
        const next = afterSharedNumber(current.phone !== null, typed)
        setStep({
          kind: 'give',
          mobile: next.mobile,
          problem: t(next.problem, { phone: shop.phone }),
          askMobile: true,
        })
      },
    )
  }

  const shareText = (shown: { username: string; password: string }): string =>
    t('si.shareText', { shop: shop.name, username: shown.username, password: shown.password })

  return (
    <Stack gap={2} testID="shop-sign-in">
      <Txt field="label" desk="meta" color={colors.text.secondary}>
        {t('si.title')}
      </Txt>
      {signIn === null ? (
        <Stack gap={2}>
          <Txt field="body" desk="body" testID="shop-sign-in-none">
            {t('si.none')}
          </Txt>
          {mayGive ? (
            <Button
              label={t('si.give')}
              variant="secondary"
              onPress={() => {
                setIntent(null)
                setStep({ kind: 'give', mobile: '', problem: null, askMobile: needsMobile })
              }}
              testID="shop-sign-in-give"
            />
          ) : null}
        </Stack>
      ) : (
        <Stack gap={1}>
          <Txt field="bodyStrong" desk="body" testID="shop-sign-in-username">
            {username ?? '—'}
          </Txt>
          <Txt field="label" desk="meta" color={colors.text.secondary}>
            {t('si.since', { when: when(signIn.since) })}
          </Txt>
          {mayReset || mayStop ? (
            <Row gap={2} wrap>
              {mayReset ? (
                <Button
                  label={t('si.newPassword')}
                  variant="ghost"
                  onPress={() => {
                    setStep({ kind: 'password', password: firstPassword() })
                  }}
                  testID="shop-sign-in-new-password"
                />
              ) : null}
              {mayStop ? (
                <Button
                  label={t('si.stop')}
                  variant="ghost"
                  onPress={() => {
                    setStep({ kind: 'stop' })
                  }}
                  testID="shop-sign-in-stop"
                />
              ) : null}
            </Row>
          ) : null}
        </Stack>
      )}

      {/* Give: say what happens, ask for the mobile when the shop has none, then act. */}
      <Dialog
        open={step?.kind === 'give'}
        onClose={close}
        title={t('si.give')}
        body={
          <Stack gap={3}>
            <Txt field="body" desk="body">
              {t('si.giveBody')}
            </Txt>
            {step?.kind === 'give' && step.askMobile ? (
              <Stack gap={1}>
                <TextInput
                  label={t('si.mobile')}
                  value={step.mobile}
                  onChange={(value) => {
                    setStep({ ...step, mobile: value, problem: null })
                  }}
                  keyboard="phone"
                  capitalize="none"
                  error={step.problem ?? undefined}
                  testID="shop-sign-in-mobile"
                />
                <Hint>{needsMobile ? t('si.mobileHelp') : t('si.mobileReplaceHelp')}</Hint>
              </Stack>
            ) : null}
            {/* A number known elsewhere is said on the mobile field instead. */}
            <Problem
              text={refusal !== undefined && isSharedNumber(refusal) ? null : refusalText}
              testID="shop-sign-in-refusal"
            />
          </Stack>
        }
        confirmLabel={t('si.giveConfirm')}
        busy={give.status === 'pending'}
        onConfirm={() => {
          if (step?.kind === 'give') confirmGive(step)
        }}
        testID="shop-sign-in-give-dialog"
      />

      {/* The one time the first password is on a screen. */}
      <Dialog
        open={step?.kind === 'shown'}
        onClose={close}
        title={t('si.shownTitle')}
        body={
          step?.kind === 'shown' ? (
            <Stack gap={3}>
              <Big
                label={t('si.username')}
                value={step.username}
                testID="shop-sign-in-shown-username"
              />
              <Big
                label={t('si.firstPassword')}
                value={step.password}
                testID="shop-sign-in-shown-password"
              />
              <Row gap={2} wrap>
                {clipboard.available ? (
                  <Button
                    label={step.handOver === 'copied' ? t('si.copied') : t('si.copy')}
                    variant="secondary"
                    onPress={() => {
                      void clipboard.copy(shareText(step)).then((copied) => {
                        setStep({ ...step, handOver: copied ? 'copied' : 'copyRefused' })
                      })
                    }}
                    testID="shop-sign-in-copy"
                  />
                ) : null}
                {share.available && share.sheet ? (
                  <Button
                    label={t('si.share')}
                    variant="secondary"
                    onPress={() => {
                      void share
                        .share({ title: t('si.shownTitle'), message: shareText(step) })
                        .then(
                          (shared) => shared,
                          () => false,
                        )
                        .then((shared) => {
                          setStep({ ...step, handOver: shared ? null : 'shareFailed' })
                        })
                    }}
                    testID="shop-sign-in-share"
                  />
                ) : null}
              </Row>
              {/* Copy and Share never fail silently (the second check's minor): say what to do instead. */}
              {step.handOver === 'copyRefused' ? (
                <Problem text={t('si.copyRefused')} testID="shop-sign-in-copy-refused" />
              ) : step.handOver === 'shareFailed' ? (
                <Problem text={t('si.shareFailed')} testID="shop-sign-in-share-failed" />
              ) : null}
              {/* One sentence, for what this device can do (the fourth check's minor). */}
              <Hint>
                {t(handOverSentence(clipboard.available, share.available && share.sheet))}
              </Hint>
              <Txt field="body" desk="body">
                {t('si.mustChange')}
              </Txt>
            </Stack>
          ) : null
        }
        confirmLabel={t(SHOWN_ONCE_BUTTONS.confirm)}
        cancelLabel={SHOWN_ONCE_BUTTONS.cancel}
        onConfirm={close}
        testID="shop-sign-in-shown"
      />

      {/* A number this business already signs in, or a shop that already had a sign-in: nothing was
          made, so there is nothing to cancel — one closing button. */}
      <Dialog
        open={step?.kind === 'told'}
        onClose={close}
        title={
          step?.kind === 'told' && step.words === 'si.already'
            ? t('si.alreadyTitle')
            : t('si.existingTitle')
        }
        body={
          step?.kind === 'told' ? (
            <Stack gap={3}>
              <Txt field="body" desk="body" testID="shop-sign-in-told">
                {t(step.words)}
              </Txt>
              {step.username === null ? null : (
                <Big
                  label={t('si.username')}
                  value={step.username}
                  testID="shop-sign-in-told-username"
                />
              )}
            </Stack>
          ) : null
        }
        confirmLabel={t('si.ok')}
        cancelLabel={null}
        onConfirm={close}
        testID="shop-sign-in-told-dialog"
      />

      {/* A new first password: say what happens, then act, then show it once. */}
      <Dialog
        open={step?.kind === 'password'}
        onClose={close}
        title={t('si.newPassword')}
        body={
          <Stack gap={3}>
            <Txt field="body" desk="body">
              {t('si.newPasswordBody', { shop: shop.name })}
            </Txt>
            <Problem text={refusalText} testID="shop-sign-in-password-refusal" />
          </Stack>
        }
        confirmLabel={t('si.newPasswordConfirm')}
        busy={newPassword.status === 'pending'}
        onConfirm={() => {
          if (step?.kind !== 'password' || username === null) return
          const password = step.password
          void newPassword.mutateAsync({ shopId: shop.id, password }).then(
            () => {
              setStep({ kind: 'shown', username, password, handOver: null })
            },
            () => {
              /* the refusal prints in the dialog, which stays open */
            },
          )
        }}
        testID="shop-sign-in-password-dialog"
      />

      {/* Stop: say what stays, then act. */}
      <Dialog
        open={step?.kind === 'stop'}
        onClose={close}
        title={t('si.stop')}
        body={
          <Stack gap={3}>
            <Txt field="body" desk="body">
              {t('si.stopBody', { shop: shop.name })}
            </Txt>
            <Problem text={refusalText} testID="shop-sign-in-stop-refusal" />
          </Stack>
        }
        confirmLabel={t('si.stopConfirm')}
        destructive
        busy={stop.status === 'pending'}
        onConfirm={() => {
          void stop.mutateAsync(shop.id).then(
            () => {
              close()
              onToast(t('si.stopped'))
            },
            () => {
              /* the refusal prints in the dialog, which stays open */
            },
          )
        }}
        testID="shop-sign-in-stop-dialog"
      />
    </Stack>
  )
}

/** A label over a large value a shopkeeper reads out or types: the username, the first password. */
function Big({
  label,
  value,
  testID,
}: {
  label: string
  value: string
  testID: string
}): React.JSX.Element {
  const colors = useColors()
  return (
    <Stack gap={1}>
      <Txt field="label" desk="meta" color={colors.text.secondary}>
        {label}
      </Txt>
      <Txt field="moneyL" desk="kpi" wrap="anywhere" testID={testID}>
        {value}
      </Txt>
    </Stack>
  )
}

function Hint({ children }: { children: ReactNode }): React.JSX.Element {
  const colors = useColors()
  return (
    <Txt field="label" desk="meta" color={colors.text.secondary}>
      {children}
    </Txt>
  )
}

/** The service's own sentence for a refused write, in the refusal colour, above the buttons. */
function Problem({ text, testID }: { text: string | null; testID: string }): React.JSX.Element {
  const colors = useColors()
  if (text === null) return <></>
  return (
    <Txt field="body" desk="body" color={colors.status.brick.fg} testID={testID}>
      {text}
    </Txt>
  )
}
