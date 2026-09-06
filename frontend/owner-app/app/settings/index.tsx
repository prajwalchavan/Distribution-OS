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
import { useWord } from '../../src/lib/words'

type View = 'business' | 'numbering' | 'flags' | 'support'

/** `delivery.pod_required` as `tenant-bootstrap.ts` documents it: when a photo or signature is a must. */
const POD_POLICIES = ['always', 'credit_only', 'never'] as const

export default function Settings(): React.JSX.Element {
  const t = useStrings()
  const word = useWord()
  const colors = useColors()
  const api = useApi()
  const { session } = useSession()
  const [view, setView] = useState<View>('business')
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [logoNote, setLogoNote] = useState<string | null>(null)
  const [grantId, setGrantId] = useState<string | null>(null)
  const [grantAction, setGrantAction] = useState<'approve' | 'revoke' | null>(null)

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
  const approveGrant = useMutation(
    (id: string, meta) =>
      api.api.tenancy.support.approve({ id, idempotencyKey: meta.idempotencyKey, hours: 4 }),
    { invalidates: [['tenancy', 'support']] },
  )
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
    textColumn('mode', t('o8.trigger'), (row) => row.allocationMode),
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
    textColumn('flag', t('o24.flag'), (row) => row.flag, { priority: 'identity' }),
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

  const grantColumns: readonly RegisterColumn<SupportGrant>[] = [
    textColumn('who', t('o7.person'), (row) => row.requestedByName, { priority: 'identity' }),
    textColumn('scope', t('o24.supportWindow'), (row) => row.scope),
    textColumn('reason', t('o3.note'), (row) => row.reason),
    textColumn('asked', t('o3.asked'), (row) => instantWithClock(row.requestedAt)),
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
    {
      key: 'action',
      head: t('o3.decide'),
      cell: (row) =>
        row.status === 'requested' ? (
          <Button
            label={t('o24.approveSupport')}
            variant="ghost"
            onPress={() => {
              setGrantId(row.id)
              setGrantAction('approve')
            }}
          />
        ) : row.active ? (
          <Button
            label={t('o24.revokeSupport')}
            variant="ghost"
            onPress={() => {
              setGrantId(row.id)
              setGrantAction('revoke')
            }}
          />
        ) : (
          <Txt field="body" desk="cell">
            {instantWithClock(row.expiresAt)}
          </Txt>
        ),
    },
  ]

  return (
    <Screen
      title={t('o24.title')}
      chips={<PageTabs group="/settings" active="/settings" />}
      actions={
        <>
          <Segments
            value={view}
            onChange={(id) => {
              setView(id as View)
            }}
            items={[
              { id: 'business', label: t('o24.business') },
              { id: 'numbering', label: t('o24.numbering') },
              { id: 'flags', label: t('o24.flags') },
              { id: 'support', label: t('o24.support') },
            ]}
            testID="settings-view"
          />
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
        <Async state={[grants]} rows={5} empty={(grants.data?.items.length ?? 0) === 0}>
          <Register
            testID="settings-support"
            columns={grantColumns}
            rows={grants.data?.items ?? []}
            rowKey={(row) => row.id}
            frozen="who"
            state="ready"
          />
        </Async>
      ) : null}

      <Dialog
        open={grantAction !== null}
        onClose={() => {
          setGrantAction(null)
        }}
        title={grantAction === 'approve' ? t('o24.approveSupport') : t('o24.revokeSupport')}
        body={
          <Txt field="body" desk="body">
            {t('o24.supportWindow')}
          </Txt>
        }
        confirmLabel={grantAction === 'approve' ? t('o24.approveSupport') : t('o24.revokeSupport')}
        destructive={grantAction === 'revoke'}
        busy={approveGrant.status === 'pending' || revokeGrant.status === 'pending'}
        onConfirm={() => {
          if (grantId === null) return
          const done = (): void => {
            setGrantAction(null)
            setGrantId(null)
          }
          if (grantAction === 'approve') void approveGrant.mutateAsync(grantId).then(done, done)
          else void revokeGrant.mutateAsync(grantId).then(done, done)
        }}
        testID="settings-support-dialog"
      />
    </Screen>
  )
}
