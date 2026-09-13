/**
 * P3 — onboard a distributor.
 *
 * `admin.tenants.create` is the ONE procedure in the product that creates a distributorship: the
 * tenant row, its chart of accounts, its locations and its numbering series (`bootstrapTenant`), the
 * first owner login with a temporary password, and a trial subscription — in one idempotent call.
 * Creating a second one by accident would be expensive to unpick, which is why every id on this
 * screen is generated ONCE, held for the life of the form, and sent again unchanged on a retry.
 *
 * The owner's password is temporary by construction (`mustChangePassword` is set), so nobody at
 * Distribution OS knows the distributor's password after the handover call. The last panel is that
 * call: the username and the password to read out, and nothing else.
 */
import { usePlatformApi, useMutation } from '@dos/api-client/react'
import {
  Button,
  Chips,
  ErrorState,
  Link,
  Row,
  RupeeInput,
  Screen,
  Segments,
  Stack,
  TextInput,
  Txt,
  useColors,
  useStrings,
} from '@dos/ui'
import { isValidGstin, stateCodeFromGstin, uuidv7 } from '@dos/domain'
import type { BillingInterval, TenantPlan } from '@dos/contracts'
import { useRouter } from 'expo-router'
import { useMemo, useState } from 'react'

import { Note, Panel, useCan } from '../../src/lib/ui'
import { stateName } from '../../src/lib/words'

const PLANS: readonly TenantPlan[] = ['pilot', 'starter', 'growth', 'standard', 'pro']
const INTERVALS: readonly BillingInterval[] = ['monthly', 'quarterly', 'yearly']
const PLAN_WORDS: Readonly<Record<TenantPlan, string>> = {
  pilot: 'Pilot',
  starter: 'Starter',
  growth: 'Growth',
  standard: 'Standard',
  pro: 'Pro',
}
const INTERVAL_WORDS: Readonly<Record<BillingInterval, string>> = {
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  yearly: 'Yearly',
}

/** `UsernameSchema`: letters, digits, dot and underscore, starting with a letter or digit. */
const USERNAME = /^[a-z0-9][a-z0-9._]{2,31}$/
/** `PasswordSchema`: 8–72 characters with at least one letter and one digit. */
function weakPassword(value: string): boolean {
  return value.length < 8 || !/[A-Za-z]/.test(value) || !/\d/.test(value)
}

/**
 * Ten digits, or the same ten with +91 in front, normalised to the E.164 the contract insists on.
 * A console types what is written on the visiting card; the wire shape is not the reader's problem.
 */
function toE164(input: string): string | null {
  const digits = input.replace(/[^\d]/g, '')
  const ten = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits
  return /^[6-9]\d{9}$/.test(ten) ? `+91${ten}` : null
}

/** A handle out of a legal name: `M/s. Tarsun Enterprise` → `tarsun-enterprise`. */
function handleFrom(name: string): string {
  return name
    .toLowerCase()
    .replace(/\bm\/?s\.?\b/g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '')
}

/** A readable temporary password: two words, four digits. Read out on a call, then changed. */
function suggestPassword(): string {
  const words = ['Kalyan', 'Godown', 'Ledger', 'Beat', 'Lorry', 'Bazaar', 'Counter', 'Trade']
  const one = words[Math.floor(Math.random() * words.length)] ?? 'Kalyan'
  const digits = String(1000 + Math.floor(Math.random() * 9000))
  return `${one}@${digits}`
}

