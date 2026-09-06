/**
 * UX-00 sections 6.11, 6.12 and 6.13 for React Native: ConnectionStrip, Sheet, Dialog, Toast, Avatar,
 * TenantLogo, EmptyState, ErrorState, Skeleton.
 */
import { useEffect, useState } from 'react'
import { Image, Modal, Pressable, ScrollView, View } from 'react-native'

import { clockTime, relativeTime } from '../relative-time.js'
import { useTheme } from '../theme.js'
import { nativeShadow, radius, size as sizeTokens, space } from '../tokens.js'
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
  const syncedAt = state.lastSyncedAt ?? null

  let message: string
  let tone: string = theme.colors.text.secondary
  if (!state.online) {
    // "Offline since 10:42" — a clock time, not "2 h ago" (UX-00 3.3).
    message = theme.t('connection.offline', {
      when:
        state.lastSyncedAt === null || state.lastSyncedAt === undefined
          ? clockTime(now)
          : clockTime(state.lastSyncedAt),
    })
  } else if (attention > 0) {
    message = theme.t('connection.attention', { count: attention })
    tone = theme.colors.status.brick.fg
  } else if (pending > 0) {
    message = theme.t('connection.waiting', { count: pending })
    tone = theme.colors.status.ochre.fg
  } else if (stale && state.staleSince) {
    message = theme.t('connection.stale', { when: clockTime(state.staleSince) })
    tone = theme.colors.status.ochre.fg
  } else if (syncedAt === null) {
    /*
     * Online, but no read has come back yet. Saying "Updated just now" here is the one lie this
     * component exists to prevent: with a service that accepts the connection and never answers,
     * every panel is a skeleton and the strip was announcing fresh data. It says what is true.
     */
    message = theme.t('connection.notYet')
  } else {
    message = theme.t('connection.synced', {
      when: relativeTime(syncedAt, now, theme.t),
    })
  }

  // 28 dp and inert while it has nothing to open; a touch-floor row once something is waiting.
  const actionable = (pending > 0 || attention > 0) && onOpenQueue !== undefined
  const height = actionable ? sizeTokens[theme.touch] : 28
  const body = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
      <View
        style={{
          width: 8,
          height: 8,
          borderRadius: 4,
          backgroundColor:
            state.online && syncedAt !== null
              ? theme.colors.status.moss.edge
              : theme.colors.border.strong,
        }}
      />
      <Txt field="label" desk="meta" color={tone}>
        {message}
      </Txt>
    </View>
  )
  const frame = {
    // minHeight, not height: a long sentence wraps instead of clipping.
    minHeight: height,
    justifyContent: 'center' as const,
    paddingHorizontal: space[4],
    paddingVertical: space[1],
    backgroundColor: theme.colors.bg.surface,
  }
  return actionable ? (
    <Pressable testID={testID} accessibilityRole="button" onPress={onOpenQueue} style={frame}>
      {body}
    </Pressable>
  ) : (
    <View testID={testID} accessibilityRole="text" style={frame}>
      {body}
    </View>
  )
}

// ---------------------------------------------------------------------------
// 6.12 Sheet, Dialog, Toast
// ---------------------------------------------------------------------------

