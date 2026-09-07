/**
 * The subscription editor, written once and opened from two places: a distributorship's own page and
 * the Subscriptions register.
 *
 * `admin.subscriptions.upsert` is an UPSERT keyed on the row's id — sending an id that already
 * exists replaces it, because one distributor has one live subscription. So the editor holds the id
 * it was given, or mints one when a distributorship has none yet, and never changes it while it is
 * open: a retry after a lost reply must land on the same row.
 *
 * The money here is OUR price to a distributor. It is the only money in this console, and the panel
 * says so — nothing on any screen of this app is a rupee of a distributor's own trade.
 */
import { usePlatformApi, useMutation } from '@dos/api-client/react'
import {
  Button,
  Chips,
  ErrorState,
  RupeeInput,
  Segments,
  Sheet,
  Stack,
  TextInput,
  Txt,
  useColors,
  useStrings,
} from '@dos/ui'
import { uuidv7 } from '@dos/domain'
import type { BillingInterval, Subscription, SubscriptionStatus, TenantPlan } from '@dos/contracts'
import { useEffect, useRef, useState } from 'react'

import { Note } from './ui'
import { longDate, shiftDays, today } from './dates'

const PLANS: readonly TenantPlan[] = ['pilot', 'starter', 'growth', 'standard', 'pro']
const STATUSES: readonly SubscriptionStatus[] = [
  'trialing',
  'active',
  'past_due',
  'suspended',
  'cancelled',
]
const INTERVALS: readonly BillingInterval[] = ['monthly', 'quarterly', 'yearly']

export interface SubscriptionEditorProps {
  open: boolean
  onClose: () => void
  tenantId: string
  tenantName: string
  /** The live row, or null for a distributorship that has never had one. */
  current: Subscription | null
  testID?: string
}

