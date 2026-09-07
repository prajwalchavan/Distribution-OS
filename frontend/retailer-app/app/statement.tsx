/**
 * R6 — the statement of account (docs/23 §6.1 R6): every bill, payment and credit note in a window,
 * with the running balance the distributor's own books carry.
 *
 * `receivables.ledger.get` for the retailer role is BUILT FROM DOCUMENTS, not from the journal — a
 * shop reads its own bills and receipts, never the distributor's chart of accounts. The opening and
 * closing balances come with the page; nothing here adds a column up.
 *
 * WHY THIS IS NOT A `<Register>`. This app's density is `field` (UX-00 §5.2), and a field register
 * renders as ROWS and keeps only the `identity`, `value` and `chip` columns — `detail` columns are
 * dropped by design. Measured here at 1440 px: the statement came out as a date and a balance, with
 * "what" (bill or payment), the document number, and the billed and paid amounts all gone. A
 * statement without those is not a statement, so the entry draws itself: what it was, its number,
 * its amount, and the balance after it.
 */
import { useApi, useQuery, useSession } from '@dos/api-client/react'
import { Money, Row, Screen, Segments, Stack, Txt, useColors, useStrings } from '@dos/ui'
import { useState } from 'react'

import { longDate, rangeOf, type RangeId } from '../src/lib/dates'
import { useMyShop } from '../src/lib/shop'
import { Async, PageTabs, Panel } from '../src/lib/ui'
import { useWord } from '../src/lib/words'

export default function Statement(): React.JSX.Element {
  const t = useStrings()
  const word = useWord()
  const api = useApi()
  const colors = useColors()
  const { session } = useSession()
  const signedIn = session !== null
  const my = useMyShop()
  const retailerId = my.retailerId
  const [rangeId, setRangeId] = useState<RangeId>('d90')
  const range = rangeOf(rangeId)

  const ledger = useQuery(
    ['ledger', retailerId, rangeId],
    () =>
      api.api.receivables.ledger.get({
        retailerId: retailerId ?? '',
        from: range.from,
        to: range.to,
      }),
    { enabled: signedIn && retailerId !== null },
  )
  const rows = ledger.data?.items ?? []

  return (
    <Screen title={t('r6.title')} context={session?.tenant.displayName} testID="r6-screen">
      <Stack gap={5}>
        <PageTabs group="/dues" active="/statement" />
        <Segments
          testID="r6-range"
          items={[
            { id: 'd30', label: t('r6.d30') },
            { id: 'd90', label: t('r6.d90') },
            { id: 'fy', label: t('r6.fy') },
          ]}
          value={rangeId}
          onChange={(id) => {
            setRangeId(id as RangeId)
          }}
        />

        <Panel testID="r6-opening">
          <Row justify="between" align="center" gap={4}>
            <Txt field="body" desk="body" color={colors.text.secondary}>
              {t('r6.opening')}
            </Txt>
            <Money value={ledger.data?.openingPaise ?? null} size="moneyM" />
          </Row>
        </Panel>

        <Panel
          title={t('r6.rows')}
          meta={`${longDate(range.from)} — ${longDate(range.to)}`}
          testID="r6-panel"
        >
          <Async
            state={[my, ledger]}
            rows={6}
            empty={rows.length === 0}
            emptyMessage={t('r6.none')}
          >
            <Stack gap={1}>
              {rows.map((row) => (
                <Stack
                  key={`${row.kind}-${row.refId}`}
                  gap={2}
                  padY={3}
                  border="bottom"
                  borderTone="faint"
                  testID={`r6-row-${row.refId}`}
                >
                  <Row justify="between" align="start" gap={3}>
                    <Stack gap={1} grow>
                      <Txt field="bodyStrong" desk="cell" numberOfLines={1}>
                        {row.refNo ?? word(row.kind)}
                      </Txt>
                      <Txt field="label" desk="meta" color={colors.text.secondary}>
                        {`${word(row.kind)} · ${longDate(row.date)}`}
                      </Txt>
                    </Stack>
                    <Stack gap={1} align="end">
                      {row.debitPaise > 0 ? (
                        <Row gap={2} align="center">
                          <Txt field="label" desk="meta" color={colors.text.secondary}>
                            {t('r6.debit')}
                          </Txt>
                          <Money value={row.debitPaise} size="moneyM" />
                        </Row>
                      ) : null}
                      {row.creditPaise > 0 ? (
                        <Row gap={2} align="center">
                          <Txt field="label" desk="meta" color={colors.text.secondary}>
                            {t('r6.credit')}
                          </Txt>
                          <Money value={row.creditPaise} size="moneyM" tone="positive" />
                        </Row>
                      ) : null}
                      <Row gap={2} align="center">
                        <Txt field="label" desk="meta" color={colors.text.secondary}>
                          {t('r6.balance')}
                        </Txt>
                        <Money
                          value={row.balancePaise}
                          size="cell"
                          tone={row.balancePaise > 0 ? 'critical' : 'positive'}
                        />
                      </Row>
                    </Stack>
                  </Row>
                </Stack>
              ))}
            </Stack>
          </Async>
        </Panel>

        <Panel testID="r6-closing">
          <Stack gap={2}>
            <Row justify="between" align="center" gap={4}>
              <Txt field="bodyStrong" desk="body">
                {t('r6.closing')}
              </Txt>
              <Money value={ledger.data?.closingPaise ?? null} size="moneyL" />
            </Row>
            <Txt field="label" desk="meta" color={colors.text.secondary}>
              {t('r6.explain')}
            </Txt>
          </Stack>
        </Panel>
      </Stack>
    </Screen>
  )
}