export default function OnboardDistributor(): React.JSX.Element {
  const t = useStrings()
  const colors = useColors()
  const api = usePlatformApi()
  const router = useRouter()
  const can = useCan()

  /*
   * Every client-generated UUIDv7 this call needs, made ONCE. `useState` with an initialiser keeps
   * them across every render and every corrected retry, which is what makes the call idempotent in
   * the way that matters: the same intent can never create two distributorships.
   */
  const [ids, setIds] = useState(() => ({
    tenant: uuidv7(),
    user: uuidv7(),
    membership: uuidv7(),
    subscription: uuidv7(),
  }))

  const [legalName, setLegalName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [gstin, setGstin] = useState('')
  const [stateCode, setStateCode] = useState('27')
  const [plan, setPlan] = useState<TenantPlan>('starter')

  const [ownerName, setOwnerName] = useState('')
  const [username, setUsername] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState(suggestPassword)

  const [trialDays, setTrialDays] = useState('30')
  const [amountPaise, setAmountPaise] = useState<number | null>(199900)
  const [interval, setInterval] = useState<BillingInterval>('monthly')
  const [seats, setSeats] = useState('10')

  const handle = slugTouched ? slug : handleFrom(legalName)
  const gstinTyped = gstin.trim().toUpperCase()
  const gstinValid = gstinTyped === '' || isValidGstin(gstinTyped)
  const gstinState = gstinTyped !== '' && gstinValid ? stateCodeFromGstin(gstinTyped) : null
  const effectiveState = gstinState ?? stateCode
  const e164 = toE164(phone)

  const problem = useMemo((): string | null => {
    if (legalName.trim().length < 2) return t('p3.needName')
    if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(handle)) return t('p3.needHandle')
    if (!gstinValid) return t('p3.gstinBad')
    if (!/^\d{2}$/.test(effectiveState)) return t('p3.needState')
    if (ownerName.trim() === '' || !USERNAME.test(username.trim().toLowerCase()) || e164 === null)
      return t('p3.needOwner')
    if (weakPassword(password)) return t('p3.needPassword')
    return null
  }, [legalName, handle, gstinValid, effectiveState, ownerName, username, e164, password, t])

  const create = useMutation(
    (_input: string, meta) =>
      api.api.admin.tenants.create({
        idempotencyKey: meta.idempotencyKey,
        id: ids.tenant,
        slug: handle,
        legalName: legalName.trim(),
        ...(gstinTyped === '' ? {} : { gstin: gstinTyped }),
        stateCode: effectiveState,
        plan,
        owner: {
          userId: ids.user,
          membershipId: ids.membership,
          username: username.trim().toLowerCase(),
          name: ownerName.trim(),
          phone: e164 ?? '',
          temporaryPassword: password,
        },
        subscription: {
          id: ids.subscription,
          trialDays: Number(trialDays) || 0,
          amountPaise: amountPaise ?? 0,
          billingInterval: interval,
          ...(seats.trim() === '' ? {} : { seats: Number(seats) }),
        },
      }),
    {
      invalidates: [
        ['admin', 'tenant'],
        ['admin', 'tenants'],
        ['admin', 'metrics'],
        ['admin', 'subscriptions'],
      ],
    },
  )

  // Reached by a deep link from a support or billing account (DOS-106): onboarding is a super
  // administrator's, so the form is never offered. The server refuses the call either way.
  if (!can('admin.tenants.create')) {
    return (
      <Screen title={t('p3.title')} context={t('p2.title')}>
        <Stack gap={4} maxWidth={520}>
          <Note testID="onboard-super-only">{t('p3.superOnly')}</Note>
          <Link href="/distributors" testID="onboard-back">
            {t('p3.superOnlyBack')}
          </Link>
        </Stack>
      </Screen>
    )
  }

  const done = create.data
  if (done !== undefined) {
    return (
      <Screen title={t('p3.doneTitle', { name: done.tenant.legalName })} context={t('p3.title')}>
        <Stack gap={5} maxWidth={520}>
          <Note tone="accent" testID="onboard-handover">
            {t('p3.doneBody')}
          </Note>
          <Panel title={t('p3.owner')}>
            <Stack gap={3}>
              <Row justify="between" gap={4}>
                <Txt field="body" desk="body" color={colors.text.secondary}>
                  {t('p3.doneUsername')}
                </Txt>
                <Txt field="bodyStrong" desk="cell" numeric testID="handover-username">
                  {done.owner.username}
                </Txt>
              </Row>
              <Row justify="between" gap={4}>
                <Txt field="body" desk="body" color={colors.text.secondary}>
                  {t('p3.donePassword')}
                </Txt>
                <Txt field="bodyStrong" desk="cell" numeric testID="handover-password">
                  {password}
                </Txt>
              </Row>
              <Row justify="between" gap={4}>
                <Txt field="body" desk="body" color={colors.text.secondary}>
                  {t('p3.handle')}
                </Txt>
                <Txt field="bodyStrong" desk="cell">
                  {done.tenant.slug}
                </Txt>
              </Row>
            </Stack>
          </Panel>
          <Row gap={3} wrap>
            <Button
              label={t('p3.doneOpen')}
              variant="primary"
              testID="handover-open"
              onPress={() => {
                router.replace(`/distributors/${done.tenant.id}`)
              }}
            />
            <Button
              label={t('p3.doneAnother')}
              variant="secondary"
              onPress={() => {
                setIds({
                  tenant: uuidv7(),
                  user: uuidv7(),
                  membership: uuidv7(),
                  subscription: uuidv7(),
                })
                setLegalName('')
                setSlug('')
                setSlugTouched(false)
                setGstin('')
                setOwnerName('')
                setUsername('')
                setPhone('')
                setPassword(suggestPassword())
                create.reset()
              }}
            />
          </Row>
        </Stack>
      </Screen>
    )
  }

  return (
    <Screen title={t('p3.title')} context={t('p2.title')}>
      <Stack gap={6} maxWidth={720}>
        <Note testID="onboard-intro">{t('p3.intro')}</Note>

        <Panel title={t('p3.business')}>
          <Stack gap={4}>
            <TextInput
              label={t('p3.legalName')}
              value={legalName}
              onChange={setLegalName}
              helper={t('p3.legalNameHelp')}
              capitalize="words"
              autoFocus
              testID="legal-name"
            />
            <TextInput
              label={t('p3.handle')}
              value={handle}
              onChange={(value) => {
                setSlugTouched(true)
                setSlug(value.toLowerCase())
              }}
              helper={t('p3.handleHelp')}
              testID="handle"
            />
            <TextInput
              label={t('p3.gstin')}
              value={gstin}
              onChange={setGstin}
              helper={
                gstinState === null
                  ? t('p3.gstinHelp')
                  : t('p3.gstinState', { state: stateName(gstinState) })
              }
              {...(gstinValid ? {} : { error: t('p3.gstinBad') })}
              maxLength={15}
              testID="gstin"
            />
            <TextInput
              label={t('p3.state')}
              value={effectiveState}
              onChange={setStateCode}
              state={gstinState === null ? 'default' : 'readonly'}
              helper={stateName(effectiveState)}
              keyboard="decimal"
              maxLength={2}
              testID="state-code"
            />
            <Stack gap={2}>
              <Txt field="label" desk="meta" color={colors.text.secondary}>
                {t('p3.plan')}
              </Txt>
              <Chips
                testID="plan-choice"
                items={PLANS.map((id) => ({
                  id,
                  label: PLAN_WORDS[id],
                  selected: plan === id,
                }))}
                onToggle={(id) => {
                  setPlan(id as TenantPlan)
                }}
              />
            </Stack>
          </Stack>
        </Panel>

        <Panel title={t('p3.owner')} meta={t('p3.ownerHelp')}>
          <Stack gap={4}>
            <TextInput
              label={t('p3.ownerName')}
              value={ownerName}
              onChange={setOwnerName}
              capitalize="words"
              testID="owner-name"
            />
            <TextInput
              label={t('p3.ownerUsername')}
              value={username}
              onChange={setUsername}
              testID="owner-username"
            />
            <TextInput
              label={t('p3.ownerPhone')}
              value={phone}
              onChange={setPhone}
              helper={e164 ?? t('p3.ownerPhoneHelp')}
              keyboard="phone"
              testID="owner-phone"
            />
            <Row gap={3} align="end" wrap>
              <Stack grow>
                <TextInput
                  label={t('p3.temporaryPassword')}
                  value={password}
                  onChange={setPassword}
                  helper={t('app.passwordRule')}
                  testID="owner-password"
                />
              </Stack>
              <Button
                label={t('p3.suggest')}
                variant="ghost"
                testID="suggest-password"
                onPress={() => {
                  setPassword(suggestPassword())
                }}
              />
            </Row>
          </Stack>
        </Panel>

        <Panel title={t('p3.subscription')} meta={t('p5.ourPrice')}>
          <Stack gap={4}>
            <TextInput
              label={t('p3.trialDays')}
              value={trialDays}
              onChange={setTrialDays}
              keyboard="decimal"
              maxLength={3}
              testID="trial-days"
            />
            <RupeeInput
              label={t('p3.price')}
              value={amountPaise}
              onChange={setAmountPaise}
              testID="price"
            />
            <Stack gap={2}>
              <Txt field="label" desk="meta" color={colors.text.secondary}>
                {t('p3.interval')}
              </Txt>
              <Segments
                testID="interval"
                value={interval}
                onChange={(id) => {
                  setInterval(id as BillingInterval)
                }}
                items={INTERVALS.map((id) => ({ id, label: INTERVAL_WORDS[id] }))}
              />
            </Stack>
            <TextInput
              label={t('p3.seats')}
              value={seats}
              onChange={setSeats}
              helper={t('p3.seatsHelp')}
              keyboard="decimal"
              maxLength={5}
              testID="seats"
            />
          </Stack>
        </Panel>

        {create.error === undefined ? null : (
          <ErrorState message={create.error.message} detail={create.error.kind} />
        )}

        <Button
          label={t('p3.create')}
          variant="primary"
          fullWidth
          testID="onboard-submit"
          loading={create.status === 'pending'}
          disabled={problem !== null || create.status === 'pending'}
          {...(problem === null ? {} : { disabledReason: problem })}
          onPress={() => {
            create.mutate(ids.tenant)
          }}
        />
      </Stack>
    </Screen>
  )
}