export function Sheet({ open, onClose, title, children, testID }: SheetProps): React.JSX.Element {
  const theme = useTheme()
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        testID={testID}
        onPress={onClose}
        style={{ flex: 1, backgroundColor: theme.colors.bg.backdrop, justifyContent: 'flex-end' }}
      >
        {/*
         * A SHEET NEVER REACHES THE NOTCH, AND NEVER RUNS OFF THE BOTTOM.
         *
         * It is `justifyContent: 'flex-end'`, so a sheet taller than the screen simply grew upward
         * until its own title sat under the status bar — measured on the iPhone 16 Pro, where the
         * phone shell's "More" sheet (eleven destinations plus a search box and a Close button)
         * printed its heading "More" straight through the 8:15 clock, and anything past the bottom
         * of the screen was unreachable because the body does not scroll. `maxHeight` keeps the top
         * clear of the inset and the body scrolls inside whatever is left.
         */}
        <Pressable
          onPress={() => undefined}
          style={[
            {
              backgroundColor: theme.colors.bg.surface,
              borderTopLeftRadius: radius.xl,
              borderTopRightRadius: radius.xl,
              padding: space[4],
              paddingBottom: space[8],
              maxHeight: '86%',
            },
            nativeShadow('sheet'),
          ]}
        >
          <View
            style={{
              width: 32,
              height: 4,
              borderRadius: 2,
              alignSelf: 'center',
              backgroundColor: theme.colors.bg.handle,
              marginBottom: space[3],
            }}
          />
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: space[3],
            }}
          >
            {title ? (
              <Txt field="title" desk="section">
                {title}
              </Txt>
            ) : (
              <View />
            )}
          </View>
          <ScrollView
            style={{ flexShrink: 1 }}
            contentContainerStyle={{ flexGrow: 0 }}
            keyboardShouldPersistTaps="handled"
          >
            {children}
          </ScrollView>
          <View style={{ marginTop: space[4] }}>
            <Button label={theme.t('action.close')} variant="secondary" onPress={onClose} />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

/** Dialogs exist for irreversible ledger writes only, and state exactly what will be written. */
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
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <View
        testID={testID}
        style={{
          flex: 1,
          backgroundColor: theme.colors.bg.backdrop,
          alignItems: 'center',
          justifyContent: 'center',
          padding: space[4],
        }}
      >
        <View
          style={[
            {
              width: '100%',
              maxWidth: 480,
              backgroundColor: theme.colors.bg.surface,
              borderRadius: radius.lg,
              padding: space[5],
            },
            nativeShadow('dialog'),
          ]}
        >
          <Txt field="title" desk="pageTitle">
            {title}
          </Txt>
          <View style={{ marginVertical: space[3] }}>
            {typeof body === 'string' ? (
              <Txt field="body" desk="body" color={theme.colors.text.secondary}>
                {body}
              </Txt>
            ) : (
              body
            )}
          </View>
          {/* >= 50 dp between the confirming and the cancelling action. */}
          <Button
            label={confirmLabel}
            variant={destructive === true ? 'destructive' : 'primary'}
            loading={busy === true}
            onPress={onConfirm}
          />
          <View style={{ height: space[3] }} />
          <Button
            label={cancelLabel ?? theme.t('action.cancel')}
            variant="secondary"
            onPress={onClose}
          />
        </View>
      </View>
    </Modal>
  )
}

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
  const height = sizeTokens[theme.touch]
  return (
    <View
      testID={testID}
      accessibilityLiveRegion="polite"
      style={{
        position: 'absolute',
        left: space[4],
        right: space[4],
        bottom: space[4],
        minHeight: height,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: space[3],
        paddingHorizontal: space[4],
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: theme.colors.border.hairline,
        backgroundColor: theme.colors.bg.raised,
      }}
    >
      <Txt field="body" desk="body">
        {message}
      </Txt>
      {actionLabel && onAction ? (
        <Pressable
          accessibilityRole="button"
          onPress={onAction}
          style={{ minWidth: 88, height, justifyContent: 'center', alignItems: 'center' }}
        >
          <Txt field="bodyStrong" desk="label" color={theme.colors.accent.fg}>
            {actionLabel}
          </Txt>
        </Pressable>
      ) : null}
    </View>
  )
}

// ---------------------------------------------------------------------------
// 6.13 Avatar, TenantLogo, EmptyState, ErrorState, Skeleton
// ---------------------------------------------------------------------------

export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  const first = words[0]?.[0] ?? ''
  const second = words.length > 1 ? (words[words.length - 1]?.[0] ?? '') : ''
  return (first + second).toUpperCase()
}

