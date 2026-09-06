/**
 * `AppShell` for React DOM — UX-00 section 8.1 (desk) and section 8.2 (phone).
 *
 * The shell is chosen by VIEWPORT, not by app (docs/08 section 0). An owner on a phone gets bottom
 * tabs; a salesperson on a laptop gets the rail. One `AppShell` therefore serves all seven apps, and
 * the only thing an app supplies is data: sections of routes, which of them this role may see, the
 * distributor it is signed into, and the connection strip.
 *
 * Two navigation levels maximum (UX-00 section 8.1): level 1 is the rail (or the tab bar), level 2 is
 * the page's own tab row. There is no hamburger on a desktop viewport and no third level anywhere.
 */
import { useCallback, useMemo, useState } from 'react'

import { useStrings, useTheme } from '../theme.js'
import { layout, motion, size, space } from '../tokens.js'
import type { AppShellProps, NavItem, TenantSwitcherProps } from '../types.js'
import { Eyebrow, Txt } from './base.js'
import { Avatar, Sheet, TenantLogo } from './feedback.js'
import { useViewport } from './viewport.js'

// ---------------------------------------------------------------------------
// Tenant switcher
// ---------------------------------------------------------------------------

/**
 * The distributor this session is inside. One membership renders as a name and nothing more: a
 * shopkeeper who buys from three distributors gets a menu, a distributor's own staff never do.
 */
export function TenantSwitcher(props: TenantSwitcherProps): React.JSX.Element {
  const { colors } = useTheme()
  const { current, choices, onSwitch, busy = false, testID } = props
  const [open, setOpen] = useState(false)
  const many = choices.length > 1

  if (!many) {
    return (
      <div data-testid={testID} style={{ display: 'flex', alignItems: 'center', gap: space[2] }}>
        <TenantLogo size="rail" withName subtitle={current.roleLabel} name={current.name} />
      </div>
    )
  }

  return (
    <div data-testid={testID} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v)
        }}
        aria-expanded={open}
        aria-haspopup="menu"
        disabled={busy}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: space[2],
          background: 'transparent',
          border: 0,
          padding: space[1],
          borderRadius: 6,
          cursor: busy ? 'progress' : 'pointer',
          font: 'inherit',
          color: 'inherit',
          minHeight: size.desk,
        }}
      >
        <TenantLogo size="rail" withName subtitle={current.roleLabel} name={current.name} />
        <Txt field="label" desk="meta" color={colors.text.secondary}>
          ▾
        </Txt>
      </button>
      {open ? (
        <div
          role="menu"
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            marginTop: space[1],
            minWidth: 220,
            background: colors.bg.surface,
            border: `1px solid ${colors.border.hairline}`,
            borderRadius: 8,
            boxShadow: '0 4px 16px rgba(27,30,26,0.12)',
            zIndex: 30,
            overflow: 'hidden',
          }}
        >
          {choices.map((choice) => (
            <button
              key={choice.id}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false)
                if (choice.id !== current.id) onSwitch(choice.id)
              }}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: `${space[2]}px ${space[3]}px`,
                minHeight: 44,
                background: choice.id === current.id ? colors.accent.tint : 'transparent',
                border: 0,
                cursor: 'pointer',
                font: 'inherit',
              }}
            >
              <Txt field="body" desk="body" as="div">
                {choice.name}
              </Txt>
              <Txt field="label" desk="meta" color={colors.text.secondary} as="div">
                {choice.roleLabel}
              </Txt>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// AppShell
// ---------------------------------------------------------------------------

function isActive(activeHref: string, href: string): boolean {
  if (href === '/') return activeHref === '/'
  return activeHref === href || activeHref.startsWith(`${href}/`)
}

export function AppShell(props: AppShellProps): React.JSX.Element {
  const viewport = useViewport()
  const allowed = useCallback(
    (item: NavItem) => (props.can ? props.can(item) : true),
    [props.can],
  )
  const sections = useMemo(
    () =>
      props.sections
        .map((section) => ({ ...section, items: section.items.filter(allowed) }))
        .filter((section) => section.items.length > 0),
    [props.sections, allowed],
  )
  return viewport.kind === 'desk' ? (
    <DeskShell {...props} sections={sections} collapsed={viewport.railCollapsed} />
  ) : (
    <PhoneShell {...props} sections={sections} />
  )
}

// --- desk (UX-00 section 8.1) ----------------------------------------------

