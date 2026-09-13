/**
 * O24 — settings: the business profile, the branding, the numbering series, the feature flags, the
 * delivery policy and the support-access window (docs/23 §1.1, §1.5).
 *
 * This is the white-label surface: the display name and the logo the owner sets here are the chrome
 * of every app of this distributorship and the header of every document it prints. Nothing on this
 * screen touches the ACCENT — UX-00 §11 keeps the palette ours because a tenant colour would void
 * every contrast ratio in §3 — and the preview says exactly that.
 */
import type { FeatureFlagRow, NumberingSeries, SupportGrant } from '@dos/contracts'
import { newMutation } from '@dos/api-client'
import { useApi, useMutation, useQuery, useSession } from '@dos/api-client/react'
import {
  Button,
  Chips,
  Dialog,
  Money,
  Register,
  Screen,
  Segments,
  Stack,
  StatusChip,
  TenantLogo,
  TextInput,
  Txt,
  useColors,
  useStrings,
  type RegisterColumn,
} from '@dos/ui'
import { files as platformFiles } from '@dos/ui/platform'
import { useState } from 'react'

import { Async, Columns, Field, Half, PageTabs, Panel, textColumn } from '../../src/lib/ui'
import { absoluteUrl } from '../../src/config'
import { instantWithClock } from '../../src/lib/dates'
import { Refusal, stayOpen } from '../../src/lib/refusal'
import {
  SETTINGS_VIEWS,
  chosenHours,
  supportDecision,
  windowClosesAt,
  type SettingsView,
  type SupportDecision,
} from '../../src/lib/support'
import { useWord } from '../../src/lib/words'

/** `delivery.pod_required` as `tenant-bootstrap.ts` documents it: when a photo or signature is a must. */
const POD_POLICIES = ['always', 'credit_only', 'never'] as const

type GrantAction = 'approve' | 'refuse' | 'revoke'

