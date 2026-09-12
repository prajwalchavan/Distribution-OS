/**
 * R13 — the money this shop has paid, and the receipt for each of it (docs/23 §6.1 R13).
 *
 * `receivables.receipts.list` for the retailer role answers only this shop's rows and the totals
 * block with them. The printed receipt is `receipts.document` — the server's own PDF, white-labelled
 * from the distributor's branding — and while the worker is still rendering it the screen says so
 * rather than offering a button that would open nothing.
 *
 * A receipt that has been REVERSED or has BOUNCED still appears, with its own word: money a shop
 * thought it had paid and that came back is exactly what it must be able to see.
 */
import { useApi, useQuery, useSession } from '@dos/api-client/react'
import {
  Button,
  Group,
  KpiStrip,
  ListRow,
  Money,
  Screen,
  Sheet,
  Stack,
  StatusChip,
  Txt,
  useColors,
  useStrings,
} from '@dos/ui'
import { documents } from '@dos/ui/platform'
import { useState } from 'react'

import { absoluteUrl } from '../src/config'
import { instantWithClock } from '../src/lib/dates'
import { useMyShop } from '../src/lib/shop'
import { Async, Field, PageTabs, Panel } from '../src/lib/ui'
import { useWord } from '../src/lib/words'

export default function Receipts(): React.JSX.Element {
  const t = useStrings()
  const word = useWord()
  const api = useApi()
  const colors = useColors()
  const { session } = useSession()
  const signedIn = session !== null
  const distributor = session?.tenant.displayName ?? ''
  const my = useMyShop()
  const [openId, setOpenId] = useState<string | null>(null)

  const receipts = useQuery(
    ['receipts', my.retailerId, 'page'],
    () => api.api.receivables.receipts.list({ retailerId: my.retailerId ?? '', limit: 50 }),
    { enabled: signedIn && my.retailerId !== null },
  )
  const document = useQuery(
    ['receipt-document', openId],
    () => api.api.receivables.receipts.document({ id: openId ?? '', format: 'a5' }),
    { enabled: signedIn && openId !== null },
  )

  const rows = receipts.data?.items ?? []
  const open = rows.find((row) => row.id === openId)
  // Service-relative on the local storage driver; the platform needs the service's origin on it.
  const url = absoluteUrl(document.data?.url)

  return (
    <Screen title={t('r13.title')} context={distributor} testID="r13-screen">
      <Stack gap={5}>
        <PageTabs group="/dues" active="/receipts" />
        <Async
          state={[my, receipts]}
          rows={5}
          empty={rows.length === 0}
          emptyMessage={t('r13.none')}
        >
          <Stack gap={5}>
            <KpiStrip
              testID="r13-kpis"
              items={[
                {
                  label: t('r13.total'),
                  value: <Money value={receipts.data?.totals.countedPaise ?? null} size="cell" />,
                },
                {
                  label: t('r13.unallocated'),
                  value: (
                    <Money value={receipts.data?.totals.unallocatedPaise ?? null} size="cell" />
                  ),
                },
              ]}
            />
            <Panel testID="r13-list">
              <Group>
                {rows.map((receipt) => (
                  <ListRow
                    key={receipt.id}
                    primary={t('r13.no', { no: receipt.receiptNo ?? '—' })}
                    secondary={`${t('r13.mode', { mode: word(receipt.mode) })} · ${t('r13.on', {
                      when: instantWithClock(receipt.receivedAt),
                    })}`}
                    trailingMoney={receipt.amountPaise}
                    trailing={<StatusChip label={word(receipt.status)} family="neutral" />}
                    onPress={() => {
                      setOpenId(receipt.id)
                    }}
                    testID={`r13-row-${receipt.id}`}
                  />
                ))}
              </Group>
            </Panel>
          </Stack>
        </Async>
      </Stack>

      <Sheet
        open={openId !== null}
        onClose={() => {
          setOpenId(null)
        }}
        title={t('r13.no', { no: open?.receiptNo ?? '—' })}
        testID="r13-sheet"
      >
        <Stack gap={4}>
          <Money value={open?.amountPaise ?? null} size="hero" />
          <Field label={t('r13.allocated')}>
            <Money value={open?.allocatedPaise ?? null} size="cell" />
          </Field>
          {(open?.unallocatedPaise ?? 0) > 0 ? (
            <Field label={t('r13.unallocated')}>
              <Money value={open?.unallocatedPaise ?? null} size="cell" />
            </Field>
          ) : null}
          {(open?.cashDiscountPaise ?? 0) > 0 ? (
            <Field label={t('r13.cashDiscount')}>
              <Money value={open?.cashDiscountPaise ?? null} size="cell" />
            </Field>
          ) : null}
          <Async state={[document]} rows={1}>
            {url === null ? (
              <Txt field="body" desk="body" color={colors.text.secondary} testID="r13-pending">
                {t('r13.pending', { name: distributor })}
              </Txt>
            ) : (
              <Button
                label={t('r13.open')}
                variant="primary"
                onPress={() => {
                  void documents.open(url, { filename: `${open?.receiptNo ?? 'receipt'}.pdf` })
                }}
                fullWidth
                testID="r13-open"
              />
            )}
          </Async>
        </Stack>
      </Sheet>
    </Screen>
  )
}
