/**
 * S7 · New shop — a rep opening an account at the counter.
 *
 * NO CREDIT FIELDS, and not because they are hidden: `retailers.upsert` answers 403 for any of `tier`,
 * `creditLimitPaise`, `creditLimitBills`, `creditDays` or `creditMode` unless the caller is the owner
 * or the manager. A form that offered them would be a form that fails on submit, so the screen says
 * the office sets the terms and asks for the things a rep genuinely knows.
 *
 * The phone identity is NOT linked here either. `retailers.linkIdentity` is back office by design
 * (docs/17 item 27): a rep must not be able to learn whether a phone already exists in another
 * distributor's network. The screen says the office links it later, which is the truth.
 *
 * Online only. `retailers` has no sync handler for this role (docs/23 §3.4), so with no signal the
 * screen says so rather than queueing a shop that would never arrive.
 */
import { useApi, useMutation, useQueryCache } from '@dos/api-client/react'
import { isValidGstin, uuidv7 } from '@dos/domain'
import {
  Button,
  Chips,
  Row,
  Screen,
  Stack,
  StatusChip,
  TextInput,
  Txt,
  useColors,
  useGo,
  useStrings,
} from '@dos/ui'
import { useSyncEngine } from '@dos/offline/react'
import { location } from '@dos/ui/platform'
import { useMemo, useState } from 'react'

import { useBeats, useLocalState, useMyBeatIds } from '../../../src/groups/sales/lib/local'
import { shopQueryKey } from '../../../src/groups/sales/lib/new-shop'
import { Panel, useMyUserId } from '../../../src/groups/sales/lib/ui'
import { today } from '../../../src/groups/sales/lib/dates'

const GST_KINDS = ['unregistered', 'regular', 'composition'] as const

