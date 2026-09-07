/**
 * UX-00 sections 6.11, 6.12 and 6.13 for React DOM: ConnectionStrip, Sheet, Dialog, Toast, Avatar,
 * TenantLogo, EmptyState, ErrorState, Skeleton.
 */
import { useEffect, useRef, useState } from 'react'

import { clockTime, relativeTime } from '../relative-time.js'
import { useTheme } from '../theme.js'
import { cssShadow, monogramSize, radius, size as sizeTokens, space } from '../tokens.js'
import type {
  AvatarProps,
  ConnectionStripProps,
  DialogProps,
  EmptyStateProps,
  ErrorStateProps,
  SheetProps,
  SkeletonProps,
  TenantLogoProps,
  ToastProps,
} from '../types.js'
import { Txt } from './base.js'
import { Button } from './controls.js'

// ---------------------------------------------------------------------------
// 6.11 ConnectionStrip — the honesty contract. No "Sync now", never a modal.
// ---------------------------------------------------------------------------

/** Four hours: past it, data announces its own age (UX-00 section 6.11). */
const STALE_MS = 4 * 60 * 60 * 1000

export function ConnectionStrip({
  state,
  onOpenQueue,
  now = Date.now(),
  testID,
}: ConnectionStripProps): React.JSX.Element {
  const theme = useTheme()
  const pending = state.pendingWrites ?? 0
  const attention = state.needsAttention ?? 0
  const stale =
    state.staleSince !== null && state.staleSince !== undefined && now - state.staleSince > STALE_MS

  let message: string
  let tone: string = theme.colors.text.secondary
  if (!state.online) {
    /*
     * "Offline since 10:42" — a clock time, not "2 h ago" (UX-00 3.3) — AND what the device is still
     * holding, because being offline is exactly when that matters. The offline branch used to win
     * outright and drop the count: measured in the delivery gate, a driver who recorded an arrival
     * at a shop door with no signal saw a strip that said only "Offline since 12:01 pm", on the one
     * screen that is meant to tell them the phone is still carrying their work. Both facts, one line.
     */
    const when =
      state.lastSyncedAt === null || state.lastSyncedAt === undefined
        ? clockTime(now)
        : clockTime(state.lastSyncedAt)
    if (attention > 0) {
      message = theme.t('connection.offlineAttention', { when, count: attention })
      tone = theme.colors.status.brick.fg
    } else if (pending > 0) {
      message = theme.t('connection.offlineWaiting', { when, count: pending })
      tone = theme.colors.status.ochre.fg
    } else {
      message = theme.t('connection.offline', { when })
    }
  } else if (attention > 0) {
    message = theme.t('connection.attention', { count: attention })
    tone = theme.colors.status.brick.fg
  } else if (pending > 0) {
    message = theme.t('connection.waiting', { count: pending })
    tone = theme.colors.status.ochre.fg
  } else if (stale && state.staleSince) {
    message = theme.t('connection.stale', { when: clockTime(state.staleSince) })
    tone = theme.colors.status.ochre.fg
  } else if (state.lastSyncedAt === null || state.lastSyncedAt === undefined) {
    /*
     * Online, but no read has come back yet. Saying "Updated just now" here is the one lie this
     * component exists to prevent: with a service that accepts the connection and never answers,
     * every panel is a skeleton and the strip was announcing fresh data. It says what is true.
     */
    message = theme.t('connection.notYet')
  } else {
    message = theme.t('connection.synced', {
      when: relativeTime(state.lastSyncedAt, now, theme.t),
    })
  }

  // 28 dp and inert while it has nothing to open; a full touch-floor row once something is waiting.
  const actionable = (pending > 0 || attention > 0) && onOpenQueue !== undefined
  const height = actionable ? sizeTokens[theme.touch] : 28
  const content = (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: space[2] }}>
      <span
        aria-hidden
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background:
            state.online && state.lastSyncedAt !== null && state.lastSyncedAt !== undefined
              ? theme.colors.status.moss.edge
              : theme.colors.border.strong,
        }}
      />
      <Txt field="label" desk="meta" color={tone}>
        {message}
      </Txt>
    </span>
  )

  if (!actionable) {
    return (
      <div
        data-testid={testID}
        role="status"
        aria-live="polite"
        style={{
          // minHeight, not height: a narrow rail foot must be allowed to wrap rather than clip.
          minHeight: height,
          display: 'flex',
          alignItems: 'center',
          padding: `${space[1]}px ${space[2]}px`,
          background: theme.colors.bg.surface,
        }}
      >
        {content}
      </div>
    )
  }
  return (
    <button
      type="button"
      data-testid={testID}
      onClick={onOpenQueue}
      style={{
        height,
        minHeight: height,
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        padding: `0 ${space[4]}px`,
        background: theme.colors.bg.surface,
        border: 0,
        borderTop: `1px solid ${theme.colors.border.hairline}`,
        cursor: 'pointer',
        fontFamily: 'inherit',
      }}
    >
      {content}
    </button>
  )
}

