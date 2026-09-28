/**
 * The shop's distributors, one card each — what each is owed, its last bill, any van on the way, and
 * the button that opens another (docs/23 §6.1 R2, DOS-102, DOS-103).
 *
 * These cards WERE the top of the home screen. Since the founder's decision of 2026-09-28 the home is
 * a shop front and opens on items, so the cards moved here, unchanged in what they say: the home's
 * distributor chip opens them in a sheet, and "Me" lists them too. One login can buy from several
 * distributors on this platform (`ramesh.gupta` buys from three in the pilot data), and every read in
 * the app is for the one that is OPEN — so the open card names itself in words, never by colour alone,
 * and switching goes through `auth.switchTenant`, which mints a token for the other one. Never a merged
 * view (UX-01 R11): each card is its own distributor's.
 *
 * WHAT EVERY CARD SHOWS (DOS-102) comes from ONE call, `auth.memberships.summary`, on AUTH-SERVICE —
 * `api.auth`, never `api.api.auth` (retailer-service serves no auth route: that spelling 404s and left
 * a shop that owes lakhs reading ₹0.00, `dos-102-summary-service.guard.test.ts`). It reads each
 * distributor under this login's own membership, so nothing appears that a switch would not have
 * shown. No credit limit and no credit available: ADR 0006 keeps both off this app.
 */
import { useApi, useQuery, useSession } from '@dos/api-client/react'
import {
  Box,
  Button,
  Money,
  Pressable,
  Row,
  Sheet,
  Stack,
  StatusChip,
  TenantLogo,
  Txt,
  formatMoney,
  useColors,
  useStrings,
} from '@dos/ui'
import { links } from '@dos/ui/platform'
import { useState } from 'react'

import { absoluteUrl } from '../../../config'
import { acrossTotal } from './across'
import { instantWithClock, shortDate } from './dates'
import { rememberDistributor } from './last-distributor'
import { useMyShop } from './shop'
import { duesFamily } from './ui'

/**
 * The distributor that is open, as one chip (founder, 2026-09-28: the shop front opens on it). With
 * several distributors it is a button — "Change ▾" — that opens their cards in a sheet: what each is
 * owed, and the button that opens another. With one it is just the name, not a button.
 *
 * TWO PLACES, ONE CHIP. On a phone it sits in the shell's own header (`AppShell header`), so the first
 * screen of the shop front is not spent on an 86 px header that holds nothing but "⋯" above a second
 * row carrying the same name — measured at 390 × 844 by the retailer check of 2026-09-28, where that
 * pair and a tall last-order card pushed every "+ Add" below the fold. On a desk the rail head keeps
 * the shell's switcher and the home draws this chip at the top of the page. The sheet travels with the
 * chip, so both places open the same cards.
 */
export function DistributorChip({
  place,
  onSwitched,
}: {
  place: 'header' | 'page'
  /** Called once another distributor is open; the sheet has already closed itself. */
  onSwitched?: () => void
}): React.JSX.Element {
  const t = useStrings()
  const colors = useColors()
  const { session } = useSession()
  const [picking, setPicking] = useState(false)
  const name = session?.tenant.displayName ?? ''
  const logo = (
    <TenantLogo
      size="header"
      name={name}
      logoUrl={absoluteUrl('retailer', session?.tenant.logoUrl ?? null)}
      withName
    />
  )
  if ((session?.memberships.length ?? 0) <= 1) return <Box testID="r2-chip">{logo}</Box>
  const face = (
    <Row gap={3} justify="between" align="center">
      <Box grow>{logo}</Box>
      {/* A no-break space: "Change" and its caret never part across two lines. */}
      <Txt field="label" desk="label" color={colors.accent.fg} numberOfLines={1}>
        {`${t('r2.change')}\u00a0▾`}
      </Txt>
    </Row>
  )
  return (
    <>
      <Box {...(place === 'page' ? { maxWidth: 480 } : {})}>
        <Pressable
          onPress={() => {
            setPicking(true)
          }}
          label={t('r2.distributors')}
          testID="r2-chip"
        >
          {/*
            In the header the bar is already the chip's frame: no border of its own, so the
            distributor's name gets the width a border and its padding would take ("Sai
            Distributors, Dombivli" was cut after its first word at 390 px with one).
          */}
          {place === 'header' ? (
            face
          ) : (
            <Box border="all" borderTone="faint" radius="lg" padX={3} padY={2} background="surface">
              {face}
            </Box>
          )}
        </Pressable>
      </Box>
      <Sheet
        open={picking}
        onClose={() => {
          setPicking(false)
        }}
        title={t('r2.distributors')}
        testID="r2-picker"
      >
        <DistributorList
          onSwitched={() => {
            setPicking(false)
            onSwitched?.()
          }}
        />
      </Sheet>
    </>
  )
}