function DeskShell({
  sections,
  activeHref,
  onNavigate,
  tenant,
  connection,
  search,
  account,
  children,
  testID,
}: AppShellProps & { collapsed: boolean }): React.JSX.Element {
  const { colors } = useTheme()
  const t = useStrings()
  const [menu, setMenu] = useState(false)

  return (
    <div
      data-testid={testID}
      style={{ display: 'flex', height: '100%', minHeight: '100dvh', background: colors.bg.ground }}
    >
      <nav
        className="dos-no-print"
        aria-label={t('nav.sections')}
        style={{
          width: layout.railWidth,
          flex: `0 0 ${layout.railWidth}px`,
          background: colors.bg.surface,
          borderRight: `1px solid ${colors.border.hairline}`,
          display: 'flex',
          flexDirection: 'column',
          padding: space[3],
          gap: space[3],
          position: 'sticky',
          top: 0,
          height: '100dvh',
          boxSizing: 'border-box',
        }}
      >
        {tenant ? <TenantSwitcher {...tenant} /> : null}
        <div style={{ height: 1, background: colors.border.faint }} />
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: space[4] }}>
          {sections.map((section, index) => (
            <div key={section.title ?? `section-${String(index)}`}>
              {section.title === undefined ? null : (
                <div style={{ marginBottom: space[1] }}>
                  <Eyebrow>{section.title}</Eyebrow>
                </div>
              )}
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {section.items.map((item) => {
                  const active = isActive(activeHref, item.href)
                  return (
                    <li key={item.href}>
                      <a
                        href={item.href}
                        aria-current={active ? 'page' : undefined}
                        onClick={(event) => {
                          if (event.metaKey || event.ctrlKey || event.shiftKey) return
                          event.preventDefault()
                          onNavigate(item.href)
                        }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: space[2],
                          height: 32,
                          padding: `0 ${String(space[2])}px`,
                          borderRadius: 6,
                          textDecoration: 'none',
                          background: active ? colors.accent.tint : 'transparent',
                          color: active ? colors.accent.fg : colors.text.primary,
                          fontWeight: active ? 600 : 400,
                          transition: `background-color ${String(motion.duration.micro)}ms ${motion.easing.micro}`,
                        }}
                      >
                        {item.icon}
                        <span style={{ flex: 1, fontSize: 14, lineHeight: '20px' }}>
                          {item.label}
                        </span>
                        {item.badge === undefined || item.badge === 0 ? null : (
                          <Txt field="label" desk="meta" numeric color={colors.text.secondary}>
                            {item.badge}
                          </Txt>
                        )}
                      </a>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </div>
        {connection}
      </nav>

      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        {search !== undefined || account !== undefined ? (
          <header
            className="dos-no-print"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: space[3],
              padding: `${space[2]}px ${space[5]}px`,
              borderBottom: `1px solid ${colors.border.hairline}`,
              background: colors.bg.surface,
            }}
          >
            <div style={{ flex: 1, maxWidth: 420 }}>{search}</div>
            {account === undefined ? null : (
              <div style={{ position: 'relative' }}>
                <button
                  type="button"
                  onClick={() => {
                    setMenu((v) => !v)
                  }}
                  aria-haspopup="menu"
                  aria-expanded={menu}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: space[2],
                    background: 'transparent',
                    border: 0,
                    cursor: 'pointer',
                    font: 'inherit',
                    minHeight: size.desk,
                  }}
                >
                  <Avatar name={account.name} size={32} />
                  <span style={{ textAlign: 'left' }}>
                    <Txt field="label" desk="label" as="div">
                      {account.name}
                    </Txt>
                    <Txt field="label" desk="meta" color={colors.text.secondary} as="div">
                      {account.roleLabel}
                    </Txt>
                  </span>
                </button>
                {menu ? (
                  <div
                    role="menu"
                    style={{
                      position: 'absolute',
                      right: 0,
                      top: '100%',
                      marginTop: space[1],
                      minWidth: 200,
                      background: colors.bg.surface,
                      border: `1px solid ${colors.border.hairline}`,
                      borderRadius: 8,
                      boxShadow: '0 4px 16px rgba(27,30,26,0.12)',
                      zIndex: 30,
                      overflow: 'hidden',
                    }}
                  >
                    {(account.items ?? []).map((entry) => (
                      <MenuRow
                        key={entry.id}
                        label={entry.label}
                        onPress={() => {
                          setMenu(false)
                          entry.onPress()
                        }}
                      />
                    ))}
                    <MenuRow
                      label={t('account.signOut')}
                      onPress={() => {
                        setMenu(false)
                        account.onSignOut()
                      }}
                    />
                  </div>
                ) : null}
              </div>
            )}
          </header>
        ) : null}
        <main style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          {children}
        </main>
      </div>
    </div>
  )
}