// ---------------------------------------------------------------------------
// 6.12 Sheet, Dialog, Toast
// ---------------------------------------------------------------------------

function useEscape(open: boolean, onClose: () => void): void {
  useEffect(() => {
    if (!open || typeof document === 'undefined') return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])
}

/**
 * Bottom sheet on every phone-width surface. On a desk viewport the same content becomes the
 * right-hand side panel of UX-00 section 6.12; the caller does not change.
 */
export function Sheet({ open, onClose, title, children, testID }: SheetProps): React.JSX.Element {
  const theme = useTheme()
  useEscape(open, onClose)
  if (!open) return <></>
  const desk = theme.density === 'desk'
  return (
    <div
      className="dos-backdrop"
      data-testid={testID}
      onClick={onClose}
      style={{
        alignItems: desk ? 'stretch' : 'flex-end',
        justifyContent: desk ? 'flex-end' : 'center',
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={desk ? undefined : 'dos-sheet'}
        onClick={(e) => {
          e.stopPropagation()
        }}
        style={
          desk
            ? {
                width: 360,
                background: theme.colors.bg.surface,
                borderLeft: `1px solid ${theme.colors.border.hairline}`,
                padding: space[5],
                overflowY: 'auto',
              }
            : {
                paddingTop: space[4],
                paddingLeft: space[4],
                paddingRight: space[4],
                paddingBottom: space[6],
                maxHeight: '80vh',
                overflowY: 'auto',
              }
        }
      >
        {desk ? null : (
          <div
            aria-hidden
            style={{
              width: 32,
              height: 4,
              borderRadius: 2,
              background: theme.colors.bg.handle,
              margin: `0 auto ${space[3]}px`,
            }}
          />
        )}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: space[3],
          }}
        >
          {title ? (
            <Txt field="title" desk="section" as="h2">
              {title}
            </Txt>
          ) : (
            <span />
          )}
          {/*
            `size="desk"` only for the DESK side panel. A bottom sheet is a phone surface, so its
            close button obeys the app's own floor (UX-00 section 5.2) exactly as every other control
            on that sheet does — 32 px under a thumb was the smallest target in the kit.
          */}
          <Button
            label={theme.t('action.close')}
            variant="ghost"
            onPress={onClose}
            {...(desk ? { size: 'desk' as const } : {})}
          />
        </div>
        {children}
      </div>
    </div>
  )
}

/**
 * Dialogs exist for IRREVERSIBLE ledger writes only, and each states exactly what will be written
 * with the real verb on the confirm (UX-00 section 6.12).
 */
