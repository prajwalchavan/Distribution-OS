/**
 * W2 — capture the supplier bill, and watch the four steps (docs/23 §4.1, docs/05).
 *
 * "Zero manual entry" means exactly this screen: photograph every page, read the e-invoice QR if the
 * bill has one, send it. Nothing on this screen is typed except the supplier, and even that is
 * optional — the pipeline reads the seller off the bill.
 *
 * WHAT THIS ROLE MAY DO, and what it may not. `permissions.ts` gives the warehouse
 * `docint.documents.create / pageUploadUrl / addPage / verifyQr / submit / list / get / status /
 * pageUrl` and NOT `extractions.*`, `matches.*`, `review.*`, `approve` or `reject`: the engine's
 * reading carries the supplier's printed RATES, which is purchase cost, which is back office by rule
 * (docs/22 §9). So the four steps are shown as steps — where the bill has got to — and the reading
 * itself is never drawn here. The desk reviews it and opens the GRN; the gate counts (W3).
 *
 * The upload path is the platform's, not the browser's: `pageUploadUrl` mints a pre-signed PUT,
 * `@dos/ui/platform`'s `files.upload` sends the bytes, `addPage` registers what landed. The app never
 * sees a bucket and never a raw object key.
 */
import { useApi, useMutation, useQuery, useSession } from '@dos/api-client/react'
import {
  Button,
  Group,
  ListRow,
  Row,
  Screen,
  Stack,
  StatusChip,
  Toast,
  Txt,
  useColors,
  useStrings,
} from '@dos/ui'
import { camera, files as platformFiles, haptics } from '@dos/ui/platform'
import { newId } from '@dos/api-client'
import type { DocumentDetail, DocumentStatus } from '@dos/contracts'
import { useState } from 'react'

import { absoluteUrl } from '../../src/config'
import { instantWithClock } from '../../src/lib/dates'
import { Async, DeskOnly, PageTabs, Panel, pl, workFamily } from '../../src/lib/ui'

/** The four steps of docs/05, and where each document status sits on them. */
const STEP_KEYS = ['w2.step1', 'w2.step2', 'w2.step3', 'w2.step4'] as const

function stepStateOf(status: DocumentStatus, step: number): 'done' | 'running' | 'failed' | 'todo' {
  const order: readonly DocumentStatus[] = [
    'uploaded',
    'verifying',
    'extracting',
    'extracted',
    'needs_review',
    'reviewed',
    'committed',
  ]
  if (status === 'failed' || status === 'rejected') return step === 0 ? 'failed' : 'todo'
  const at = order.indexOf(status)
  // step 0 QR/IRN · 1 read · 2 matched · 3 desk review
  const reached = [1, 3, 4, 6]
  const running = [0, 2, 3, 5]
  const need = reached[step] ?? 6
  if (at >= need) return 'done'
  if (at === running[step]) return 'running'
  return 'todo'
}

