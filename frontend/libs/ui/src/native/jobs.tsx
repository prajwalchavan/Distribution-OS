/**
 * The job home for React Native: `<JobCard>`, `<JobList>`, `<MoreGroup>` — the same three names,
 * props and rules as `../web/jobs.tsx`, whose header carries the argument (founder, 2026-09-28).
 *
 * The card is two SIBLING targets here too: the body is one `Pressable` that opens the detail, the
 * actions are kit `<Button>`s beside it, never inside it. React Native would let the inner press win
 * over an outer one, but "never inside" is what keeps the two renderers one component.
 */
import { Children, isValidElement, useState } from 'react'
import { Pressable, View } from 'react-native'

import { moreGroupOpen, rememberMoreGroup, visibleSecondaries } from '../shop-blocks.js'
import { useTheme } from '../theme.js'
import { gap, radius, space } from '../tokens.js'
import type { JobAction, JobCardProps, JobListProps, MoreGroupProps } from '../types.js'
import { Txt } from './base.js'
import { Button } from './controls.js'
import { EmptyState, Skeleton } from './feedback.js'
import { StatusChip } from './list.js'
import { useViewport } from './viewport.js'

/** UX-00 §5.2: 19 dp between adjacent targets, 25 on every warehouse screen. */
function useAdjacentGap(): number {
  const { touch } = useTheme()
  return touch === 'floor' ? gap.warehouse : gap.adjacent
}

function actionButton(
  action: JobAction,
  variant: 'primary' | 'secondary',
  fullWidth: boolean,
): React.JSX.Element {
  return (
    <Button
      label={action.label}
      onPress={action.onPress}
      variant={variant}
      fullWidth={fullWidth}
      disabled={action.disabled}
      disabledReason={action.disabledReason}
      loading={action.loading}
      testID={action.testID}
    />
  )
}

// ---------------------------------------------------------------------------
// JobCard
// ---------------------------------------------------------------------------

export function JobCard({
  title,
  subtitle,
  trailing,
  chip,
  state = 'default',
  onPress,
  primary,
  secondary,
  testID,
}: JobCardProps): React.JSX.Element {
  const theme = useTheme()
  const viewport = useViewport()
  const adjacent = useAdjacentGap()
  const wide = viewport.kind === 'desk'
  const extras = visibleSecondaries(secondary)
  const next = state === 'next'

  if (state === 'done') {
    /* One quiet line: the tick, the name, the state word. Still opens the detail when it can. */
    const line = (
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: space[2],
          paddingHorizontal: space[4],
          paddingVertical: space[2],
        }}
      >
        <Txt field="bodyStrong" desk="body" color={theme.colors.status.moss.fg}>
          ✓
        </Txt>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt field="body" desk="body" color={theme.colors.text.secondary} numberOfLines={1}>
            {title}
          </Txt>
        </View>
        {chip === undefined ? null : (
          <Txt field="label" desk="meta" color={theme.colors.text.secondary}>
            {chip.label}
          </Txt>
        )}
      </View>
    )
    return onPress === undefined ? (
      <View testID={testID}>{line}</View>
    ) : (
      <Pressable
        testID={testID}
        accessibilityRole="button"
        onPress={onPress}
        style={({ pressed }) => ({
          minHeight: theme.touchSize,
          justifyContent: 'center',
          borderRadius: radius.md,
          backgroundColor: pressed ? theme.colors.bg.raised : 'transparent',
        })}
      >
        {line}
      </Pressable>
    )
  }

  const bodyContent = (
    <View>
      {next ? (
        <Txt
          field="eyebrow"
          desk="eyebrow"
          color={theme.colors.accent.fg}
          style={{ textTransform: 'uppercase', marginBottom: space[1] }}
        >
          {theme.t('job.next')}
        </Txt>
      ) : null}
      {/* The name gets the whole width and two lines; the figure sits on the chip's line — see the web half. */}
      <Txt field="title" desk="section" numberOfLines={2}>
        {title}
      </Txt>
      {subtitle === undefined ? null : (
        <Txt field="label" desk="meta" color={theme.colors.text.secondary} numberOfLines={1}>
          {subtitle}
        </Txt>
      )}
      {chip === undefined && trailing === undefined ? null : (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: space[3],
            marginTop: space[2],
          }}
        >
          <View style={{ flexShrink: 1, minWidth: 0 }}>
            {chip === undefined ? null : <StatusChip label={chip.label} family={chip.family} />}
          </View>
          {trailing === undefined ? null : (
            <View style={{ alignItems: 'flex-end' }}>{trailing}</View>
          )}
        </View>
      )}
    </View>
  )

  const bodyPadding = {
    paddingTop: space[4],
    paddingHorizontal: space[4],
    paddingBottom: space[3],
  }
  const body =
    onPress === undefined ? (
      <View style={[bodyPadding, wide ? { flex: 1 } : null]}>{bodyContent}</View>
    ) : (
      <Pressable
        testID={testID === undefined ? undefined : `${testID}-open`}
        accessibilityRole="button"
        onPress={onPress}
        style={({ pressed }) => [
          bodyPadding,
          {
            minHeight: theme.touchSize,
            backgroundColor: pressed ? theme.colors.bg.raised : theme.colors.bg.surface,
          },
          wide ? { flex: 1 } : null,
        ]}
      >
        {bodyContent}
      </Pressable>
    )

  const hasActions = primary !== undefined || extras.length > 0
  const actions = !hasActions ? null : wide ? (
    <View
      style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space[2], padding: space[4] }}
    >
      {extras.map((action, i) => (
        <View key={`${action.label}-${String(i)}`}>{actionButton(action, 'secondary', false)}</View>
      ))}
      {primary === undefined ? null : <View>{actionButton(primary, 'primary', false)}</View>}
    </View>
  ) : (
    <View
      style={{
        gap: adjacent,
        paddingTop: adjacent,
        paddingHorizontal: space[4],
        paddingBottom: space[4],
      }}
    >
      {primary === undefined ? null : actionButton(primary, 'primary', true)}
      {extras.length === 0 ? null : (
        <View style={{ flexDirection: 'row', gap: adjacent, alignItems: 'flex-start' }}>
          {extras.map((action, i) => (
            <View key={`${action.label}-${String(i)}`} style={{ flex: 1, minWidth: 0 }}>
              {actionButton(action, 'secondary', true)}
            </View>
          ))}
        </View>
      )}
    </View>
  )

  return (
    <View
      testID={testID}
      style={{
        flexDirection: wide ? 'row' : 'column',
        alignItems: wide ? 'center' : 'stretch',
        backgroundColor: theme.colors.bg.surface,
        borderWidth: 1,
        borderColor: next ? theme.colors.accent.line : theme.colors.border.faint,
        borderLeftWidth: next ? 4 : 1,
        borderRadius: radius.md,
        overflow: 'hidden',
      }}
    >
      {body}
      {actions}
    </View>
  )
}

