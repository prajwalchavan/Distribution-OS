/**
 * The job home for React DOM: `<JobCard>`, `<JobList>`, `<MoreGroup>` (founder, 2026-09-28: "every
 * app opens on its work, and nobody should need training"). The contract, and the one rule every
 * home follows, are in `../types.ts` §6.18; `@dos/ui/native` renders the same three names.
 *
 * THE CARD IS TWO TARGETS, NEVER ONE INSIDE THE OTHER. The body — what the job is, where, how much,
 * its state — is one button that opens the detail screen that exists today; the actions are real kit
 * `<Button>`s in a SIBLING block. A `<button>` inside a `<button>` is invalid HTML and a tap on the
 * inner one bubbles to the outer, which is exactly the "pressing Delivered also opened the stop"
 * failure the brief rules out. Siblings cannot bubble into each other.
 */
import { Children, isValidElement, useId, useState } from 'react'

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

function actionButton(action: JobAction, variant: 'primary' | 'secondary'): React.JSX.Element {
  return (
    <Button
      label={action.label}
      onPress={action.onPress}
      variant={variant}
      fullWidth
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
      <span
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: space[2],
          width: '100%',
          padding: `${String(space[2])}px ${String(space[4])}px`,
        }}
      >
        <Txt field="bodyStrong" desk="body" color={theme.colors.status.moss.fg}>
          ✓
        </Txt>
        <span style={{ flex: 1, minWidth: 0 }}>
          <Txt field="body" desk="body" color={theme.colors.text.secondary} numberOfLines={1}>
            {title}
          </Txt>
        </span>
        {chip === undefined ? null : (
          <Txt field="label" desk="meta" color={theme.colors.text.secondary}>
            {chip.label}
          </Txt>
        )}
      </span>
    )
    return onPress === undefined ? (
      <div data-testid={testID} data-state="done" style={{ minHeight: space[10] }}>
        {line}
      </div>
    ) : (
      <button
        type="button"
        data-testid={testID}
        data-state="done"
        className="dos-row"
        data-pressable="true"
        onClick={onPress}
        style={{
          minHeight: theme.touchSize,
          padding: 0,
          background: 'transparent',
          borderRadius: radius.md,
        }}
      >
        {line}
      </button>
    )
  }

  const bodyContent = (
    <>
      {next ? (
        <Txt
          field="eyebrow"
          desk="eyebrow"
          color={theme.colors.accent.fg}
          as="div"
          style={{ textTransform: 'uppercase', marginBottom: space[1] }}
        >
          {theme.t('job.next')}
        </Txt>
      ) : null}
      {/*
       * The name gets the whole width and two lines: on a 390 px phone a shop name beside a 20 sp
       * figure came out "Shree Ganesh…", and the name is the one thing a driver reads first. The
       * figure moves to the chip's line, at the right.
       */}
      <Txt field="title" desk="section" as="div" numberOfLines={2}>
        {title}
      </Txt>
      {subtitle === undefined ? null : (
        <Txt
          field="label"
          desk="meta"
          as="div"
          color={theme.colors.text.secondary}
          numberOfLines={1}
        >
          {subtitle}
        </Txt>
      )}
      {chip === undefined && trailing === undefined ? null : (
        <span
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: space[3],
            marginTop: space[2],
          }}
        >
          <span style={{ display: 'block', minWidth: 0 }}>
            {chip === undefined ? null : <StatusChip label={chip.label} family={chip.family} />}
          </span>
          {trailing === undefined ? null : (
            <span style={{ display: 'block', flexShrink: 0, textAlign: 'right' }}>{trailing}</span>
          )}
        </span>
      )}
    </>
  )

  const bodyPadding = `${String(space[4])}px ${String(space[4])}px ${String(space[3])}px`
  const body =
    onPress === undefined ? (
      <div style={{ padding: bodyPadding, flex: wide ? 1 : undefined, minWidth: 0 }}>
        {bodyContent}
      </div>
    ) : (
      <button
        type="button"
        className="dos-row"
        data-pressable="true"
        onClick={onPress}
        data-testid={testID === undefined ? undefined : `${testID}-open`}
        style={{
          display: 'block',
          padding: bodyPadding,
          minHeight: theme.touchSize,
          flex: wide ? 1 : undefined,
          minWidth: 0,
        }}
      >
        {bodyContent}
      </button>
    )

  const hasActions = primary !== undefined || extras.length > 0
  const actions = !hasActions ? null : wide ? (
    /* Desk: one row at the right, the next step last, where the eye ends. */
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: space[2],
        padding: space[4],
        flexShrink: 0,
      }}
    >
      {extras.map((action, i) => (
        <div key={`${action.label}-${String(i)}`}>{actionButton(action, 'secondary')}</div>
      ))}
      {primary === undefined ? null : <div>{actionButton(primary, 'primary')}</div>}
    </div>
  ) : (
    /* Phone: the next step full width under the thumb, the others sharing the row beneath. */
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: adjacent,
        padding: `${String(adjacent)}px ${String(space[4])}px ${String(space[4])}px`,
      }}
    >
      {primary === undefined ? null : actionButton(primary, 'primary')}
      {extras.length === 0 ? null : (
        <div style={{ display: 'flex', gap: adjacent, alignItems: 'flex-start' }}>
          {extras.map((action, i) => (
            <div key={`${action.label}-${String(i)}`} style={{ flex: '1 1 0', minWidth: 0 }}>
              {actionButton(action, 'secondary')}
            </div>
          ))}
        </div>
      )}
    </div>
  )

  return (
    <div
      data-testid={testID}
      data-state={state}
      style={{
        display: 'flex',
        flexDirection: wide ? 'row' : 'column',
        alignItems: wide ? 'center' : 'stretch',
        background: theme.colors.bg.surface,
        border: `1px solid ${next ? theme.colors.accent.line : theme.colors.border.faint}`,
        /* `next` carries the 3 px accent bar of a selected row (UX-00 §6.6): the one to do now. */
        borderLeft: `${next ? '4px' : '1px'} solid ${next ? theme.colors.accent.line : theme.colors.border.faint}`,
        borderRadius: radius.md,
        overflow: 'hidden',
      }}
    >
      {body}
      {actions}
    </div>
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
    <div data-testid={testID} style={{ display: 'flex', flexDirection: 'column', gap: space[3] }}>
      {summary === undefined || summary === null || summary === false ? null : typeof summary ===
          'string' || typeof summary === 'number' ? (
        <Txt field="label" desk="meta" as="div" color={theme.colors.text.secondary}>
          {summary}
        </Txt>
      ) : (
        <div>{summary}</div>
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
        /* 19 dp between cards (25 on a warehouse screen): the last button of one and the body of
           the next are adjacent targets (UX-00 §5.2). */
        <div role="list" style={{ display: 'flex', flexDirection: 'column', gap: adjacent }}>
          {items.map((item, i) => (
            <div
              role="listitem"
              key={isValidElement(item) && item.key !== null ? item.key : String(i)}
            >
              {item}
            </div>
          ))}
        </div>
      )}
    </div>
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
  const bodyId = useId()
  const [open, setOpen] = useState(() => moreGroupOpen(id, defaultOpen))
  const label = title ?? theme.t('job.more')
  const toggle = (): void => {
    const next = !open
    rememberMoreGroup(id, next)
    setOpen(next)
  }
  return (
    <div data-testid={testID} style={{ marginTop: space[6] }}>
      <button
        type="button"
        className="dos-row"
        data-pressable="true"
        aria-expanded={open}
        aria-controls={bodyId}
        aria-label={
          count === undefined ? label : theme.t('job.moreSpoken', { title: label, count })
        }
        onClick={toggle}
        data-testid={testID === undefined ? undefined : `${testID}-toggle`}
        style={{
          minHeight: theme.touchSize,
          padding: `0 ${String(space[4])}px`,
          gap: space[2],
          justifyContent: 'space-between',
          border: `1px solid ${theme.colors.border.faint}`,
          borderRadius: radius.md,
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: space[2] }}>
          <Txt field="bodyStrong" desk="section">
            {label}
          </Txt>
          {count === undefined ? null : (
            <StatusChip label={String(count)} family="neutral" figure />
          )}
        </span>
        <Txt field="bodyStrong" desk="label" color={theme.colors.accent.fg}>
          {`${theme.t(open ? 'job.hide' : 'job.show')} ${open ? '▴' : '▾'}`}
        </Txt>
      </button>
      {open ? (
        <div id={bodyId} style={{ marginTop: space[3] }}>
          {children}
        </div>
      ) : null}
    </div>
  )
}
