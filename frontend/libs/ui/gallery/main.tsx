/**
 * The living style guide. Every component of UX-00 section 6, in the states its contract names, at
 * both densities. A component is reviewed here against the design system before a screen uses it.
 */
import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'

import {
  AGEING_BUCKETS,
  space,
  type SizeName,
  type Series,
  type StatusFamily,
} from '../src/shared.js'
import {
  AgeingBuckets,
  Avatar,
  Button,
  Chips,
  CompareBars,
  ConnectionStrip,
  Dialog,
  EmptyState,
  ErrorState,
  Eyebrow,
  Group,
  KpiStrip,
  ListRow,
  Money,
  NumberPad,
  QtyStepper,
  Register,
  RupeeInput,
  Search,
  Segments,
  Sheet,
  Skeleton,
  Sparkline,
  StackedMix,
  StatusChip,
  Tabs,
  TenantLogo,
  TextInput,
  ThemeProvider,
  Toast,
  TrendChart,
  Txt,
} from '../src/web/index.js'

const DAYS = [
  '4 Aug',
  '5 Aug',
  '6 Aug',
  '7 Aug',
  '8 Aug',
  '9 Aug',
  '10 Aug',
  '11 Aug',
  '12 Aug',
  '13 Aug',
  '14 Aug',
  '15 Aug',
  '16 Aug',
  '17 Aug',
  '18 Aug',
  '19 Aug',
  '20 Aug',
  '21 Aug',
  '22 Aug',
  '23 Aug',
  '24 Aug',
  '25 Aug',
  '26 Aug',
  '27 Aug',
  '28 Aug',
  '29 Aug',
  '30 Aug',
  '31 Aug',
  '1 Sep',
  '2 Sep',
  '3 Sep',
]
const SALES = [
  1_42_000_00, 1_51_000_00, 1_38_000_00, 1_66_000_00, 1_72_000_00, 1_58_000_00, 1_44_000_00,
  1_61_000_00, 1_75_000_00, 1_69_000_00, 1_82_000_00, 1_55_000_00, 1_48_000_00, 1_71_000_00,
  1_88_000_00, 1_79_000_00, 1_64_000_00, 1_57_000_00, 1_92_000_00, 1_86_000_00, 1_73_000_00,
  1_68_000_00, 1_95_000_00, 2_04_000_00, 1_89_000_00, 1_77_000_00, 1_83_000_00, 1_96_000_00,
  2_11_000_00, 1_94_000_00, 1_84_200_00,
]

const salesSeries: Series = {
  id: 'sales',
  label: 'Sales',
  role: 'primary',
  points: DAYS.map((x, i) => ({ x, y: SALES[i] ?? 0 })),
}
const previousSeries: Series = {
  id: 'previous',
  label: 'Previous 30 days',
  role: 'previous',
  points: DAYS.map((x, i) => ({ x, y: Math.round((SALES[i] ?? 0) * 0.88) })),
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: space[8] }}>
      <Txt field="title" desk="pageTitle" as="h2" style={{ marginBottom: space[3] }}>
        {title}
      </Txt>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: space[6],
          alignItems: 'flex-start',
        }}
      >
        {children}
      </div>
    </section>
  )
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ minWidth: 240, maxWidth: 420 }}>
      <Eyebrow>{label}</Eyebrow>
      <div style={{ marginTop: space[2] }}>{children}</div>
    </div>
  )
}

interface Row {
  id: string
  order: string
  shop: string
  beat: string
  lines: number
  amount: number
  state: string
}

const ROWS: Row[] = [
  {
    id: '1',
    order: 'SO-1042',
    shop: 'Shree Ganesh Kirana',
    beat: 'Station Road',
    lines: 6,
    amount: 18_420_00,
    state: 'Submitted',
  },
  {
    id: '2',
    order: 'SO-1043',
    shop: 'Om Sai Provision',
    beat: 'Station Road',
    lines: 9,
    amount: 42_800_00,
    state: 'Needs approval',
  },
  {
    id: '3',
    order: 'SO-1044',
    shop: 'Mahalaxmi General',
    beat: 'Station Road',
    lines: 4,
    amount: 9_120_00,
    state: 'Submitted',
  },
]