export function SubscriptionEditor({
  open,
  onClose,
  tenantId,
  tenantName,
  current,
  testID,
}: SubscriptionEditorProps): React.JSX.Element {
  const t = useStrings()
  const colors = useColors()
  const api = usePlatformApi()

  const [id, setId] = useState(() => current?.id ?? uuidv7())
  const [plan, setPlan] = useState<TenantPlan>(current?.plan ?? 'starter')
  const [status, setStatus] = useState<SubscriptionStatus>(current?.status ?? 'trialing')
  const [amountPaise, setAmountPaise] = useState<number | null>(current?.amountPaise ?? 0)
  const [interval, setInterval] = useState<BillingInterval>(current?.billingInterval ?? 'monthly')
  const [seats, setSeats] = useState(current?.seats === null ? '' : String(current?.seats ?? ''))
  const [periodStart, setPeriodStart] = useState(current?.currentPeriodStart ?? today())
  const [periodEnd, setPeriodEnd] = useState(current?.currentPeriodEnd ?? shiftDays(today(), 30))
  const [trialEnd, setTrialEnd] = useState(current?.trialEndDate ?? '')
  const [note, setNote] = useState(current?.note ?? '')

  /*
   * The sheet is mounted for the life of the page and opened per row, so the row it is editing can
   * change under it — and re-seeding on OPEN, never on every render, is what keeps a half-typed
   * price from being thrown away while the sheet is still up.
   *
   * Which is why the trigger is the row's ID and not the row OBJECT. `useQuery` hands back a value
   * parsed from JSON, so every refetch — the 30-second staleness, any invalidation this screen or
   * another mutation fires — is a NEW object for the same subscription. With `current` in the deps
   * the effect ran on each of those and put the server's values back over whatever the console had
   * typed, mid-edit, with the sheet open. The id changes only when the sheet is genuinely pointed at
   * a different subscription, which is the one moment re-seeding is right.
   */
  const rowId = current?.id ?? null
  const seed = useRef(current)
  seed.current = current
  useEffect(() => {
    if (!open) return
    const row = seed.current
    setId(row?.id ?? uuidv7())
    setPlan(row?.plan ?? 'starter')
    setStatus(row?.status ?? 'trialing')
    setAmountPaise(row?.amountPaise ?? 0)
    setInterval(row?.billingInterval ?? 'monthly')
    setSeats(row?.seats === null || row?.seats === undefined ? '' : String(row.seats))
    setPeriodStart(row?.currentPeriodStart ?? today())
    setPeriodEnd(row?.currentPeriodEnd ?? shiftDays(today(), 30))
    setTrialEnd(row?.trialEndDate ?? '')
    setNote(row?.note ?? '')
  }, [open, rowId])

  const save = useMutation(
    (_input: string, meta) =>
      api.api.admin.subscriptions.upsert({
        idempotencyKey: meta.idempotencyKey,
        id,
        tenantId,
        plan,
        status,
        amountPaise: amountPaise ?? 0,
        billingInterval: interval,
        seats: seats.trim() === '' ? null : Number(seats),
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        trialEndDate: trialEnd.trim() === '' ? null : trialEnd.trim(),
        note: note.trim() === '' ? null : note.trim(),
      }),
    {
      invalidates: [
        ['admin', 'subscriptions'],
        ['admin', 'tenant'],
        ['admin', 'tenants'],
        ['admin', 'metrics'],
      ],
      onSuccess: () => {
        onClose()
      },
    },
  )

  const dateLooksWrong = (value: string): boolean => !/^\d{4}-\d{2}-\d{2}$/.test(value)
  /*
   * A field carries the date back in WORDS while it is right, and the format while it is not — the
   * three date fields had no helper at all, and a console typing "6 Sep 2026" got a Save button that
   * had gone quiet with the field's own LABEL as its reason ("Period starts", measured). A reason a
   * button is refusing is a sentence, and a date on this screen reads "6 Sep 2026" everywhere else.
   */
  const dateHelp = (value: string, optional = false): string =>
    value.trim() === ''
      ? optional
        ? t('p5.dateOptional')
        : t('p5.dateFormat')
      : dateLooksWrong(value)
        ? t('p5.dateFormat')
        : longDate(value)
  const problem =
    dateLooksWrong(periodStart) ||
    dateLooksWrong(periodEnd) ||
    (trialEnd.trim() !== '' && dateLooksWrong(trialEnd))
      ? t('p5.dateWrong')
      : null

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('p5.editTitle', { name: tenantName })}
      testID={testID}
    >
      <Stack gap={4}>
        <Note>{t('p5.ourPrice')}</Note>
        <Stack gap={2}>
          <Txt field="label" desk="meta" color={colors.text.secondary}>
            {t('p5.plan')}
          </Txt>
          <Chips
            testID="subscription-plan"
            items={PLANS.map((value) => ({
              id: value,
              label: t(`word.${value}`),
              selected: plan === value,
            }))}
            onToggle={(value) => {
              setPlan(value as TenantPlan)
            }}
          />
        </Stack>
        <Stack gap={2}>
          <Txt field="label" desk="meta" color={colors.text.secondary}>
            {t('p5.state')}
          </Txt>
          <Chips
            testID="subscription-status"
            items={STATUSES.map((value) => ({
              id: value,
              label: t(`word.${value}`),
              selected: status === value,
            }))}
            onToggle={(value) => {
              setStatus(value as SubscriptionStatus)
            }}
          />
        </Stack>
        <RupeeInput
          label={t('p5.price')}
          value={amountPaise}
          onChange={setAmountPaise}
          testID="subscription-price"
        />
        <Stack gap={2}>
          <Txt field="label" desk="meta" color={colors.text.secondary}>
            {t('p5.interval')}
          </Txt>
          <Segments
            testID="subscription-interval"
            value={interval}
            onChange={(value) => {
              setInterval(value as BillingInterval)
            }}
            items={INTERVALS.map((value) => ({ id: value, label: t(`word.${value}`) }))}
          />
        </Stack>
        <TextInput
          label={t('p5.seats')}
          value={seats}
          onChange={setSeats}
          helper={t('p3.seatsHelp')}
          keyboard="decimal"
          maxLength={5}
          testID="subscription-seats"
        />
        <TextInput
          label={t('p5.periodStart')}
          value={periodStart}
          onChange={setPeriodStart}
          helper={dateHelp(periodStart)}
          maxLength={10}
          testID="subscription-period-start"
        />
        <TextInput
          label={t('p5.periodEnd')}
          value={periodEnd}
          onChange={setPeriodEnd}
          helper={dateHelp(periodEnd)}
          maxLength={10}
          testID="subscription-period-end"
        />
        <TextInput
          label={t('p5.trialEnds')}
          value={trialEnd}
          onChange={setTrialEnd}
          helper={dateHelp(trialEnd, true)}
          maxLength={10}
          testID="subscription-trial-end"
        />
        <TextInput
          label={t('p5.note')}
          value={note}
          onChange={setNote}
          capitalize="sentences"
          maxLength={500}
          testID="subscription-note"
        />
        {save.error === undefined ? null : (
          <ErrorState message={save.error.message} detail={save.error.kind} />
        )}
        <Button
          label={t('p5.save')}
          variant="primary"
          fullWidth
          testID="subscription-save"
          loading={save.status === 'pending'}
          disabled={problem !== null || save.status === 'pending'}
          {...(problem === null ? {} : { disabledReason: problem })}
          onPress={() => {
            save.mutate(id)
          }}
        />
      </Stack>
    </Sheet>
  )
}