export function Avatar({ name, size = 40, testID }: AvatarProps): React.JSX.Element {
  const theme = useTheme()
  return (
    <View
      testID={testID}
      style={{
        width: size,
        height: size,
        borderRadius: radius.full,
        backgroundColor: theme.colors.bg.sunken,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Txt field="bodyStrong" desk="label" style={{ fontSize: Math.round(size * 0.4) }}>
        {initialsOf(name)}
      </Txt>
    </View>
  )
}

const LOGO_BOX = { rail: 28, header: 32, card: 40 } as const

/**
 * A pre-signed logo URL lives 24 hours; a distributor whose window has closed, or whose object was
 * never uploaded, must not get a broken-image glyph in the chrome of EVERY screen. A failed load
 * falls back to the initials mark, which is the same thing an absent URL gets (UX-00 section 11).
 */
export function TenantLogo({
  size = 'header',
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
    <View
      testID={testID}
      style={{ flexDirection: 'row', alignItems: 'center', gap: space[2], minWidth: 0 }}
    >
      {url ? (
        <Image
          source={{ uri: url }}
          accessibilityLabel={theme.t('tenant.logoAlt', { name: displayName })}
          resizeMode="contain"
          onError={() => {
            setFailed(true)
          }}
          style={{ width: box, height: box, borderRadius: radius.sm }}
        />
      ) : (
        // No logo: the initials MARK — square, not round.
        <View
          style={{
            width: box,
            height: box,
            borderRadius: radius.sm,
            backgroundColor: theme.colors.bg.sunken,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Txt field="bodyStrong" desk="label" style={{ fontSize: Math.round(box * 0.42) }}>
            {initialsOf(displayName)}
          </Txt>
        </View>
      )}
      {withName ? (
        <View style={{ flexShrink: 1 }}>
          {/* Two lines for the name, one for the subtitle — see the web half for why. */}
          <Txt field="title" desk="railTitle" numberOfLines={2}>
            {displayName}
          </Txt>
          {subtitle ? (
            <Txt field="label" desk="meta" color={theme.colors.text.secondary} numberOfLines={1}>
              {subtitle}
            </Txt>
          ) : null}
        </View>
      ) : null}
    </View>
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
    <View testID={testID} style={{ padding: space[6], alignItems: 'center' }}>
      {icon}
      <Txt field="body" desk="body" color={theme.colors.text.secondary}>
        {message}
      </Txt>
      {actionLabel && onAction ? (
        <View style={{ marginTop: space[3], width: '100%' }}>
          <Button label={actionLabel} variant="secondary" onPress={onAction} />
        </View>
      ) : null}
    </View>
  )
}

export function ErrorState({
  message,
  detail,
  actionLabel,
  onAction,
  testID,
}: ErrorStateProps): React.JSX.Element {
  const theme = useTheme()
  return (
    <View
      testID={testID}
      style={{
        padding: space[5],
        borderRadius: radius.md,
        backgroundColor: theme.colors.status.brick.tint,
      }}
    >
      <Txt field="bodyStrong" desk="section" color={theme.colors.status.brick.fg}>
        {message}
      </Txt>
      {detail ? (
        <Txt field="label" desk="meta" color={theme.colors.text.secondary}>
          {detail}
        </Txt>
      ) : null}
      {actionLabel && onAction ? (
        <View style={{ marginTop: space[3] }}>
          <Button label={actionLabel} variant="secondary" onPress={onAction} />
        </View>
      ) : null}
    </View>
  )
}

export function Skeleton({ rows = 3, rowHeight = 72, testID }: SkeletonProps): React.JSX.Element {
  const theme = useTheme()
  return (
    <View testID={testID} accessibilityLabel={theme.t('state.loading')}>
      {Array.from({ length: rows }, (_, i) => (
        <View
          key={i}
          style={{
            height: rowHeight - 8,
            marginBottom: 8,
            borderRadius: radius.sm,
            backgroundColor: theme.colors.bg.skeleton,
          }}
        />
      ))}
    </View>
  )
}
