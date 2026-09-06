/**
 * O19 — claims on brands (docs/23 §1.1).
 *
 * Money the brand owes this distributor: scheme, damage, expiry, shortage. The register is the claim
 * book with its ageing beside it, because a claim that nobody chases is a claim that is never paid —
 * the overdue flag is the service's own, not a date this screen computed.
 */
import type { ClaimSummary } from '@dos/contracts'
import { useApi, useQuery } from '@dos/api-client/react'
import {
  BarLadder,
  Money,
  Register,
  Screen,
  Sheet,
  Stack,
  StatusChip,
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
  moneyColumn,
  textColumn,
} from '../../src/lib/ui'
import { longDate, today } from '../../src/lib/dates'

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

export default function Claims(): React.JSX.Element {
  const t = useStrings()
  const api = useApi()
  const [selected, setSelected] = useState<string | null>(null)

  const list = useQuery(['claims', 'list'], () => api.api.claims.list({ limit: 200 }))
  const ageing = useQuery(['claims', 'ageing'], () =>
    api.api.claims.ageing({ asOf: today(), groupBy: 'supplier', limit: 12 }),
  )
  const detail = useQuery(
    ['claims', 'get', selected ?? 'none'],
    () => api.api.claims.get({ id: selected ?? '' }),
    { enabled: selected !== null },
  )

  const rows = list.data?.items ?? []
  const claim = detail.data?.item

  const columns: readonly RegisterColumn<ClaimSummary>[] = [
    textColumn('no', t('o19.claimNo'), (row) => row.claimNo, { priority: 'identity' }),
    textColumn('supplier', t('o19.supplier'), (row) => row.supplierName ?? row.brandName),
    textColumn('kind', t('o19.kind'), (row) => row.kind),
    textColumn(
      'period',
      t('o19.period'),
      (row) => `${longDate(row.periodFrom)} – ${longDate(row.periodTo)}`,
    ),
    moneyColumn('claimed', t('o19.claimed'), (row) => row.claimedPaise),
    moneyColumn('settled', t('o19.settled'), (row) => row.settledPaise),
    moneyColumn('open', t('o19.outstanding'), (row) => row.outstandingPaise),
    {
      key: 'status',
      head: t('o19.status'),
      priority: 'chip',
      cell: (row) => (
        <StatusChip
          label={row.status}
          family={row.overdue ? 'brick' : (CLAIM_FAMILY[row.status] ?? 'neutral')}
          solid={row.overdue}
        />
      ),
    },
  ]

  return (
    <Screen title={t('o19.title')} chips={<PageTabs group="/money" active="/money/claims" />}>
      <Stack gap={6}>
        <Columns>
          <Half>
            <Panel title={t('o19.ageing')} testID="claims-ageing">
              <Async state={[ageing]} rows={5} empty={(ageing.data?.groups.length ?? 0) === 0}>
                <BarLadder
                  title={t('o19.outstanding')}
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
            <Panel title={t('o19.title')}>
              <Async state={[list]} rows={4}>
                <Stack gap={2}>
                  <Field label={t('o19.claimed')}>
                    <Money
                      value={rows.reduce((sum, row) => sum + row.claimedPaise, 0)}
                      size="moneyM"
                    />
                  </Field>
                  <Field label={t('o19.outstanding')}>
                    <Money
                      value={rows.reduce((sum, row) => sum + row.outstandingPaise, 0)}
                      size="cell"
                      tone="critical"
                    />
                  </Field>
                </Stack>
              </Async>
            </Panel>
          </Half>
        </Columns>

        <Async state={[list]} rows={10} empty={rows.length === 0} emptyMessage={t('o19.empty')}>
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
          />
        </Async>
      </Stack>

      <Sheet
        open={selected !== null}
        onClose={() => {
          setSelected(null)
        }}
        title={claim?.claimNo ?? undefined}
        testID="claim-panel"
      >
        <Async state={[detail]} rows={5}>
          {claim === undefined ? null : (
            <Stack gap={4}>
              <Field label={t('o19.supplier')}>
                {claim.supplierName ?? claim.brandName ?? '—'}
              </Field>
              <Field label={t('o19.kind')}>{claim.kind}</Field>
              <Field label={t('o19.period')}>
                {`${longDate(claim.periodFrom)} – ${longDate(claim.periodTo)}`}
              </Field>
              <Field label={t('o19.claimed')}>
                <Money value={claim.claimedPaise} size="moneyM" />
              </Field>
              <Field label={t('o19.settled')}>
                <Money value={claim.settledPaise} size="cell" tone="positive" />
              </Field>
              <Field label={t('o19.due')}>{longDate(claim.dueDate)}</Field>
              <Field label={t('o19.status')}>
                <StatusChip label={claim.status} family={CLAIM_FAMILY[claim.status] ?? 'neutral'} />
              </Field>
            </Stack>
          )}
        </Async>
      </Sheet>
    </Screen>
  )
}