export default function Settings(): React.JSX.Element {
  const t = useStrings()
  const word = useWord()
  const colors = useColors()
  const api = useApi()
  const { session } = useSession()
  const [view, setView] = useState<SettingsView>('business')
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [logoNote, setLogoNote] = useState<string | null>(null)
  const [grantId, setGrantId] = useState<string | null>(null)
  const [grantAction, setGrantAction] = useState<GrantAction | null>(null)
  /** The hours picked on each waiting request, by grant id: one request's choice never carries into another. */
  const [hoursById, setHoursById] = useState<Record<string, number>>({})

  const branding = useQuery(['tenancy', 'branding'], () => api.api.tenancy.branding.get())
  const settings = useQuery(['tenancy', 'settings'], () => api.api.tenancy.settings.get({}))
  const numbering = useQuery(['tenancy', 'numbering'], () => api.api.tenancy.numbering.list({}), {
    enabled: view === 'numbering',
  })
  const flags = useQuery(['tenancy', 'flags'], () => api.api.tenancy.featureFlags.list(), {
    enabled: view === 'flags',
  })
  const grants = useQuery(['tenancy', 'support'], () => api.api.tenancy.support.list({}), {
    enabled: view === 'support',
  })

  const save = useMutation(
    (items: readonly { key: string; value: string }[], meta) =>
      api.api.tenancy.settings.set({
        idempotencyKey: meta.idempotencyKey,
        items: [...items],
      }),
    { invalidates: [['tenancy']] },
  )
  const setFlag = useMutation(
    (input: { flag: string; enabled: boolean }, meta) =>
      api.api.tenancy.featureFlags.set({
        idempotencyKey: meta.idempotencyKey,
        items: [{ flag: input.flag as 'van_sales', enabled: input.enabled }],
      }),
    { invalidates: [['tenancy', 'flags']] },
  )
  /** `hours` is always sent: an approval without it opens the STORED window, not the one on the card. */
  const approveGrant = useMutation(
    (input: { id: string; hours: number }, meta) =>
      api.api.tenancy.support.approve({
        id: input.id,
        hours: input.hours,
        idempotencyKey: meta.idempotencyKey,
      }),
    { invalidates: [['tenancy', 'support']] },
  )
  /** Refuse and Revoke are this one write: owner-service records `rejected` or `revoked` from the row. */
  const revokeGrant = useMutation(
    (id: string, meta) =>
      api.api.tenancy.support.revoke({ id, idempotencyKey: meta.idempotencyKey }),
    { invalidates: [['tenancy', 'support']] },
  )

  const rows = settings.data?.items ?? []
  const valueOf = (key: string): string => {
    if (key in edits) return edits[key] ?? ''
    const row = rows.find((item) => item.key === key)
    /*
     * A setting value is a string, a number, a boolean or a JSON object (`SettingValueSchema`). The
     * text fields on this screen edit the scalar ones; an object is shown as its JSON rather than as
     * `[object Object]`, which is what an unguarded `String()` would print.
     */
    if (row === undefined || row.value === null || row.value === undefined) return ''
    if (typeof row.value === 'object') return JSON.stringify(row.value)
    return String(row.value)
  }
  const edit = (key: string) => (next: string) => {
    setEdits((current) => ({ ...current, [key]: next }))
  }

  /**
   * The logo goes to object storage through a SIGNED url: the app never learns an object key and
   * never talks to the bucket by any other route (`files.uploadUrl` → PUT → `settings.set`).
   */
  const uploadLogo = (): void => {
    setLogoNote(null)
    const tenantId = session?.tenant.id
    if (tenantId === undefined) return
    void platformFiles.pick({ mimeTypes: ['image/png', 'image/jpeg'] }).then((picked) => {
      if (picked === null) return
      const intent = newMutation()
      void api.api.files
        .uploadUrl({
          id: intent.id,
          idempotencyKey: intent.idempotencyKey,
          domain: 'logo',
          entityId: tenantId,
          mimeType: picked.mimeType as 'image/png',
          bytes: Math.max(1, picked.size),
        })
        .then(
          async (signed) => {
            if (signed.url === null) {
              setLogoNote(t('state.error'))
              return
            }
            await platformFiles.upload(picked, signed.url, {
              method: 'PUT',
              headers: signed.headers,
            })
            await save.mutateAsync([{ key: 'branding.logo_object_key', value: signed.objectKey }])
            setLogoNote(t('app.saved'))
          },
          (error: unknown) => {
            setLogoNote(error instanceof Error ? error.message : t('state.error'))
          },
        )
    })
  }

  const seriesColumns: readonly RegisterColumn<NumberingSeries>[] = [
    textColumn('code', t('o24.series'), (row) => row.seriesCode, { priority: 'identity' }),
    textColumn('prefix', t('o24.prefix'), (row) => row.prefix),
    textColumn('next', t('o24.next'), (row) => row.nextNo),
    textColumn('mode', t('o24.allocation'), (row) => word(row.allocationMode)),
    {
      key: 'locked',
      head: t('o24.lockedHint'),
      priority: 'chip',
      cell: (row) => (
        <StatusChip
          label={row.lockedAfterFirstIssue ? t('word.yes') : t('word.no')}
          family={row.lockedAfterFirstIssue ? 'ochre' : 'neutral'}
        />
      ),
    },
  ]

  const flagColumns: readonly RegisterColumn<FeatureFlagRow>[] = [
    textColumn('flag', t('o24.flag'), (row) => word(row.flag), { priority: 'identity' }),
    {
      key: 'enabled',
      head: t('o24.on'),
      priority: 'chip',
      cell: (row) => (
        <StatusChip
          label={row.enabled ? t('o24.on') : t('o24.off')}
          family={row.enabled ? 'moss' : 'neutral'}
        />
      ),
    },
    {
      key: 'toggle',
      head: t('app.save'),
      cell: (row) => (
        <Button
          label={row.enabled ? t('o24.off') : t('o24.on')}
          variant="ghost"
          onPress={() => {
            setFlag.mutate({ flag: row.flag, enabled: !row.enabled })
          }}
        />
      ),
    },
  ]

  /*
   * The support history: every request, whatever became of it. It carries no decision column — no
   * phone rendering draws one — so the decisions live on the cards above it, alike on every width.
   */
  const grantColumns: readonly RegisterColumn<SupportGrant>[] = [
    textColumn('who', t('o7.person'), (row) => row.requestedByName, { priority: 'identity' }),
    textColumn('scope', t('o24.supportWindow'), (row) => word(row.scope)),
    textColumn('reason', t('o24.reason'), (row) => row.reason),
    textColumn('asked', t('o3.asked'), (row) => instantWithClock(row.requestedAt)),
    textColumn('closes', t('o24.closes'), (row) => instantWithClock(row.expiresAt)),
    {
      key: 'status',
      head: t('o16.status'),
      priority: 'chip',
      cell: (row) => (
        <StatusChip
          label={word(row.status)}
          family={row.active ? 'moss' : row.status === 'requested' ? 'ochre' : 'neutral'}
        />
      ),
    },
  ]

  /*
   * DOS-108: `Date.now()` once per render, handed to the pure rules in src/lib/support.ts, so the cards,
   * their hour chips and the dialog all read the same instant.
   */
  const now = Date.now()
  const supportItems = grants.data?.items ?? []
  const cards = supportItems.flatMap((row) => {
    const decision = supportDecision(row, now)
    return decision.kind === 'closed' ? [] : [{ row, decision }]
  })
  const decide = (id: string, action: GrantAction) => () => {
    setGrantId(id)
    setGrantAction(action)
  }

  /**
   * One request the owner can still act on: who asks, why, for how long, and the presses owner-service
   * accepts — the hours asked or fewer, or Refuse, while it waits; Revoke while it is open. A page-level
   * panel, never a Sheet, so its confirm Dialog is never a second native Modal (DOS-164).
   */
  const supportCard = (row: SupportGrant, decision: SupportDecision): React.JSX.Element => {
    const chosen = decision.kind === 'waiting' ? chosenHours(decision, hoursById[row.id]) : null
    return (
      <Panel
        key={row.id}
        testID={`support-card-${row.id}`}
        title={row.requestedByName}
        meta={word(row.scope)}
      >
        <Field label={t('o24.reason')}>{row.reason}</Field>
        <Field label={t('o24.hoursAsked')}>
          {t('o24.hoursCount', { count: row.requestedHours })}
        </Field>
        <Field label={t('o3.asked')}>{instantWithClock(row.requestedAt)}</Field>
        {decision.kind === 'waiting' && chosen !== null ? (
          <Stack gap={3}>
            <Chips
              testID={`support-hours-${row.id}`}
              items={decision.hours.map((hours) => ({
                id: String(hours),
                label: t('o24.hoursCount', { count: hours }),
                selected: hours === chosen,
              }))}
              onToggle={(id) => {
                setHoursById((current) => ({ ...current, [row.id]: Number(id) }))
              }}
            />
            <Txt field="label" desk="meta" color={colors.text.secondary}>
              {t('o24.countedFromAsk')}
            </Txt>
            <Field label={t('o24.openUntil')}>
              {instantWithClock(windowClosesAt(row.requestedAt, chosen))}
            </Field>
            <Button
              label={t('o24.approveFor', { count: chosen })}
              variant="primary"
              onPress={decide(row.id, 'approve')}
              testID={`support-approve-${row.id}`}
            />
            <Button
              label={t('o24.refuseSupport')}
              variant="destructive"
              onPress={decide(row.id, 'refuse')}
              testID={`support-refuse-${row.id}`}
            />
          </Stack>
        ) : null}
        {decision.kind === 'open' ? (
          <Stack gap={3}>
            <Field label={t('o24.openUntil')}>{instantWithClock(decision.closesAt)}</Field>
            <Button
              label={t('o24.revokeSupport')}
              variant="destructive"
              onPress={decide(row.id, 'revoke')}
              testID={`support-revoke-${row.id}`}
            />
          </Stack>
        ) : null}
      </Panel>
    )
  }

  /*
   * The dialog reads the grant it is about by id and works out the hours ONCE, for its sentence, its
   * button and the body it sends — never from a card's closure. A grant that stopped waiting since its
   * card was pressed (answered in another tab, or its own hours ran out) offers no choice: its ask goes
   * as it was made, and owner-service answers 409 before the hours matter, which <Refusal> prints.
   */
  const dialogGrant =
    grantId === null ? undefined : supportItems.find((item) => item.id === grantId)
  const dialogDecision = dialogGrant === undefined ? undefined : supportDecision(dialogGrant, now)
  const dialogHours =
    dialogGrant === undefined
      ? null
      : dialogDecision?.kind === 'waiting'
        ? chosenHours(dialogDecision, hoursById[dialogGrant.id])
        : dialogGrant.requestedHours
  const dialogTitle =
    grantAction === 'approve'
      ? t('o24.approveSupport')
      : grantAction === 'refuse'
        ? t('o24.refuseSupport')
        : t('o24.revokeSupport')
  const dialogSentence = (grant: SupportGrant): string => {
    const who = grant.requestedByName
    if (grantAction === 'approve' && dialogHours !== null)
      return t('o24.confirmApprove', {
        who,
        scope: word(grant.scope),
        until: instantWithClock(windowClosesAt(grant.requestedAt, dialogHours)),
      })
    if (grantAction === 'refuse') return t('o24.confirmRefuse', { who })
    return t('o24.confirmRevoke', { who })
  }

  return (
    <Screen
      title={t('o24.title')}
      chips={<PageTabs group="/settings" active="/settings" />}
      actions={
        <>
          {view === 'business' ? (
            <Button
              label={t('app.save')}
              variant="primary"
              disabled={Object.keys(edits).length === 0}
              disabledReason={t('app.nothingChanged')}
              loading={save.status === 'pending'}
              onPress={() => {
                void save
                  .mutateAsync(Object.entries(edits).map(([key, value]) => ({ key, value })))
                  .then(
                    () => {
                      setEdits({})
                    },
                    () => {
                      /* the error stays on the mutation */
                    },
                  )
              }}
              testID="settings-save"
            />
          ) : null}
        </>
      }
    >
      {/*
       * FOUR views, so a CHIP ROW and not a segmented control (DOS-108).
       *
       * `<Segments>` is 2–3 options by UX-00 §6.10 and the kit enforces it with `items.slice(0, 3)`
       * — silently. This screen passed four, so "Support access" was dropped on the floor: the view
       * behind it, the only place an owner answers a support request, could not be opened on any
       * platform or width. Manager Inbound lost "Purchase orders" the same way; this is the same
       * repair, the kit's chip row used single-select.
       */}
      <Chips
        testID="settings-view"
        items={SETTINGS_VIEWS.map((entry) => ({
          id: entry.id,
          label: t(entry.labelKey),
          selected: view === entry.id,
        }))}
        onToggle={(id) => {
          setView(id as SettingsView)
        }}
      />

      {view === 'business' ? (
        <Stack gap={6}>
          <Columns>
            <Half>
              <Panel title={t('o24.business')} testID="settings-business">
                <Async state={[branding, settings]} rows={6}>
                  <Stack gap={3} maxWidth={520}>
                    <Field label={t('o24.legalName')}>{branding.data?.legalName ?? '—'}</Field>
                    <Field label={t('o24.gstin')}>{branding.data?.gstin ?? '—'}</Field>
                    <Field label={t('o24.stateCode')}>{branding.data?.stateCode ?? '—'}</Field>
                    <TextInput
                      label={t('o24.displayName')}
                      value={valueOf('branding.display_name')}
                      onChange={edit('branding.display_name')}
                      capitalize="words"
                      testID="settings-display-name"
                    />
                    <TextInput
                      label={t('o24.address')}
                      value={valueOf('branding.address')}
                      onChange={edit('branding.address')}
                      capitalize="sentences"
                    />
                    <TextInput
                      label={t('o24.invoiceFooter')}
                      value={valueOf('branding.invoice_footer')}
                      onChange={edit('branding.invoice_footer')}
                      capitalize="sentences"
                      testID="settings-footer"
                    />
                    <TextInput
                      label={t('o24.upi')}
                      value={valueOf('upi_vpa')}
                      onChange={edit('upi_vpa')}
                    />
                    <TextInput
                      label={t('o24.fssai')}
                      value={valueOf('seller_fssai')}
                      onChange={edit('seller_fssai')}
                      keyboard="decimal"
                    />
                  </Stack>
                </Async>
              </Panel>
            </Half>

            <Half>
              <Panel title={t('o24.branding')} testID="settings-branding">
                <Stack gap={3}>
                  <TenantLogo
                    size="card"
                    withName
                    name={session?.tenant.displayName}
                    logoUrl={absoluteUrl(branding.data?.logoUrl)}
                    subtitle={branding.data?.gstin ?? undefined}
                  />
                  <Txt field="label" desk="meta" color={colors.text.secondary}>
                    {t('o24.logoHint')}
                  </Txt>
                  <Button
                    label={t('o24.uploadLogo')}
                    variant="secondary"
                    onPress={uploadLogo}
                    testID="settings-upload-logo"
                  />
                  {logoNote === null ? null : (
                    <Txt field="label" desk="meta">
                      {logoNote}
                    </Txt>
                  )}
                </Stack>
              </Panel>

              <Panel title={t('o24.policy')}>
                <Stack gap={3} maxWidth={420}>
                  <TextInput
                    label={t('o24.geofence')}
                    value={valueOf('delivery.geofence_metres')}
                    onChange={edit('delivery.geofence_metres')}
                    keyboard="decimal"
                  />
                  {/*
                   * `delivery.pod_required` is one of three words the delivery service reads
                   * (`always` / `credit_only` / `never`, tenant-bootstrap). A free-text box made
                   * the owner type one of them exactly — and printed the machine word back at them
                   * — so a typo would silently turn proof of delivery off for the whole
                   * distributorship. Three buttons cannot be mistyped.
                   */}
                  <Stack gap={1}>
                    <Txt field="label" desk="meta" color={colors.text.secondary}>
                      {t('o24.pod')}
                    </Txt>
                    <Segments
                      testID="settings-pod"
                      value={valueOf('delivery.pod_required') || 'credit_only'}
                      onChange={edit('delivery.pod_required')}
                      items={POD_POLICIES.map((id) => ({ id, label: word(id) }))}
                    />
                  </Stack>
                  <TextInput
                    label={t('o24.gpsRetention')}
                    value={valueOf('dpdp.gps_retention_days')}
                    onChange={edit('dpdp.gps_retention_days')}
                    keyboard="decimal"
                  />
                  <Field label={t('o24.tolerance')}>
                    <Money
                      value={Number(valueOf('delivery.settlement_tolerance_paise')) || 0}
                      size="cell"
                    />
                  </Field>
                  <Field label={t('o24.ewbThreshold')}>
                    <Money value={Number(valueOf('ewb_intra_state_threshold')) || 0} size="cell" />
                  </Field>
                </Stack>
              </Panel>
            </Half>
          </Columns>
        </Stack>
      ) : null}

      {view === 'numbering' ? (
        <Async state={[numbering]} rows={8} empty={(numbering.data?.items.length ?? 0) === 0}>
          <Register
            testID="settings-numbering"
            columns={seriesColumns}
            rows={numbering.data?.items ?? []}
            rowKey={(row) => `${row.seriesCode}:${row.fy}`}
            frozen="code"
            state="ready"
          />
        </Async>
      ) : null}

      {view === 'flags' ? (
        <Async state={[flags]} rows={5} empty={(flags.data?.items.length ?? 0) === 0}>
          <Register
            testID="settings-flags"
            columns={flagColumns}
            rows={flags.data?.items ?? []}
            rowKey={(row) => row.flag}
            frozen="flag"
            state="ready"
          />
        </Async>
      ) : null}

      {view === 'support' ? (
        <Async state={[grants]} rows={5}>
          <Stack gap={6}>
            {cards.length === 0 ? (
              <Txt
                field="body"
                desk="body"
                color={colors.text.secondary}
                testID="support-none-waiting"
              >
                {t('o24.noneWaiting')}
              </Txt>
            ) : (
              cards.map(({ row, decision }) => supportCard(row, decision))
            )}
            <Register
              testID="settings-support"
              columns={grantColumns}
              rows={supportItems}
              rowKey={(row) => row.id}
              frozen="who"
              state="ready"
            />
          </Stack>
        </Async>
      ) : null}

      <Dialog
        open={grantAction !== null}
        onClose={() => {
          setGrantAction(null)
        }}
        title={dialogTitle}
        body={
          <Stack gap={3}>
            {dialogGrant === undefined ? null : (
              <Txt field="body" desk="body">
                {dialogSentence(dialogGrant)}
              </Txt>
            )}
            {dialogGrant === undefined ? null : (
              <Field label={t('o24.reason')}>{dialogGrant.reason}</Field>
            )}
            <Refusal
              of={[approveGrant, revokeGrant]}
              scope={grantId === null || grantAction === null ? null : `${grantId}:${grantAction}`}
              testID="settings-support-refusal"
            />
          </Stack>
        }
        confirmLabel={
          grantAction === 'approve' && dialogHours !== null
            ? t('o24.approveFor', { count: dialogHours })
            : dialogTitle
        }
        destructive={grantAction === 'refuse' || grantAction === 'revoke'}
        busy={approveGrant.status === 'pending' || revokeGrant.status === 'pending'}
        onConfirm={() => {
          if (grantId === null || grantAction === null) return
          const done = (): void => {
            setGrantAction(null)
            setGrantId(null)
          }
          if (grantAction === 'approve') {
            if (dialogHours === null) return
            void approveGrant.mutateAsync({ id: grantId, hours: dialogHours }).then(done, stayOpen)
          } else {
            void revokeGrant.mutateAsync(grantId).then(done, stayOpen)
          }
        }}
        testID="settings-support-dialog"
      />
    </Screen>
  )
}