export function Dialog({
  open,
  onClose,
  title,
  body,
  confirmLabel,
  onConfirm,
  cancelLabel,
  destructive,
  busy,
  testID,
}: DialogProps): React.JSX.Element {
  const theme = useTheme()
  const confirmRef = useRef<HTMLDivElement>(null)
  useEscape(open, onClose)
  useEffect(() => {
    if (open) confirmRef.current?.querySelector('button')?.focus()
  }, [open])
  if (!open) return <></>
  return (
    <div
      className="dos-backdrop"
      data-testid={testID}
      style={{ alignItems: 'center', justifyContent: 'center', padding: space[4] }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        className="dos-dialog"
        style={{ padding: space[5], boxShadow: cssShadow('dialog') }}
      >
        <Txt field="title" desk="pageTitle" as="h2">
          {title}
        </Txt>
        <div style={{ margin: `${space[3]}px 0 ${space[5]}px` }}>
          <Txt field="body" desk="body" as="div" color={theme.colors.text.secondary}>
            {body}
          </Txt>
        </div>
        <div style={{ display: 'flex', gap: space[3], justifyContent: 'flex-end' }}>
          <Button
            label={cancelLabel ?? theme.t('action.cancel')}
            variant="secondary"
            size="desk"
            onPress={onClose}
          />
          <div ref={confirmRef}>
            <Button
              label={confirmLabel}
              variant={destructive === true ? 'destructive' : 'primary'}
              size="desk"
              loading={busy === true}
              onPress={onConfirm}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

/** 4 s, one at a time, above the action bar. Undo only for what the machines can reverse. */
export function Toast({
  open,
  message,
  actionLabel,
  onAction,
  onDismiss,
  testID,
}: ToastProps): React.JSX.Element {
  const theme = useTheme()
  useEffect(() => {
    if (!open) return
    const id = setTimeout(onDismiss, 4000)
    return () => {
      clearTimeout(id)
    }
  }, [open, onDismiss])
  if (!open) return <></>
  const height = Math.max(sizeTokens[theme.touch], 48)
  return (
    <div
      data-testid={testID}
      role="status"
      aria-live="polite"
      className="dos-toast"
      style={{
        position: 'fixed',
        left: space[4],
        right: space[4],
        bottom: space[4],
        minHeight: height,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: space[3],
        padding: `0 ${space[4]}px`,
        zIndex: 50,
      }}
    >
      <Txt field="body" desk="body">
        {message}
      </Txt>
      {actionLabel && onAction ? (
        <div style={{ minWidth: 88 }}>
          <Button label={actionLabel} variant="ghost" onPress={onAction} />
        </div>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 6.13 Avatar, TenantLogo, EmptyState, ErrorState, Skeleton
// ---------------------------------------------------------------------------

/** Up to two initials. No photographs, no identity rings. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  const first = words[0]?.[0] ?? ''
  const second = words.length > 1 ? (words[words.length - 1]?.[0] ?? '') : ''
  return (first + second).toUpperCase()
}

export function Avatar({ name, size = 40, testID }: AvatarProps): React.JSX.Element {
  const theme = useTheme()
  return (
    <span
      data-testid={testID}
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: radius.full,
        background: theme.colors.bg.sunken,
        color: theme.colors.text.primary,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 600,
        fontSize: monogramSize(size),
        flexShrink: 0,
      }}
    >
      {initialsOf(name)}
    </span>
  )
}

const LOGO_BOX = { rail: 28, header: 32, card: 40 } as const

/**
 * The distributor's mark. No logo means the initials box — square (`radius.sm`), because it is a
 * mark, not a person. Distribution OS's own mark never appears here (docs/22 section 9 item 10).
 */
/**
 * A pre-signed logo URL lives 24 hours; a distributor whose window has closed, or whose object was
 * never uploaded, must not get a broken-image glyph in the chrome of EVERY screen. A failed load
 * falls back to the initials mark, which is the same thing an absent URL gets (UX-00 section 11).
 */
export function TenantLogo({
  size = 'rail',
  name,
  logoUrl,
  withName,
  subtitle,
  testID,
}: TenantLogoProps): React.JSX.Element {
  const theme = useTheme()
  const [failed, setFailed] = useState(false)
  const displayName = name ?? theme.tenant?.name ?? ''
  const given = logoUrl ?? theme.tenant?.logoUrl ?? null
  const url = failed ? null : given
  const box = LOGO_BOX[size]
  return (
    <span
      data-testid={testID}
      style={{ display: 'inline-flex', alignItems: 'center', gap: space[2], minWidth: 0 }}
    >
      {url ? (
        <img
          src={url}
          alt={theme.t('tenant.logoAlt', { name: displayName })}
          onError={() => {
            setFailed(true)
          }}
          style={{
            width: box,
            height: box,
            objectFit: 'contain',
            borderRadius: radius.sm,
            flexShrink: 0,
          }}
        />
      ) : (
        <span
          aria-hidden
          style={{
            width: box,
            height: box,
            borderRadius: radius.sm,
            background: theme.colors.bg.sunken,
            color: theme.colors.text.primary,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 600,
            fontSize: monogramSize(box, 0.42),
            flexShrink: 0,
          }}
        >
          {initialsOf(displayName)}
        </span>
      )}
      {/*
        `numberOfLines`, not `whiteSpace: nowrap`: a name the box cannot hold has to be CUT, not
        pushed out of it. Nowrap with no shrink made the 172 px rail 185 px wide for a distributor
        called "Sai Distributors, Dombivli" and painted the switcher's caret over the page. The
        native half already clamped to one line; this is the same rule on the web half, and `title`
        keeps the full name one hover away.
      */}
      {withName ? (
        <span style={{ minWidth: 0, flexShrink: 1 }} title={displayName}>
          {/*
            Two lines for the NAME, one for the subtitle. The rail is 172 px and "Tarsun Enterprise"
            at railTitle 14/700 does not fit on one of them — clamping to one line would put the
            distributor's own name (UX-00 §11: it IS the chrome) behind an ellipsis on the pilot's
            very first screen. Two lines fit; a genuinely long name still stops at two.
          */}
          <Txt field="title" desk="railTitle" as="div" numberOfLines={2}>
            {displayName}
          </Txt>
          {subtitle ? (
            <Txt
              field="label"
              desk="meta"
              as="div"
              color={theme.colors.text.secondary}
              numberOfLines={1}
            >
              {subtitle}
            </Txt>
          ) : null}
        </span>
      ) : null}
    </span>
  )
}

export function EmptyState({
  message,
  icon,
  actionLabel,
  onAction,
  testID,
}: EmptyStateProps): React.JSX.Element {
  const theme = useTheme()
  return (
    <div
      data-testid={testID}
      style={{ padding: space[6], textAlign: 'center', color: theme.colors.icon.muted }}
    >
      {icon}
      <Txt field="body" desk="body" as="div" color={theme.colors.text.secondary}>
        {message}
      </Txt>
      {actionLabel && onAction ? (
        <div style={{ marginTop: space[3], display: 'inline-flex', justifyContent: 'center' }}>
          <Button label={actionLabel} variant="secondary" onPress={onAction} />
        </div>
      ) : null}
    </div>
  )
}

/** Business language plus the next action; a code lives behind "Details", never in the sentence. */
export function ErrorState({
  message,
  detail,
  actionLabel,
  onAction,
  testID,
}: ErrorStateProps): React.JSX.Element {
  const theme = useTheme()
  return (
    <div
      data-testid={testID}
      style={{
        padding: space[5],
        background: theme.colors.status.brick.tint,
        borderRadius: radius.md,
      }}
    >
      <Txt field="bodyStrong" desk="section" as="div" color={theme.colors.status.brick.fg}>
        {message}
      </Txt>
      {detail ? (
        <details style={{ marginTop: space[2] }}>
          <summary style={{ cursor: 'pointer', color: theme.colors.text.secondary }}>
            {theme.t('action.details')}
          </summary>
          <Txt field="label" desk="meta" as="div" color={theme.colors.text.secondary}>
            {detail}
          </Txt>
        </details>
      ) : null}
      {actionLabel && onAction ? (
        <div style={{ marginTop: space[3] }}>
          <Button label={actionLabel} variant="secondary" onPress={onAction} />
        </div>
      ) : null}
    </div>
  )
}

/** Content-shaped, at real row heights, 1.2 s pulse, static under reduce-motion (the sheet does it). */
export function Skeleton({
  rows = 3,
  rowHeight = 72,
  width = '100%',
  testID,
}: SkeletonProps): React.JSX.Element {
  const theme = useTheme()
  return (
    <div data-testid={testID} aria-hidden aria-label={theme.t('state.loading')}>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="dos-skeleton"
          style={{ height: rowHeight - 8, width, marginBottom: 8 }}
        />
      ))}
    </div>
  )
}