export function DistributorList({
  onSwitched,
}: {
  /** Called once another distributor is open (the sheet closes itself). */
  onSwitched?: () => void
}): React.JSX.Element {
  const t = useStrings()
  const api = useApi()
  const colors = useColors()
  const { session, switchDistributor } = useSession()
  const signedIn = session !== null
  const my = useMyShop()
  const retailerId = my.retailerId

  /*
   * The OPEN card prefers its own `receivables.outstanding.get` — the same figure the home's money
   * line and the Money page show, refreshed with them; the others read the summary.
   */
  const dues = useQuery(
    ['outstanding', retailerId],
    () =>
      api.api.receivables.outstanding.get({ retailerId: retailerId ?? '', includeBills: false }),
    { enabled: signedIn && retailerId !== null },
  )
  const across = useQuery(['memberships', 'summary'], () => api.auth.memberships.summary(), {
    enabled: signedIn,
    staleTime: 60_000,
  })
  const acrossBy = new Map((across.data?.items ?? []).map((item) => [item.tenantId, item]))
  /*
   * A SUMMARY THE DEVICE DID NOT READ IS NOT A MONEY FIGURE (`across.ts`, DOS-102): in flight and
   * refused each say so in words, and never come out as "You owe ₹0.00" under a green chip.
   */
  const total = acrossTotal(across)
  const acrossKnown = total.kind === 'known'

  /**
   * DOS-103: the office number, so the shop can call or WhatsApp the distributor it is looking at.
   * ABSENT means the owner has set none, and then there is no button at all — a Call button that
   * dials nothing is worse than no button.
   */
  const branding = useQuery(['tenancy', 'branding'], () => api.api.tenancy.branding.get(), {
    enabled: signedIn,
    staleTime: 300_000,
  })
  const officePhone = branding.data?.phone ?? null

  const [switching, setSwitching] = useState<string | null>(null)
  const memberships = session?.memberships ?? []
  const openTenantId = session?.tenant.id ?? ''

  return (
    <Stack gap={3} testID="r2-distributors">
      {memberships.length > 1 ? (
        <Txt field="label" desk="meta" color={colors.text.secondary} testID="r2-total">
          {total.kind === 'known'
            ? t('r2.owedAcross', {
                total: formatMoney(total.totalPaise),
                count: String(memberships.length),
              })
            : total.kind === 'reading'
              ? t('r2.owedAcrossReading', { count: String(memberships.length) })
              : t('r2.owedAcrossUnread', { count: String(memberships.length) })}
        </Txt>
      ) : (
        <Txt field="label" desk="meta" color={colors.text.secondary}>
          {t('r2.oneOnly')}
        </Txt>
      )}
      {memberships.map((membership) => {
        const open = membership.tenantId === openTenantId
        const card = acrossBy.get(membership.tenantId)
        // Either may be missing, and then there is no chip colour to claim.
        const figures = open ? dues.data : card
        return (
          <Box
            key={membership.tenantId}
            border="all"
            borderTone={open ? 'strong' : 'faint'}
            radius="md"
            pad={4}
            background={open ? 'raised' : 'surface'}
            testID={`r2-card-${membership.tenantSlug}`}
          >
            <Stack gap={3}>
              <TenantLogo
                size="card"
                name={membership.displayName}
                logoUrl={absoluteUrl('retailer', membership.logoUrl)}
                withName
                subtitle={open ? t('r2.openHere') : undefined}
              />
              <Row gap={3} wrap>
                <StatusChip
                  label={t('r2.owes')}
                  family={
                    figures === undefined
                      ? 'neutral'
                      : duesFamily(figures.overduePaise, figures.outstandingPaise)
                  }
                />
                <Money value={figures?.outstandingPaise ?? null} size="moneyM" />
              </Row>
              <Txt
                field="label"
                desk="meta"
                color={colors.text.secondary}
                testID={`r2-card-${membership.tenantSlug}-bills`}
              >
                {!acrossKnown
                  ? t('r2.cardUnread')
                  : card?.lastBill === undefined || card.lastBill === null
                    ? t('r2.noBillsYet')
                    : t('r2.cardLastBill', {
                        no: card.lastBill.invoiceNo ?? t('app.none'),
                        date: shortDate(card.lastBill.invoiceDate),
                        amount: formatMoney(card.lastBill.totalPaise),
                      })}
              </Txt>
              {card?.onTheWay === undefined || card.onTheWay === null ? null : (
                <Txt
                  field="label"
                  desk="meta"
                  color={colors.text.primary}
                  testID={`r2-card-${membership.tenantSlug}-coming`}
                >
                  {card.onTheWay.state === 'arrived'
                    ? t('r2.vanHere')
                    : card.onTheWay.etaAt !== null
                      ? t('r2.vanEta', { when: instantWithClock(card.onTheWay.etaAt) })
                      : t('r2.vanComing', { count: String(card.onTheWay.stops) })}
                </Txt>
              )}
              {/* DOS-103: only on the distributor that is OPEN — `tenancy.branding.get` is scoped by
                  the token, so the other cards' numbers are simply not known here. */}
              {open && officePhone !== null ? (
                <Row gap={3} wrap>
                  <Button
                    label={t('r2.call')}
                    variant="secondary"
                    onPress={() => {
                      void links.open(`tel:${dialable(officePhone)}`)
                    }}
                    testID={`r2-card-${membership.tenantSlug}-call`}
                  />
                  <Button
                    label={t('rt.whatsapp')}
                    variant="secondary"
                    onPress={() => {
                      void links.open(`https://wa.me/${digitsOnly(officePhone)}`)
                    }}
                    testID={`r2-card-${membership.tenantSlug}-whatsapp`}
                  />
                </Row>
              ) : null}
              {open ? null : (
                <Button
                  label={t('r2.switch')}
                  variant="secondary"
                  loading={switching === membership.tenantId}
                  onPress={() => {
                    setSwitching(membership.tenantId)
                    void switchDistributor(membership.tenantId)
                      .then((next) => {
                        rememberDistributor(next.tenant.id)
                        onSwitched?.()
                      })
                      .finally(() => {
                        setSwitching(null)
                      })
                  }}
                  testID={`r2-switch-${membership.tenantSlug}`}
                />
              )}
            </Stack>
          </Box>
        )
      })}
    </Stack>
  )
}

/**
 * DOS-103: the office number as a phone will accept it. The owner types whatever they like in
 * Settings ("0251 234 5678", "+91 251 234 5678"); a `tel:` URI wants digits and at most a leading
 * plus, and `wa.me` wants digits alone with the country code. A bare ten-digit Indian number gets
 * `91` in front — the shop and the distributor are in the same country, and a number that is already
 * international is left exactly as it is.
 */
export function digitsOnly(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  return digits.length === 10 ? `91${digits}` : digits
}

export function dialable(phone: string): string {
  return `+${digitsOnly(phone)}`
}