export default function Capture(): React.JSX.Element {
  const t = useStrings()
  const api = useApi()
  const colors = useColors()
  const { session } = useSession()
  const signedIn = session !== null

  const [doc, setDoc] = useState<DocumentDetail | null>(null)
  const [supplierId, setSupplierId] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const suppliers = useQuery(['suppliers'], () => api.api.tenantCatalog.suppliers(), {
    enabled: signedIn,
  })
  const recent = useQuery(
    ['docints', 'recent'],
    () => api.api.docint.documents.list({ kind: 'supplier_invoice', limit: 15 }),
    { enabled: signedIn },
  )
  /** The cheap poll after a submit: status only, never the reading (docs/05). */
  const watched = useQuery(
    ['docint', 'status', doc?.id ?? ''],
    () => api.api.docint.documents.status({ id: doc?.id ?? '' }),
    { enabled: signedIn && doc !== null, staleTime: 3000 },
  )

  const submit = useMutation(
    (input: { id: string }, meta) =>
      api.api.docint.documents.submit({ id: input.id, idempotencyKey: meta.idempotencyKey }),
    {
      invalidates: [['docints']],
      onSuccess: (result) => {
        haptics.success()
        setDoc(result.item)
        setToast(t('w2.submitted'))
      },
    },
  )

  /**
   * One page: start the document if this is the first, mint a slot, PUT the bytes, register it.
   *
   * Every step carries the SAME client-generated id for its intent, so a tap that times out and is
   * repeated adds one page, not two.
   */
  const addPage = async (): Promise<void> => {
    setError(null)
    setBusy(true)
    try {
      const photo = await camera.photograph()
      if (photo === null) return
      let current = doc
      if (current === null) {
        const created = await api.api.docint.documents.create({
          id: newId(),
          idempotencyKey: newId(),
          kind: 'supplier_invoice',
          ...(supplierId === '' ? {} : { supplierId }),
        })
        current = created.item
        setDoc(current)
      }
      const pageNo = current.pages.length + 1
      const slots = await api.api.docint.documents.pageUploadUrl({
        id: current.id,
        idempotencyKey: newId(),
        pages: [
          {
            pageNo,
            mimeType: photo.mimeType === 'image/png' ? 'image/png' : 'image/jpeg',
            bytes: photo.bytes ?? 1,
          },
        ],
      })
      const slot = slots.slots[0]
      if (slot === undefined) throw new Error(t('w2.pageFailed'))
      const target = absoluteUrl(slot.url)
      if (target !== null) {
        await platformFiles.upload(photo, target, {
          method: slot.method ?? 'PUT',
          headers: slot.headers,
        })
      }
      const added = await api.api.docint.documents.addPage({
        id: current.id,
        idempotencyKey: newId(),
        pageId: newId(),
        pageNo,
        mimeType: photo.mimeType === 'image/png' ? 'image/png' : 'image/jpeg',
        objectKey: slot.objectKey,
        ...(photo.bytes === undefined ? {} : { bytes: photo.bytes }),
        ...(photo.width === undefined ? {} : { width: photo.width }),
        ...(photo.height === undefined ? {} : { height: photo.height }),
      })
      haptics.success()
      setDoc(added.item)
    } catch (raw: unknown) {
      haptics.error()
      setError(raw instanceof Error ? raw.message : t('w2.pageFailed'))
    } finally {
      setBusy(false)
    }
  }

  /** The QR is a scan, never a typed IRN: 64 hex characters read off a bill by hand is not a plan. */
  const readQr = async (): Promise<void> => {
    if (doc === null) return
    setError(null)
    setBusy(true)
    try {
      const code = await camera.scan({ formats: ['qr_code'] })
      if (code === null) {
        setError(t('w.scanNothing'))
        return
      }
      const verified = await api.api.docint.documents.verifyQr({
        id: doc.id,
        idempotencyKey: newId(),
        qrText: code.value,
      })
      setDoc(verified.item)
      if (verified.duplicate !== null) setToast(t('w2.qrDuplicate'))
      else setToast(t('w2.qrDone', { status: verified.item.qrStatus }))
    } catch (raw: unknown) {
      setError(raw instanceof Error ? raw.message : t('w.scanNothing'))
    } finally {
      setBusy(false)
    }
  }

  const status: DocumentStatus = watched.data?.status ?? doc?.status ?? 'uploaded'
  const pageCount = doc?.pages.length ?? 0

  return (
    <Screen
      title={t('w2.title')}
      context={session?.tenant.displayName}
      testID="w2-screen"
      bottomBar={
        doc === null ? undefined : (
          <Row justify="between" align="center" gap={4} wrap>
            <Txt field="label" desk="meta" color={colors.text.secondary}>
              {pageCount === 0 ? t('w2.noPages') : pl(t, 'w.pagesN', pageCount)}
            </Txt>
            <Button
              label={t('w2.submit')}
              variant="primary"
              loading={submit.status === 'pending'}
              disabled={pageCount === 0 || status !== 'uploaded'}
              {...(pageCount === 0 ? { disabledReason: t('w2.noPages') } : {})}
              onPress={() => {
                submit.mutate({ id: doc.id })
              }}
              testID="w2-submit"
            />
          </Row>
        )
      }
    >
      <Stack gap={6}>
        <PageTabs group="/" active="/inbound/capture" />

        <Txt field="body" desk="body" color={colors.text.secondary}>
          {t('w2.body')}
        </Txt>

        {/*
         * The chosen supplier is the panel's own meta line, not a read-only text box. A disabled
         * empty field at the top of a capture screen is a dead control: it looks like the place to
         * type the supplier's name on the very screen whose whole promise is that nothing is typed.
         */}
        <Panel
          title={t('w2.supplier')}
          meta={
            suppliers.data?.items.find((one) => one.id === supplierId)?.name ?? t('w2.supplierAny')
          }
          testID="w2-supplier"
        >
          <Stack gap={3}>
            <Group>
              {(suppliers.data?.items ?? []).slice(0, 8).map((supplier) => (
                <ListRow
                  key={supplier.id}
                  testID={`w2-supplier-${supplier.id}`}
                  primary={supplier.name}
                  secondary={supplier.gstin ?? ''}
                  state={supplier.id === supplierId ? 'selected' : 'default'}
                  onPress={() => {
                    setSupplierId(supplier.id === supplierId ? '' : supplier.id)
                  }}
                />
              ))}
            </Group>
          </Stack>
        </Panel>

        <Panel title={pl(t, 'w.pagesN', pageCount)} testID="w2-pages">
          <Stack gap={3}>
            <Row gap={8} wrap>
              <Button
                label={t('w2.takePhoto')}
                variant="primary"
                loading={busy}
                disabled={!camera.available}
                {...(camera.available ? {} : { disabledReason: t('w2.cameraDenied') })}
                onPress={() => {
                  void addPage()
                }}
                testID="w2-photo"
              />
              <Button
                label={t('w2.scanQr')}
                variant="secondary"
                disabled={doc === null}
                {...(doc === null ? { disabledReason: t('w2.noPages') } : {})}
                onPress={() => {
                  void readQr()
                }}
                testID="w2-qr"
              />
            </Row>
            {error === null ? null : (
              <Txt field="body" desk="body" color={colors.status.brick.fg}>
                {error}
              </Txt>
            )}
            {doc === null ? null : (
              <Group>
                {doc.pages.map((page) => (
                  <ListRow
                    key={page.id}
                    testID={`w2-page-${String(page.pageNo)}`}
                    /* This row is ONE page, not the tally: it read "2 pages captured" for page 2. */
                    primary={t('w.pageNo', { page: page.pageNo })}
                    secondary={page.printedPageLabel ?? page.mimeType}
                    trailing={
                      <StatusChip
                        label={page.qrDetected ? 'QR' : t('w.saved')}
                        family={page.qrDetected ? 'moss' : 'neutral'}
                      />
                    }
                  />
                ))}
              </Group>
            )}
          </Stack>
        </Panel>

        {doc === null ? null : (
          <Panel title={t('w2.steps')} meta={t('w2.watch')} testID="w2-steps">
            <Group>
              {STEP_KEYS.map((key, step) => {
                const state = stepStateOf(status, step)
                return (
                  <ListRow
                    key={key}
                    testID={`w2-step-${String(step + 1)}`}
                    primary={t(key)}
                    trailing={
                      <StatusChip
                        label={
                          state === 'done'
                            ? t('w2.stepDone')
                            : state === 'running'
                              ? t('w2.stepRunning')
                              : state === 'failed'
                                ? t('w2.stepFailed')
                                : t('w2.stepWaiting')
                        }
                        family={
                          state === 'done'
                            ? 'moss'
                            : state === 'running'
                              ? 'clay'
                              : state === 'failed'
                                ? 'brick'
                                : 'neutral'
                        }
                      />
                    }
                  />
                )
              })}
            </Group>
          </Panel>
        )}

        <DeskOnly>{t('w2.reviewIsDesk')}</DeskOnly>

        <Panel title={t('w2.recent')} testID="w2-recent">
          <Async
            state={recent}
            empty={(recent.data?.items.length ?? 0) === 0}
            emptyMessage={t('w2.recentEmpty')}
          >
            <Group>
              {(recent.data?.items ?? []).map((row) => (
                <ListRow
                  key={row.id}
                  testID={`w2-doc-${row.id}`}
                  primary={row.supplierName ?? t('w2.supplierAny')}
                  secondary={t('w2.byWhom', {
                    name: row.uploadedByName ?? '—',
                  })}
                  trailing={<StatusChip label={row.status} family={workFamily(row.status)} />}
                  reason={instantWithClock(row.createdAt)}
                />
              ))}
            </Group>
          </Async>
        </Panel>
      </Stack>
      <Toast
        open={toast !== null}
        message={toast ?? ''}
        onDismiss={() => {
          setToast(null)
        }}
        testID="w2-toast"
      />
    </Screen>
  )
}