// ---------------------------------------------------------------------------
// JobList
// ---------------------------------------------------------------------------

export function JobList({
  summary,
  children,
  loading = false,
  emptyMessage,
  emptyActionLabel,
  onEmptyAction,
  testID,
}: JobListProps): React.JSX.Element {
  const theme = useTheme()
  const adjacent = useAdjacentGap()
  const items = Children.toArray(children)
  return (
    <View testID={testID} style={{ gap: space[3] }}>
      {summary === undefined || summary === null || summary === false ? null : typeof summary ===
          'string' || typeof summary === 'number' ? (
        <Txt field="label" desk="meta" color={theme.colors.text.secondary}>
          {summary}
        </Txt>
      ) : (
        <View>{summary}</View>
      )}
      {loading ? (
        <Skeleton rows={3} rowHeight={theme.density === 'desk' ? 88 : 168} />
      ) : items.length === 0 ? (
        <EmptyState
          message={emptyMessage ?? theme.t('job.nothingWaiting')}
          {...(emptyActionLabel !== undefined && onEmptyAction !== undefined
            ? { actionLabel: emptyActionLabel, onAction: onEmptyAction }
            : {})}
        />
      ) : (
        <View accessibilityRole="list" style={{ gap: adjacent }}>
          {items.map((item, i) => (
            <View key={isValidElement(item) && item.key !== null ? item.key : String(i)}>
              {item}
            </View>
          ))}
        </View>
      )}
    </View>
  )
}

// ---------------------------------------------------------------------------
// MoreGroup
// ---------------------------------------------------------------------------

export function MoreGroup({
  id,
  title,
  count,
  defaultOpen = false,
  children,
  testID,
}: MoreGroupProps): React.JSX.Element {
  const theme = useTheme()
  const [open, setOpen] = useState(() => moreGroupOpen(id, defaultOpen))
  const label = title ?? theme.t('job.more')
  const toggle = (): void => {
    const next = !open
    rememberMoreGroup(id, next)
    setOpen(next)
  }
  return (
    <View testID={testID} style={{ marginTop: space[6] }}>
      <Pressable
        testID={testID === undefined ? undefined : `${testID}-toggle`}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={
          count === undefined ? label : theme.t('job.moreSpoken', { title: label, count })
        }
        onPress={toggle}
        style={({ pressed }) => ({
          minHeight: theme.touchSize,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: space[2],
          paddingHorizontal: space[4],
          borderWidth: 1,
          borderColor: theme.colors.border.faint,
          borderRadius: radius.md,
          backgroundColor: pressed ? theme.colors.bg.raised : theme.colors.bg.surface,
        })}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
          <Txt field="bodyStrong" desk="section">
            {label}
          </Txt>
          {count === undefined ? null : (
            <StatusChip label={String(count)} family="neutral" figure />
          )}
        </View>
        <Txt field="bodyStrong" desk="label" color={theme.colors.accent.fg}>
          {`${theme.t(open ? 'job.hide' : 'job.show')} ${open ? '▴' : '▾'}`}
        </Txt>
      </Pressable>
      {open ? <View style={{ marginTop: space[3] }}>{children}</View> : null}
    </View>
  )
}
