/**
 * M17 — claims on brands (docs/23 §2.1).
 *
 * Money the BRAND owes this distributor: scheme, damage, expiry, shortage, rate difference. A claim
 * that nobody chases is a claim that is never paid, so the register carries the ageing beside it and
 * the overdue flag is the service's own — never a date this screen worked out.
 *
 * The claim's life, and the four buttons that move it:
 *   open a draft on a supplier for a period  →  BUILD its lines from the bills, credit notes, stock
 *   ledger and gate findings that already exist (nothing is typed)  →  SUBMIT, which allots the
 *   number and accrues the receivable  →  record the brand's SETTLEMENT when it pays.
 *
 * Writing off the unrecovered balance is owner + ACCOUNTANT (`claims.writeOff`), and the manager is
 * deliberately not in that tuple — so on this one screen the accountant has a button the manager
 * does not. `useCan` puts it where it belongs without either role carrying a special case.
 */
import type { ClaimSummary } from '@dos/contracts'
import { useApi, useMutation, useQuery } from '@dos/api-client/react'
import {
  BarLadder,
  Button,
  Dialog,
  ListRow,
  Money,
  Register,
  RupeeInput,
  Screen,
  Segments,
  Sheet,
  Stack,
  StatusChip,
  TextInput,
  Txt,
  useColors,
  useStrings,
  type RegisterColumn,
  type StatusFamily,
} from '@dos/ui'
import { useState } from 'react'

import {
  Async,
  Columns,
  Field,
  Half,
  PageTabs,
  Panel,
  Refusal,
  countText,
  moneyColumn,
  pageTotal,
  pagedCount,
  stayOpen,
  textColumn,
  useCan,
} from '../../src/lib/ui'
import { longDate, today } from '../../src/lib/dates'
import { useWord } from '../../src/lib/words'

const CLAIM_FAMILY: Readonly<Record<string, StatusFamily>> = {
  draft: 'neutral',
  submitted: 'ochre',
  acknowledged: 'ochre',
  partially_settled: 'clay',
  settled: 'moss',
  rejected: 'brick',
  written_off: 'neutral',
  cancelled: 'neutral',
}

type SettlementMode = 'credit_note' | 'bank_receipt' | 'cheque'