export default function NewShop(): React.JSX.Element {
  const t = useStrings()
  const colors = useColors()
  const go = useGo()
  const api = useApi()
  const local = useLocalState()
  const cache = useQueryCache()
  const engine = useSyncEngine()
  const userId = useMyUserId()
  const beats = useBeats()
  const myBeatIds = useMyBeatIds(userId, today())

  const [name, setName] = useState('')
  const [ownerName, setOwnerName] = useState('')
  const [phone, setPhone] = useState('')
  const [line1, setLine1] = useState('')
  const [area, setArea] = useState('')
  const [city, setCity] = useState('')
  const [pincode, setPincode] = useState('')
  const [gstRegType, setGstRegType] = useState<string>('unregistered')
  const [gstin, setGstin] = useState('')
  const [beatId, setBeatId] = useState<string | null>(null)
  const [point, setPoint] = useState<{ lat: number; lng: number } | null>(null)
  const [locating, setLocating] = useState(false)

  const gstinError = useMemo(() => {
    if (gstRegType === 'unregistered' || gstin.trim() === '') return undefined
    return isValidGstin(gstin.trim().toUpperCase()) ? undefined : t('s7.gstinInvalid')
  }, [gstin, gstRegType, t])

  const phoneDigits = phone.replace(/\D/g, '')
  const valid =
    name.trim().length >= 2 &&
    phoneDigits.length >= 10 &&
    gstinError === undefined &&
    (gstRegType === 'unregistered' || gstin.trim() !== '')

  const create = useMutation(
    (_input: null, meta) =>
      api.api.retailers.upsert({
        id: uuidv7(),
        idempotencyKey: meta.idempotencyKey,
        name: name.trim(),
        ownerName: ownerName.trim() === '' ? null : ownerName.trim(),
        phone: phoneDigits.length === 10 ? `+91${phoneDigits}` : `+${phoneDigits}`,
        address: {
          ...(line1.trim() === '' ? {} : { line1: line1.trim() }),
          ...(area.trim() === '' ? {} : { area: area.trim() }),
          ...(city.trim() === '' ? {} : { city: city.trim() }),
          ...(pincode.trim() === '' ? {} : { pincode: pincode.trim() }),
        },
        lat: point?.lat ?? null,
        lng: point?.lng ?? null,
        beatId,
        gstRegType: gstRegType as 'unregistered' | 'regular' | 'composition',
        gstin: gstRegType === 'unregistered' ? null : gstin.trim().toUpperCase(),
        // The shop's state, which decides whether its bill is CGST+SGST or IGST. Maharashtra for the pilot.
        stateCode: '27',
      }),
    {
      invalidates: [['names', 'retailers']],
      onSuccess: (result) => {
        /*
         * DOS-211: the card reads the phone, and the phone gets this row only with the next pull. The
         * reply IS the shop, so the card's service entry is filled with it before the card opens — it
         * shows the new shop at once instead of "That shop is not on this phone", which a rep at a
         * counter reads as "it did not save" and answers with a second, duplicate shop. The pull is
         * asked for now rather than at the next tick, so the beat and the Shops list catch up too.
         */
        cache.setData(shopQueryKey(result.item.id), result)
        void engine?.sync('shop added')
        go.replace(`/shops/${result.item.id}`)
      },
    },
  )

  return (
    <Screen
      title={t('s7.title')}
      context={t('s7.context')}
      bottomBar={
        <Row gap={3} justify="between" align="center" padX={4} padY={2} wrap>
          <Txt field="label" desk="meta" color={colors.text.secondary}>
            {local.online ? t('s7.officeSetsTerms') : t('s7.needsSignal')}
          </Txt>
          <Button
            testID="create-shop"
            variant="primary"
            label={t('s7.create')}
            disabled={!valid || !local.online}
            disabledReason={
              local.online ? (valid ? undefined : t('s7.needName')) : t('s7.needsSignal')
            }
            loading={create.status === 'pending'}
            onPress={() => {
              create.mutate(null)
            }}
          />
        </Row>
      }
    >
      <Stack gap={6}>
        {create.error === undefined ? null : (
          <Txt field="body" desk="body" color={colors.status.brick.fg}>
            {create.error.message}
          </Txt>
        )}

        <Panel title={t('s7.shop')}>
          <Stack gap={4}>
            <TextInput
              label={t('s7.name')}
              value={name}
              onChange={setName}
              capitalize="words"
              autoFocus
              testID="shop-name"
            />
            <TextInput
              label={t('s7.owner')}
              value={ownerName}
              onChange={setOwnerName}
              capitalize="words"
            />
            <TextInput
              label={t('s7.phone')}
              value={phone}
              onChange={setPhone}
              keyboard="phone"
              helper={t('s7.phoneHelp')}
              testID="shop-phone"
            />
          </Stack>
        </Panel>

        <Panel title={t('s7.where')}>
          <Stack gap={4}>
            <TextInput label={t('s7.line1')} value={line1} onChange={setLine1} capitalize="words" />
            <Row gap={3} wrap>
              <TextInput label={t('s7.area')} value={area} onChange={setArea} capitalize="words" />
              <TextInput label={t('s7.city')} value={city} onChange={setCity} capitalize="words" />
              <TextInput
                label={t('s7.pincode')}
                value={pincode}
                onChange={setPincode}
                keyboard="decimal"
                maxLength={6}
              />
            </Row>
            {beats.length === 0 ? null : (
              <Stack gap={2}>
                <Txt field="label" desk="meta" color={colors.text.secondary}>
                  {t('s7.beat')}
                </Txt>
                <Chips
                  testID="shop-beat"
                  items={(myBeatIds.length > 0 ? myBeatIds : beats.map((beat) => beat.id)).map(
                    (id) => ({
                      id,
                      label: beats.find((beat) => beat.id === id)?.name ?? id.slice(0, 8),
                      selected: id === beatId,
                    }),
                  )}
                  onToggle={(id) => {
                    setBeatId(id === beatId ? null : id)
                  }}
                  onClear={
                    beatId === null
                      ? undefined
                      : () => {
                          setBeatId(null)
                        }
                  }
                />
              </Stack>
            )}
            <Row gap={2} align="center" wrap>
              <Button
                label={locating ? t('s2.locating') : t('s7.pinHere')}
                variant="ghost"
                loading={locating}
                onPress={() => {
                  setLocating(true)
                  void location
                    .current()
                    .then((found) => {
                      if (found !== null) setPoint({ lat: found.latitude, lng: found.longitude })
                    })
                    .finally(() => {
                      setLocating(false)
                    })
                }}
              />
              <StatusChip
                label={point === null ? t('s2.noPosition') : t('s2.positionTagged')}
                family={point === null ? 'neutral' : 'moss'}
              />
            </Row>
          </Stack>
        </Panel>

        <Panel title={t('s7.tax')} meta={t('s7.taxMeta')}>
          <Stack gap={4}>
            <Chips
              testID="shop-gst-kind"
              items={GST_KINDS.map((id) => ({
                id,
                label: t(`s7.gst_${id}`),
                selected: id === gstRegType,
              }))}
              onToggle={setGstRegType}
            />
            {gstRegType === 'unregistered' ? null : (
              <TextInput
                label={t('s7.gstin')}
                value={gstin}
                onChange={setGstin}
                error={gstinError}
                maxLength={15}
                helper={t('s7.gstinHelp')}
              />
            )}
          </Stack>
        </Panel>

        <Txt field="label" desk="meta" color={colors.text.secondary}>
          {t('s7.linkLater')}
        </Txt>
      </Stack>
    </Screen>
  )
}