function MenuRow({ label, onPress }: { label: string; onPress: () => void }): React.JSX.Element {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onPress}
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        padding: `${space[2]}px ${space[3]}px`,
        minHeight: 44,
        background: 'transparent',
        border: 0,
        cursor: 'pointer',
        font: 'inherit',
      }}
    >
      {label}
    </button>
  )
}

// --- phone (UX-00 section 8.2) ---------------------------------------------

function PhoneShell({
  sections,
  activeHref,
  onNavigate,
  tenant,
  connection,
  search,
  account,
  children,
  testID,
}: AppShellProps): React.JSX.Element {
  const { colors, touchSize } = useTheme()
  const t = useStrings()
  const [sheet, setSheet] = useState(false)

  const primary = sections.find((section) => section.primary === true) ?? sections[0]
  const tabs = (primary?.items ?? []).slice(0, 4)
  const overflow = sections.flatMap((section) =>
    section.items.filter((item) => !tabs.some((tab) => tab.href === item.href)),
  )

  return (
    <div
      data-testid={testID}
      style={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: '100dvh',
        background: colors.bg.ground,
      }}
    >
      <header
        className="dos-no-print"
        style={{
          background: colors.bg.surface,
          borderBottom: `1px solid ${colors.border.hairline}`,
          padding: `${space[2]}px ${space[4]}px`,
          paddingTop: `calc(${String(space[2])}px + env(safe-area-inset-top, 0px))`,
          display: 'flex',
          alignItems: 'center',
          gap: space[2],
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          {tenant ? <TenantSwitcher {...tenant} /> : null}
        </div>
        <button
          type="button"
          aria-label={t('nav.more')}
          onClick={() => {
            setSheet(true)
          }}
          style={{
            minWidth: touchSize,
            minHeight: touchSize,
            background: 'transparent',
            border: 0,
            cursor: 'pointer',
            fontSize: 20,
          }}
        >
          ⋯
        </button>
      </header>
      {connection === undefined ? null : (
        <div style={{ padding: `0 ${String(space[4])}px` }}>{connection}</div>
      )}

      <main style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {children}
      </main>

      {tabs.length > 0 ? (
        <nav
          className="dos-no-print"
          aria-label={t('nav.sections')}
          style={{
            display: 'flex',
            background: colors.bg.surface,
            borderTop: `1px solid ${colors.border.hairline}`,
            paddingBottom: 'env(safe-area-inset-bottom, 0px)',
            position: 'sticky',
            bottom: 0,
          }}
        >
          {tabs.map((item) => {
            const active = isActive(activeHref, item.href)
            return (
              <a
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                onClick={(event) => {
                  event.preventDefault()
                  onNavigate(item.href)
                }}
                style={{
                  flex: 1,
                  minHeight: touchSize,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 2,
                  textDecoration: 'none',
                  color: active ? colors.accent.fg : colors.text.secondary,
                  fontWeight: active ? 600 : 500,
                  fontSize: 14,
                }}
              >
                {active ? (item.activeIcon ?? item.icon) : item.icon}
                <span>{item.label}</span>
              </a>
            )
          })}
        </nav>
      ) : null}

      <Sheet
        open={sheet}
        onClose={() => {
          setSheet(false)
        }}
        title={t('nav.more')}
      >
        {search === undefined ? null : (
          <div style={{ marginBottom: space[3] }}>{search}</div>
        )}
        {overflow.map((item) => (
          <MenuRow
            key={item.href}
            label={item.label}
            onPress={() => {
              setSheet(false)
              onNavigate(item.href)
            }}
          />
        ))}
        {account === undefined ? null : (
          <>
            {(account.items ?? []).map((entry) => (
              <MenuRow
                key={entry.id}
                label={entry.label}
                onPress={() => {
                  setSheet(false)
                  entry.onPress()
                }}
              />
            ))}
            <MenuRow
              label={t('account.signOut')}
              onPress={() => {
                setSheet(false)
                account.onSignOut()
              }}
            />
          </>
        )}
      </Sheet>
    </div>
  )
}