function Gallery() {
  const [qty, setQty] = useState(48)
  const [cash, setCash] = useState<number | null>(null)
  const [pad, setPad] = useState<number | null>(null)
  const [text, setText] = useState('')
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState('pending')
  const [segment, setSegment] = useState('30')
  const [filters, setFilters] = useState<Record<string, boolean>>({ beat: true })
  const [sheet, setSheet] = useState(false)
  const [dialog, setDialog] = useState(false)
  const [toast, setToast] = useState(false)
  const [selected, setSelected] = useState<string | null>('2')

  return (
    <div style={{ padding: space[6], maxWidth: 1200, margin: '0 auto' }}>
      <Txt field="hero" desk="kpi" as="h1" style={{ marginBottom: space[2] }}>
        Distribution OS — design system
      </Txt>
      <Txt field="body" desk="body" as="p" style={{ marginBottom: space[8] }}>
        Layout A Ledger. Every component of UX-00 section 6, in the states its contract names.
      </Txt>

      <Section title="6.1 Button">
        <Cell label="VARIANTS">
          <div style={{ display: 'flex', gap: space[3], flexWrap: 'wrap' }}>
            <Button label="Place order" variant="primary" onPress={() => undefined} />
            <Button label="Add item" variant="secondary" onPress={() => undefined} />
            <Button label="Export" variant="ghost" onPress={() => undefined} />
            <Button label="Cancel invoice" variant="destructive" onPress={() => undefined} />
          </div>
        </Cell>
        <Cell label="STATES">
          <div
            style={{ display: 'flex', gap: space[3], flexWrap: 'wrap', alignItems: 'flex-start' }}
          >
            <Button
              label="Confirming 4 of 12"
              variant="primary"
              loading
              onPress={() => undefined}
            />
            <Button
              label="Confirm 14 lines"
              variant="primary"
              disabled
              disabledReason="8 lines not yet picked"
              onPress={() => undefined}
            />
            <Button label="Print" variant="secondary" shortcut="⌘P" onPress={() => undefined} />
          </div>
        </Cell>
        <Cell label="TOUCH FLOORS">
          <div style={{ display: 'grid', gap: space[3] }}>
            {(['desk', 'phone', 'field', 'floor'] as SizeName[]).map((s) => (
              <Button
                key={s}
                label={`${s} target`}
                variant="secondary"
                size={s}
                onPress={() => undefined}
              />
            ))}
          </div>
        </Cell>
      </Section>

      <Section title="6.2 TextInput · 6.5 Search">
        <Cell label="DEFAULT">
          <TextInput
            label="Shop name"
            value={text}
            onChange={setText}
            placeholder="Shree Ganesh Kirana"
          />
        </Cell>
        <Cell label="ERROR">
          <TextInput
            label="GSTIN"
            value="27AAXXX1234A1Z"
            onChange={() => undefined}
            error="15 characters. Check the last digit."
          />
        </Cell>
        <Cell label="DISABLED">
          <TextInput
            label="Invoice number"
            value="GL/1688"
            onChange={() => undefined}
            state="disabled"
          />
        </Cell>
        <Cell label="SEARCH · NO RESULTS">
          <Search
            value={query === '' ? 'campa zero' : query}
            onChange={setQuery}
            state="noResults"
            onAddNew={() => undefined}
          />
        </Cell>
      </Section>

      <Section title="6.3 Money · RupeeInput · NumberPad">
        <Cell label="SIZES">
          <div style={{ display: 'grid', gap: space[2] }}>
            <Money value={22_620_00} size="hero" />
            <Money value={18_420_00} size="moneyL" />
            <Money value={1_564_00} size="moneyM" />
            <Money value={2116} size="cell" />
            <Money value={null} />
          </div>
        </Cell>
        <Cell label="TONES">
          <div style={{ display: 'grid', gap: space[2] }}>
            <Money value={1_41_500_00} tone="positive" />
            <Money value={94_100_00} tone="critical" />
            <Money value={51_23_00_00} symbol={false} tone="secondary" />
          </div>
        </Cell>
        <Cell label="RUPEE INPUT">
          <RupeeInput
            label="Cash collected"
            value={cash}
            onChange={setCash}
            expected={22_620_00}
            expectedLabel="To collect"
            bound={22_620_00}
            boundMessage="Over the expected amount. The difference is a variance at settlement."
          />
        </Cell>
        <Cell label="NUMBER PAD">
          <div style={{ maxWidth: 320, border: '1px solid #D5D6CF', borderRadius: 8 }}>
            <NumberPad
              label="Gate count"
              mode="count"
              value={pad}
              onChange={setPad}
              onDone={() => undefined}
            />
          </div>
        </Cell>
      </Section>

      <Section title="6.4 QtyStepper">
        <Cell label="DEFAULT">
          <QtyStepper pieces={qty} caseSize={24} onChange={setQty} availablePieces={960} />
        </Cell>
        <Cell label="AT ZERO">
          <QtyStepper pieces={0} caseSize={24} onChange={() => undefined} availablePieces={960} />
        </Cell>
        <Cell label="OVER AVAILABLE">
          <QtyStepper pieces={500} caseSize={24} onChange={() => undefined} availablePieces={336} />
        </Cell>
        <Cell label="BLOCKED">
          <QtyStepper
            pieces={240}
            caseSize={24}
            onChange={() => undefined}
            blocked
            blockedReason="Over credit limit — needs Sunil's approval"
            schemeLabel="−₹68 · 1 free per 10"
          />
        </Cell>
      </Section>

      <Section title="6.6 Group · ListRow">
        <Cell label="ORDER LINES">
          <Group
            title="USUAL ORDER"
            footer={
              <Txt field="moneyM" desk="cellMoney" numeric>
                Schemes on this order −₹68
              </Txt>
            }
          >
            <ListRow
              primary="Campa Cola 750 ml"
              secondary="2 cs = 48 pc"
              trailingMoney={1_632_00}
              trailing={<StatusChip label="−₹68 · 1 free per 10" family="neutral" figure />}
            />
            <ListRow
              primary="Too Yumm Veggie Stix 70 g"
              secondary="1 cs = 24 pc"
              trailingMoney={349_00}
              trailing={<StatusChip label="Low · 4 cs" family="ochre" figure />}
            />
            <ListRow
              primary="MOM Roasted Makhana 60 g"
              secondary="Not ordered"
              trailingMoney={null}
              trailing={<StatusChip label="Out of stock" family="brick" solid />}
            />
          </Group>
        </Cell>
        <Cell label="ROW STATES">
          <Group>
            <ListRow
              primary="Selected"
              secondary="accent tint + 3 px bar"
              state="selected"
              onPress={() => undefined}
            />
            <ListRow primary="Waiting" secondary="ochre clock" state="waiting" />
            <ListRow
              primary="Needs attention"
              secondary="Shree Ganesh Kirana"
              state="needsAttention"
              reason="Rejected — over credit limit"
            />
            <ListRow primary="Disabled" secondary="not tappable" state="disabled" />
          </Group>
        </Cell>
      </Section>

      <Section title="6.7 Register">
        <div style={{ width: '100%' }}>
          <Register<Row>
            columns={[
              { key: 'order', head: 'Order', cell: (r) => r.order, priority: 'identity' },
              { key: 'shop', head: 'Shop', cell: (r) => r.shop },
              { key: 'beat', head: 'Beat', cell: (r) => r.beat },
              { key: 'lines', head: 'Lines', align: 'right', cell: (r) => r.lines },
              {
                key: 'amount',
                head: 'Amount ₹',
                align: 'right',
                cell: (r) => <Money value={r.amount} size="cell" symbol={false} />,
                priority: 'value',
              },
              {
                key: 'state',
                head: 'State',
                cell: (r) => (
                  <StatusChip
                    label={r.state}
                    family={r.state === 'Needs approval' ? 'ochre' : 'neutral'}
                  />
                ),
                priority: 'chip',
              },
            ]}
            rows={ROWS}
            rowKey={(r) => r.id}
            frozen="order"
            selectedKey={selected}
            onSelect={(r) => setSelected(r.id)}
            filters={[{ id: 'beat', label: 'Beat: Station Road' }]}
            onClearFilters={() => undefined}
            totals={{
              order: 'Total',
              lines: 19,
              amount: <Money value={70_340_00} size="cell" symbol={false} />,
            }}
          />
        </div>
      </Section>

      <Section title="6.8 KpiStrip · BarLadder">
        <div style={{ width: '100%' }}>
          <KpiStrip
            items={[
              {
                label: 'SALES',
                value: <Money value={1_84_200_00} size="hero" />,
                delta: '▲ 12% vs last Thu',
                tone: 'positive',
                spark: SALES.slice(-12),
              },
              {
                label: 'COLLECTED',
                value: <Money value={1_41_500_00} size="hero" />,
                delta: '2 trips active',
              },
              {
                label: 'OUTSTANDING',
                value: <Money value={8_62_400_00} size="hero" />,
                delta: '₹94,100 overdue',
                tone: 'critical',
              },
              {
                label: 'FILL RATE',
                value: (
                  <Txt field="hero" desk="kpi" numeric>
                    96.2%
                  </Txt>
                ),
                delta: '4 short lines',
              },
            ]}
          />
        </div>
        <Cell label="AGEING LADDER">
          <AgeingBuckets
            buckets={{
              '0-7': 5_12_300_00,
              '8-15': 2_56_000_00,
              '16-30': 94_100_00,
              '31-60': 42_000_00,
              '61-90': 12_000_00,
              '90+': 0,
            }}
          />
        </Cell>
      </Section>

      <Section title="6.9 StatusChip">
        <Cell label="WORD ONLY">
          <div style={{ display: 'flex', gap: space[2], flexWrap: 'wrap' }}>
            {(['moss', 'ochre', 'clay', 'brick', 'neutral'] as StatusFamily[]).map((family) => (
              <StatusChip key={family} label={family} family={family} />
            ))}
          </div>
        </Cell>
        <Cell label="SOLID (THE THREE LOUD STATES)">
          <div style={{ display: 'flex', gap: space[2], flexWrap: 'wrap' }}>
            <StatusChip label="Out of stock" family="brick" solid />
            <StatusChip label="Overdue · 14 days" family="brick" solid figure />
            <StatusChip label="Failed" family="brick" solid />
          </div>
        </Cell>
        <Cell label="CARRYING A FIGURE">
          <div style={{ display: 'flex', gap: space[2], flexWrap: 'wrap' }}>
            <StatusChip label="Owes ₹18,400" family="brick" figure />
            <StatusChip label="Limit ₹26,800" family="neutral" figure />
            <StatusChip label="Only 14 cs available" family="ochre" figure />
          </div>
        </Cell>
      </Section>

      <Section title="6.10 Tabs · Chips · Segments">
        <Cell label="TABS">
          <Tabs
            items={[
              { id: 'pending', label: 'Pending', count: 4 },
              { id: 'confirmed', label: 'Confirmed', count: 24 },
              { id: 'packed', label: 'Packed', count: 11 },
            ]}
            value={tab}
            onChange={setTab}
          />
        </Cell>
        <Cell label="FILTER CHIPS">
          <Chips
            items={[
              { id: 'beat', label: 'Station Road', selected: filters['beat'] },
              { id: 'rep', label: 'Rahul', selected: filters['rep'] },
              { id: 'today', label: 'Today', selected: filters['today'] },
            ]}
            size="desk"
            onToggle={(id) => setFilters((f) => ({ ...f, [id]: !f[id] }))}
            onClear={() => setFilters({})}
          />
        </Cell>
        <Cell label="SEGMENTS">
          <Segments
            items={[
              { id: '30', label: '30 d' },
              { id: '90', label: '90 d' },
              { id: 'fy', label: 'FY' },
            ]}
            value={segment}
            onChange={setSegment}
          />
        </Cell>
      </Section>

      <Section title="6.11 ConnectionStrip">
        <Cell label="SYNCED">
          <ConnectionStrip state={{ online: true, lastSyncedAt: Date.now() - 120_000 }} />
        </Cell>
        <Cell label="WAITING">
          <ConnectionStrip
            state={{ online: true, pendingWrites: 3, lastSyncedAt: Date.now() - 60_000 }}
            onOpenQueue={() => undefined}
          />
        </Cell>
        <Cell label="OFFLINE">
          <ConnectionStrip state={{ online: false, lastSyncedAt: Date.now() - 5_400_000 }} />
        </Cell>
        <Cell label="NEEDS ATTENTION">
          <ConnectionStrip
            state={{ online: true, needsAttention: 2, lastSyncedAt: Date.now() }}
            onOpenQueue={() => undefined}
          />
        </Cell>
      </Section>

      <Section title="6.12 Sheet · Dialog · Toast">
        <Cell label="OPEN THEM">
          <div style={{ display: 'flex', gap: space[3], flexWrap: 'wrap' }}>
            <Button label="Open sheet" variant="secondary" onPress={() => setSheet(true)} />
            <Button label="Issue invoice" variant="primary" onPress={() => setDialog(true)} />
            <Button label="Show toast" variant="ghost" onPress={() => setToast(true)} />
          </div>
        </Cell>
      </Section>

      <Section title="6.13 Avatar · TenantLogo · Empty · Error · Skeleton">
        <Cell label="IDENTITY">
          <div style={{ display: 'flex', gap: space[4], alignItems: 'center' }}>
            <Avatar name="Sunil Tarsun" />
            <TenantLogo size="rail" withName subtitle="Kalyan · FY 2026-27" />
          </div>
        </Cell>
        <Cell label="EMPTY">
          <EmptyState
            message="No stops left"
            actionLabel="Close the trip"
            onAction={() => undefined}
          />
        </Cell>
        <Cell label="ERROR">
          <ErrorState
            message="Stock could not be read. Your last figures are from 9:40 am."
            detail="reporting.stock.list · 503"
            actionLabel="Try again"
            onAction={() => undefined}
          />
        </Cell>
        <Cell label="SKELETON">
          <Skeleton rows={3} rowHeight={32} />
        </Cell>
      </Section>

      <Section title="6.14 Charts">
        <div style={{ width: '100%', display: 'grid', gap: space[6] }}>
          <div>
            <Eyebrow>SALES · THIS 30 DAYS VS PREVIOUS</Eyebrow>
            <TrendChart
              series={[salesSeries, previousSeries]}
              legend
              range="4 Aug — 3 Sep"
              asOf="6:10 pm"
            />
          </div>
          <div>
            <Eyebrow>MONTH BY MONTH · FY 2026-27 VS 2025-26</Eyebrow>
            <CompareBars
              groups={[
                { label: 'Apr', current: 41_00_000_00, previous: 36_00_000_00 },
                { label: 'May', current: 44_00_000_00, previous: 39_00_000_00 },
                { label: 'Jun', current: 39_00_000_00, previous: 37_00_000_00 },
                { label: 'Jul', current: 47_00_000_00, previous: 41_00_000_00 },
                { label: 'Aug', current: 52_00_000_00, previous: 44_00_000_00 },
                { label: 'Sep', current: 18_00_000_00, previous: 16_00_000_00 },
              ]}
              range="Apr — Sep"
            />
          </div>
          <div>
            <Eyebrow>BRAND MIX · THIS MONTH</Eyebrow>
            <StackedMix
              slices={[
                { label: 'Too Yumm', value: 9_36_000_00 },
                { label: 'Campa', value: 5_58_000_00 },
                { label: 'MOM', value: 2_16_000_00 },
                { label: 'Balaji', value: 60_000_00 },
                { label: 'Masti Oye', value: 30_000_00 },
              ]}
            />
          </div>
          <div>
            <Eyebrow>SPARKLINE</Eyebrow>
            <div style={{ marginTop: space[2] }}>
              <Sparkline values={SALES.slice(-12)} />
            </div>
          </div>
        </div>
      </Section>

      <Sheet open={sheet} onClose={() => setSheet(false)} title="Bargain request">
        <Txt field="body" desk="body" as="p">
          Rahul asked ₹1.50/pc under the floor on Campa Cola 750 ml for Shree Ganesh Kirana.
        </Txt>
      </Sheet>
      <Dialog
        open={dialog}
        onClose={() => setDialog(false)}
        title="Issue invoice"
        body="Invoice GL/1688 · ₹18,420 · stock leaves Kalyan godown. This cannot be undone; a correction is a credit note."
        confirmLabel="Issue invoice"
        onConfirm={() => setDialog(false)}
      />
      <Toast
        open={toast}
        message="Line removed"
        actionLabel="Undo"
        onAction={() => setToast(false)}
        onDismiss={() => setToast(false)}
      />
      <Txt field="label" desk="meta" as="p" style={{ marginTop: space[10] }}>
        Ageing rungs, in order: {AGEING_BUCKETS.join(' · ')}
      </Txt>
    </div>
  )
}

const root = document.getElementById('root')
if (root) {
  createRoot(root).render(
    <StrictMode>
      <ThemeProvider
        touch="desk"
        density="desk"
        tenant={{ name: 'Tarsun Enterprises', logoUrl: null }}
      >
        <Gallery />
      </ThemeProvider>
    </StrictMode>,
  )
}