export default function Claims(): React.JSX.Element {
  const t = useStrings()
  const word = useWord()
  const colors = useColors()
  const api = useApi()
  const can = useCan()

  const mayWork = can('claims.build')
  const mayWriteOff = can('claims.writeOff')
  const [selected, setSelected] = useState<string | null>(null)
  const [acting, setActing] = useState<'build' | 'submit' | 'settle' | 'writeOff' | null>(null)
  const [note, setNote] = useState('')
  const [amount, setAmount] = useState<number | null>(null)
  const [mode, setMode] = useState<SettlementMode>('credit_note')

  const list = useQuery(['claims', 'list'], () => api.api.claims.list({ limit: 200 }))
  const ageing = useQuery(['claims', 'ageing'], () =>
    api.api.claims.ageing({ asOf: today(), groupBy: 'supplier', limit: 12 }),
  )
  const periods = useQuery(['claims', 'periods'], () => api.api.claims.periods.list({}))
  const detail = useQuery(
    ['claims', 'get', selected ?? 'none'],
    () => api.api.claims.get({ id: selected ?? '' }),
    { enabled: selected !== null },
  )
  const claim = detail.data?.item

  const build = useMutation(
    (id: string, meta) => api.api.claims.build({ id, idempotencyKey: meta.idempotencyKey }),
    { invalidates: [['claims']] },
  )
  const submit = useMutation(
    (id: string, meta) =>
      api.api.claims.submit({ id, submittedOn: today(), idempotencyKey: meta.idempotencyKey }),
    { invalidates: [['claims'], ['receivables']] },
  )
  const settle = useMutation(
    (input: { id: string; amountPaise: number; mode: SettlementMode; note: string }, meta) =>
      api.api.claims.settlements.record({
        id: input.id,
        settlementId: meta.id,
        idempotencyKey: meta.idempotencyKey,
        settledOn: today(),
        amountPaise: input.amountPaise,
        mode: input.mode,
        ...(input.note === '' ? {} : { note: input.note }),
      }),
    { invalidates: [['claims'], ['receivables'], ['reporting']] },
  )
  const writeOff = useMutation(
    (input: { id: string; note: string }, meta) =>
      api.api.claims.writeOff({
        id: input.id,
        reason: input.note,
        idempotencyKey: meta.idempotencyKey,
      }),
    { invalidates: [['claims'], ['receivables']] },
  )

  const rows = list.data?.items ?? []
  const page = pagedCount(list)

  const columns: readonly RegisterColumn<ClaimSummary>[] = [
    textColumn('no', t('m17.claimNo'), (row) => row.claimNo, { priority: 'identity' }),
    textColumn('supplier', t('m17.supplier'), (row) => row.supplierName ?? row.brandName),
    textColumn('kind', t('m17.kind'), (row) => word(row.kind)),
    textColumn(
      'period',
      t('m17.period'),
      (row) => `${longDate(row.periodFrom)} – ${longDate(row.periodTo)}`,
    ),
    moneyColumn('claimed', t('m17.claimed'), (row) => row.claimedPaise),
    moneyColumn('settled', t('m17.settled'), (row) => row.settledPaise),
    moneyColumn('open', t('m1.outstanding'), (row) => row.outstandingPaise),
    {
      key: 'status',
      head: t('m17.status'),
      priority: 'chip',
      cell: (row) => (
        <StatusChip
          label={word(row.status)}
          family={row.overdue ? 'brick' : (CLAIM_FAMILY[row.status] ?? 'neutral')}
          solid={row.overdue}
        />
      ),
    },
  ]

  const commit = (): void => {
    if (selected === null || acting === null) return
    const done = (): void => {
      setActing(null)
      setNote('')
      setAmount(null)
    }
    if (acting === 'build') void build.mutateAsync(selected).then(done, stayOpen)
    if (acting === 'submit') void submit.mutateAsync(selected).then(done, stayOpen)
    if (acting === 'settle' && amount !== null)
      void settle
        .mutateAsync({ id: selected, amountPaise: amount, mode, note: note.trim() })
        .then(done, stayOpen)
    if (acting === 'writeOff')
      void writeOff.mutateAsync({ id: selected, note: note.trim() }).then(done, stayOpen)
  }

  return (
    <Screen title={t('m17.title')} chips={<PageTabs group="/money" active="/money/claims" />}>
      <Stack gap={6}>
        <Columns>
          <Half>
            <Panel title={t('m17.ageing')} testID="claims-ageing">
              <Async state={[ageing]} rows={5} empty={(ageing.data?.groups.length ?? 0) === 0}>
                <BarLadder
                  title={t('m1.outstanding')}
                  rows={(ageing.data?.groups ?? []).slice(0, 8).map((group) => ({
                    // A rung's label column is narrow; a supplier's legal name is not.
                    label: group.name.length > 24 ? `${group.name.slice(0, 23)}…` : group.name,
                    value: group.outstandingPaise,
                    family: group.buckets.b90plus > 0 ? 'brick' : 'neutral',
                    solid: group.buckets.b90plus > 0,
                  }))}
                />
              </Async>
            </Panel>
          </Half>
          <Half>
            <Panel title={t('m17.periods')} testID="claims-periods">
              <Async
                state={[periods]}
                rows={4}
                empty={(periods.data?.items.length ?? 0) === 0}
                emptyMessage={t('m17.empty')}
              >
                <Stack gap={2}>
                  {/*
                   * A period that has ALREADY BEEN CLAIMED says so.
                   *
                   * `claims.periods.list` answers `existingClaimId` / `existingStatus`, and this
                   * panel — headed "What is due to be claimed" — dropped both: the pilot's own
                   * August scheme period, already claimed and already SETTLED, sat in the list
                   * looking exactly like the six periods nobody has claimed yet. Raising the same
                   * claim twice is a conversation with a brand nobody wants to have.
                   */}
                  {(periods.data?.items ?? []).slice(0, 8).map((row) => (
                    <ListRow
                      key={`${row.brandId ?? ''}-${row.periodFrom}-${row.kind}`}
                      primary={row.brandName ?? row.supplierName ?? word(row.kind)}
                      secondary={`${word(row.kind)} · ${longDate(row.periodFrom)} – ${longDate(row.periodTo)}`}
                      trailingMoney={row.estimatedClaimablePaise}
                      trailing={
                        row.existingClaimId === null ? undefined : (
                          <StatusChip
                            label={t('m17.alreadyClaimed', { state: word(row.existingStatus) })}
                            family="neutral"
                          />
                        )
                      }
                    />
                  ))}
                </Stack>
              </Async>
            </Panel>
          </Half>
        </Columns>

        <Async state={[list]} rows={10} empty={rows.length === 0} emptyMessage={t('m17.empty')}>
          <Register
            testID="claims-register"
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            frozen="no"
            selectedKey={selected}
            onSelect={(row) => {
              setSelected(row.id)
            }}
            state="ready"
            totals={{
              no: countText(page, t('app.none')),
              claimed: pageTotal(
                page,
                <Money
                  value={rows.reduce((sum, row) => sum + row.claimedPaise, 0)}
                  size="cell"
                  symbol={false}
                />,
              ),
              open: pageTotal(
                page,
                <Money
                  value={rows.reduce((sum, row) => sum + row.outstandingPaise, 0)}
                  size="cell"
                  symbol={false}
                />,
              ),
            }}
          />
        </Async>
      </Stack>

      <Sheet
        open={selected !== null}
        onClose={() => {
          setSelected(null)
        }}
        title={claim === undefined ? undefined : t('m17.detail', { no: claim.claimNo ?? '' })}
        testID="claim-panel"
      >
        <Async state={[detail]} rows={5}>
          {claim === undefined ? null : (
            <Stack gap={4}>
              <Field label={t('m17.supplier')}>
                {claim.supplierName ?? claim.brandName ?? t('app.none')}
              </Field>
              <Field label={t('m17.kind')}>{word(claim.kind)}</Field>
              <Field label={t('m17.period')}>
                {`${longDate(claim.periodFrom)} – ${longDate(claim.periodTo)}`}
              </Field>
              <Field label={t('m17.claimed')}>
                <Money value={claim.claimedPaise} size="moneyM" />
              </Field>
              <Field label={t('m17.settled')}>
                <Money value={claim.settledPaise} size="cell" tone="positive" />
              </Field>
              <Field label={t('m17.status')}>
                <StatusChip
                  label={word(claim.status)}
                  family={CLAIM_FAMILY[claim.status] ?? 'neutral'}
                />
              </Field>

              {mayWork ? (
                <Stack gap={3}>
                  <Button
                    label={t('m17.build')}
                    variant="secondary"
                    disabled={claim.status !== 'draft'}
                    disabledReason={t('m17.onlyDraft')}
                    onPress={() => {
                      setActing('build')
                    }}
                    testID="claim-build"
                  />
                  <Button
                    label={t('m17.submit')}
                    variant="primary"
                    disabled={claim.status !== 'draft'}
                    disabledReason={t('m17.onlyDraft')}
                    onPress={() => {
                      setActing('submit')
                    }}
                    testID="claim-submit"
                  />
                  <Button
                    label={t('m17.settlement')}
                    variant="secondary"
                    disabled={claim.status === 'draft' || claim.status === 'cancelled'}
                    disabledReason={t('m17.notSubmitted')}
                    onPress={() => {
                      setAmount(claim.outstandingPaise)
                      setActing('settle')
                    }}
                    testID="claim-settle"
                  />
                </Stack>
              ) : null}
              {mayWriteOff ? (
                <Button
                  label={t('m17.writeOff')}
                  variant="destructive"
                  disabled={claim.outstandingPaise === 0}
                  disabledReason={t('m17.nothingOpen')}
                  onPress={() => {
                    setActing('writeOff')
                  }}
                  testID="claim-writeoff"
                />
              ) : null}
            </Stack>
          )}
        </Async>
      </Sheet>

      <Dialog
        open={acting !== null}
        onClose={() => {
          setActing(null)
        }}
        title={
          acting === 'build'
            ? t('m17.build')
            : acting === 'submit'
              ? t('m17.submit')
              : acting === 'settle'
                ? t('m17.settlement')
                : t('m17.writeOff')
        }
        body={
          <Stack gap={3}>
            <Txt field="body" desk="body">
              {claim?.claimNo ?? claim?.supplierName ?? ''}
            </Txt>
            <Txt field="label" desk="meta" color={colors.text.secondary}>
              {acting === 'build'
                ? t('m17.buildBody')
                : acting === 'submit'
                  ? t('m17.submitBody')
                  : ''}
            </Txt>
            {acting === 'settle' ? (
              <>
                <Segments
                  testID="settlement-mode"
                  value={mode}
                  onChange={(id) => {
                    setMode(id as SettlementMode)
                  }}
                  items={[
                    { id: 'credit_note', label: word('credit_note') },
                    { id: 'bank_receipt', label: word('bank_receipt') },
                    { id: 'cheque', label: word('cheque') },
                  ]}
                />
                <RupeeInput
                  label={t('m17.settled')}
                  value={amount}
                  onChange={setAmount}
                  bound={claim?.outstandingPaise ?? null}
                  boundMessage={t('m17.recovery')}
                  testID="settlement-amount"
                />
              </>
            ) : null}
            {acting === 'settle' || acting === 'writeOff' ? (
              <TextInput
                label={t('app.note')}
                value={note}
                onChange={setNote}
                capitalize="sentences"
                testID="claim-note"
              />
            ) : null}
            <Refusal of={[build, submit, settle, writeOff]} testID="claim-refusal" />
          </Stack>
        }
        confirmLabel={
          acting === 'build'
            ? t('m17.build')
            : acting === 'submit'
              ? t('m17.submit')
              : acting === 'settle'
                ? t('m17.settlement')
                : t('m17.writeOff')
        }
        destructive={acting === 'writeOff'}
        busy={
          build.status === 'pending' ||
          submit.status === 'pending' ||
          settle.status === 'pending' ||
          writeOff.status === 'pending'
        }
        onConfirm={commit}
        testID="claim-dialog"
      />
    </Screen>
  )
}
