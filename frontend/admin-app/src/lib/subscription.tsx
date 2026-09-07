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
import { useEffect, useState } from 'react'

import { Note } from './ui'
import { shiftDays, today } from './dates'

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
   * change under it. Re-seeding on open — never on every render — is what keeps a half-typed price
   * from being thrown away while the sheet is still up.
   */
  useEffect(() => {
    if (!open) return
    setId(current?.id ?? uuidv7())
    setPlan(current?.plan ?? 'starter')
    setStatus(current?.status ?? 'trialing')
    setAmountPaise(current?.amountPaise ?? 0)
    setInterval(current?.billingInterval ?? 'monthly')
    setSeats(current?.seats === null || current?.seats === undefined ? '' : String(current.seats))
    setPeriodStart(current?.currentPeriodStart ?? today())
    setPeriodEnd(current?.currentPeriodEnd ?? shiftDays(today(), 30))
    setTrialEnd(current?.trialEndDate ?? '')
    setNote(current?.note ?? '')
  }, [open, current])

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
  const problem =
    dateLooksWrong(periodStart) || dateLooksWrong(periodEnd)
      ? t('p5.periodStart')
      : trialEnd.trim() !== '' && dateLooksWrong(trialEnd)
        ? t('p5.trialEnds')
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
          maxLength={10}
          testID="subscription-period-start"
        />
        <TextInput
          label={t('p5.periodEnd')}
          value={periodEnd}
          onChange={setPeriodEnd}
          maxLength={10}
          testID="subscription-period-end"
        />
        <TextInput
          label={t('p5.trialEnds')}
          value={trialEnd}
          onChange={setTrialEnd}
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
