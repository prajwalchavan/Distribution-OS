/**
 * R11 — the shop edits its own details (docs/23 §6.1 R11).
 *
 * `retailers.updateOwn` is SHOPKEEPER_ONLY and touches exactly six fields: owner name, alternate
 * phone, address, GSTIN and GST registration type. Everything else on the row belongs to the
 * distributor — the shop's NAME of record, its beat, its tier, its credit limit, its payment terms —
 * and this screen shows those as facts with a line saying who to ask, rather than as inputs that
 * would be refused. A form field the server will not accept is a promise the app cannot keep.
 *
 * The GSTIN is validated on the device with the DOMAIN's own checksum (`isValidGstin` in
 * `@dos/domain`), the same function the contract's `GstinSchema` uses, so a typo is caught under the
 * thumb instead of coming back as a 400.
 */
import { useApi, useMutation, useQuery, useSession } from '@dos/api-client/react'
import {
  Button,
  Screen,
  Segments,
  Stack,
  StatusChip,
  TextInput,
  Toast,
  Txt,
  useColors,
  useStrings,
} from '@dos/ui'
import { isValidGstin } from '@dos/domain'
import { useEffect, useState } from 'react'

import { useMyShop } from '../src/lib/shop'
import { Async, Field, Panel } from '../src/lib/ui'
import { useWord } from '../src/lib/words'

type GstType = 'unregistered' | 'regular' | 'composition'

export default function MyShopScreen(): React.JSX.Element {
  const t = useStrings()
  const word = useWord()
  const api = useApi()
  const colors = useColors()
  const { session } = useSession()
  const distributor = session?.tenant.displayName ?? ''
  const my = useMyShop()
  const shop = my.shop

  const [ownerName, setOwnerName] = useState('')
  const [altPhone, setAltPhone] = useState('')
  const [line1, setLine1] = useState('')
  const [area, setArea] = useState('')
  const [city, setCity] = useState('')
  const [pincode, setPincode] = useState('')
  const [landmark, setLandmark] = useState('')
  const [gstin, setGstin] = useState('')
  const [gstType, setGstType] = useState<GstType>('unregistered')
  const [loaded, setLoaded] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  /** Seed the form once from the server's row; after that the person typing owns the fields. */
  useEffect(() => {
    if (loaded || shop === null) return
    const address = (shop.address ?? {}) as Record<string, unknown>
    const read = (key: string): string => (typeof address[key] === 'string' ? address[key] : '')
    setOwnerName(shop.ownerName ?? '')
    setAltPhone(shop.altPhone ?? '')
    setLine1(read('line1'))
    setArea(read('area'))
    setCity(read('city'))
    setPincode(read('pincode'))
    setLandmark(read('landmark'))
    setGstin(shop.gstin ?? '')
    setGstType(shop.gstRegType)
    setLoaded(true)
  }, [shop, loaded])

  const save = useMutation(
    (input: { id: string }, meta) =>
      api.api.retailers.updateOwn({
        id: input.id,
        idempotencyKey: meta.idempotencyKey,
        ownerName: ownerName.trim() === '' ? null : ownerName.trim(),
        altPhone: altPhone.trim() === '' ? null : altPhone.trim(),
        gstin: gstin.trim() === '' ? null : gstin.trim().toUpperCase(),
        gstRegType: gstType,
        address: {
          ...(line1.trim() === '' ? {} : { line1: line1.trim() }),
          ...(area.trim() === '' ? {} : { area: area.trim() }),
          ...(city.trim() === '' ? {} : { city: city.trim() }),
          ...(pincode.trim() === '' ? {} : { pincode: pincode.trim() }),
          ...(landmark.trim() === '' ? {} : { landmark: landmark.trim() }),
        },
      }),
    { invalidates: [['my-shop']] },
  )

  const gstinTyped = gstin.trim().toUpperCase()
  const gstinBad = gstinTyped !== '' && !isValidGstin(gstinTyped)

  // `retailers.get` is asked for nothing extra here: `useMyShop` already holds the public row.
  const me = useQuery(['tenancy', 'me'], () => api.api.tenancy.me(), { enabled: session !== null })

  return (
    <Screen
      title={t('r11.title')}
      context={distributor}
      testID="r11-screen"
      bottomBar={
        <Button
          label={t('r11.save')}
          variant="primary"
          loading={save.status === 'pending'}
          disabled={shop === null || gstinBad}
          {...(gstinBad ? { disabledReason: t('r11.gstinInvalid') } : {})}
          onPress={() => {
            if (shop === null) return
            setFailure(null)
            void save.mutateAsync({ id: shop.id }).then(
              () => {
                setToast(t('r11.saved'))
              },
              (error: unknown) => {
                setFailure(error instanceof Error ? error.message : t('r11.saveFailed'))
              },
            )
          }}
          fullWidth
          testID="r11-save"
        />
      }
    >
      <Stack gap={6}>
        <Async state={[my, me]} rows={5}>
          {shop === null ? (
            <Txt field="body" desk="body" testID="r11-unlinked">
              {t('r2.noShopBody', { name: distributor })}
            </Txt>
          ) : (
            <Stack gap={6}>
              {failure === null ? null : (
                <Txt field="body" desk="body" color={colors.status.brick.fg} testID="r11-failure">
                  {failure}
                </Txt>
              )}

              {/* --- what the distributor holds, and only they can change ---------------------- */}
              <Panel title={t('r11.details')} testID="r11-locked">
                <Stack gap={3}>
                  <Field label={t('r11.name')}>{shop.name}</Field>
                  <Txt field="label" desk="meta" color={colors.text.secondary}>
                    {t('r11.nameLocked', { name: distributor })}
                  </Txt>
                  <Field label={t('r11.phone')}>{shop.phone}</Field>
                  <Field label={t('r11.terms')}>
                    <StatusChip label={word(shop.paymentTerms)} family="neutral" />
                  </Field>
                  <Txt field="label" desk="meta" color={colors.text.secondary}>
                    {t('r11.termsBody', { name: distributor })}
                  </Txt>
                </Stack>
              </Panel>

              {/* --- what the shop may change ---------------------------------------------------- */}
              <Stack gap={4} maxWidth={520}>
                <TextInput
                  label={t('r11.owner')}
                  value={ownerName}
                  onChange={setOwnerName}
                  capitalize="words"
                  maxLength={120}
                  testID="r11-owner"
                />
                <TextInput
                  label={t('r11.altPhone')}
                  value={altPhone}
                  onChange={setAltPhone}
                  keyboard="phone"
                  maxLength={16}
                  testID="r11-alt-phone"
                />
                <TextInput
                  label={t('r11.address1')}
                  value={line1}
                  onChange={setLine1}
                  capitalize="words"
                  maxLength={200}
                  testID="r11-line1"
                />
                <TextInput
                  label={t('r11.area')}
                  value={area}
                  onChange={setArea}
                  capitalize="words"
                  maxLength={120}
                  testID="r11-area"
                />
                <TextInput
                  label={t('r11.city')}
                  value={city}
                  onChange={setCity}
                  capitalize="words"
                  maxLength={120}
                  testID="r11-city"
                />
                <TextInput
                  label={t('r11.pincode')}
                  value={pincode}
                  onChange={setPincode}
                  keyboard="decimal"
                  maxLength={6}
                  testID="r11-pincode"
                />
                <TextInput
                  label={t('r11.landmark')}
                  value={landmark}
                  onChange={setLandmark}
                  capitalize="words"
                  maxLength={120}
                  testID="r11-landmark"
                />
                <Segments
                  testID="r11-gst-type"
                  items={[
                    { id: 'unregistered', label: t('r11.gstUnregistered') },
                    { id: 'regular', label: t('r11.gstRegular') },
                    { id: 'composition', label: t('r11.gstComposition') },
                  ]}
                  value={gstType}
                  onChange={(id) => {
                    setGstType(id as GstType)
                  }}
                />
                <TextInput
                  label={t('r11.gstin')}
                  value={gstin}
                  onChange={setGstin}
                  maxLength={15}
                  {...(gstinBad ? { error: t('r11.gstinInvalid') } : {})}
                  testID="r11-gstin"
                />
              </Stack>
            </Stack>
          )}
        </Async>
      </Stack>

      <Toast
        open={toast !== null}
        message={toast ?? ''}
        onDismiss={() => {
          setToast(null)
        }}
        testID="r11-toast"
      />
    </Screen>
  )
}
