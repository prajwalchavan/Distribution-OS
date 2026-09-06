/**
 * `AppShell` for React Native — the same contract as the web renderer's, the same two shells.
 *
 * The viewport decides, not the platform (docs/08 section 0): a phone gets the bottom tabs of UX-00
 * section 8.2, and a tablet in landscape gets the rail of section 8.1 from the same screen files.
 */
import { useCallback, useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { useStrings, useTheme } from '../theme.js'
import { layout, space } from '../tokens.js'
import type { AppShellProps, NavItem, TenantSwitcherProps } from '../types.js'
import { Eyebrow, Txt } from './base.js'
import { Avatar, Sheet, TenantLogo } from './feedback.js'
import { useViewport } from './viewport.js'

// ---------------------------------------------------------------------------
// Tenant switcher
// ---------------------------------------------------------------------------

export function TenantSwitcher(props: TenantSwitcherProps): React.JSX.Element {
  const { colors } = useTheme()
  const t = useStrings()
  const { current, choices, onSwitch, busy = false, testID } = props
  const [open, setOpen] = useState(false)
  const many = choices.length > 1

  if (!many) {
    return (
      <View testID={testID}>
        <TenantLogo size="header" withName subtitle={current.roleLabel} name={current.name} />
      </View>
    )
  }

  return (
    <View testID={testID}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('tenant.switch')}
        accessibilityState={{ expanded: open, disabled: busy }}
        disabled={busy}
        onPress={() => {
          setOpen(true)
        }}
        style={styles.switcher}
      >
        <TenantLogo size="header" withName subtitle={current.roleLabel} name={current.name} />
        <Txt field="label" desk="meta" color={colors.text.secondary}>
          ▾
        </Txt>
      </Pressable>
      <Sheet
        open={open}
        onClose={() => {
          setOpen(false)
        }}
        title={t('tenant.switch')}
      >
        {choices.map((choice) => (
          <MenuRow
            key={choice.id}
            label={choice.name}
            secondary={choice.roleLabel}
            selected={choice.id === current.id}
            onPress={() => {
              setOpen(false)
              if (choice.id !== current.id) onSwitch(choice.id)
            }}
          />
        ))}
      </Sheet>
    </View>
  )
}

function MenuRow({
  label,
  secondary,
  selected = false,
  onPress,
}: {
  label: string
  secondary?: string | undefined
  selected?: boolean | undefined
  onPress: () => void
}): React.JSX.Element {
  const { colors, touchSize } = useTheme()
  return (
    <Pressable
      accessibilityRole="menuitem"
      onPress={onPress}
      style={({ pressed }) => [
        styles.menuRow,
        {
          minHeight: touchSize,
          backgroundColor: selected
            ? colors.accent.tint
            : pressed
              ? colors.bg.raised
              : 'transparent',
        },
      ]}
    >
      <Txt field="body" desk="body">
        {label}
      </Txt>
      {secondary === undefined ? null : (
        <Txt field="label" desk="meta" color={colors.text.secondary}>
          {secondary}
        </Txt>
      )}
    </Pressable>
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
  const allowed = useCallback((item: NavItem) => (props.can ? props.can(item) : true), [props.can])
  const sections = useMemo(
    () =>
      props.sections
        .map((section) => ({ ...section, items: section.items.filter(allowed) }))
        .filter((section) => section.items.length > 0),
    [props.sections, allowed],
  )
  return viewport.kind === 'desk' ? (
    <DeskShell {...props} sections={sections} />
  ) : (
    <PhoneShell {...props} sections={sections} />
  )
}

// --- desk (a tablet in landscape) ------------------------------------------

function DeskShell({
  sections,
  activeHref,
  onNavigate,
  tenant,
  connection,
  account,
  children,
  testID,
}: AppShellProps): React.JSX.Element {
  const { colors } = useTheme()
  const t = useStrings()
  const insets = useSafeAreaInsets()
  const [menu, setMenu] = useState(false)

  return (
    <View testID={testID} style={[styles.deskRoot, { backgroundColor: colors.bg.ground }]}>
      <View
        style={[
          styles.rail,
          {
            backgroundColor: colors.bg.surface,
            borderRightColor: colors.border.hairline,
            paddingTop: insets.top + space[3],
            paddingBottom: insets.bottom + space[3],
          },
        ]}
      >
        {tenant ? <TenantSwitcher {...tenant} /> : null}
        <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border.faint }} />
        <ScrollView contentContainerStyle={styles.railList}>
          {sections.map((section, index) => (
            <View key={section.title ?? `section-${String(index)}`}>
              {section.title === undefined ? null : <Eyebrow>{section.title}</Eyebrow>}
              {section.items.map((item) => {
                const active = isActive(activeHref, item.href)
                return (
                  <Pressable
                    key={item.href}
                    accessibilityRole="link"
                    accessibilityState={{ selected: active }}
                    onPress={() => {
                      onNavigate(item.href)
                    }}
                    style={[
                      styles.railItem,
                      { backgroundColor: active ? colors.accent.tint : 'transparent' },
                    ]}
                  >
                    {item.icon}
                    <Txt
                      field="body"
                      desk={active ? 'navActive' : 'nav'}
                      color={active ? colors.accent.fg : colors.text.primary}
                    >
                      {item.label}
                    </Txt>
                  </Pressable>
                )
              })}
            </View>
          ))}
        </ScrollView>
        {connection}
        {account === undefined ? null : (
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setMenu(true)
            }}
            style={styles.account}
          >
            <Avatar name={account.name} size={32} />
            <View>
              <Txt field="label" desk="label">
                {account.name}
              </Txt>
              <Txt field="label" desk="meta" color={colors.text.secondary}>
                {account.roleLabel}
              </Txt>
            </View>
          </Pressable>
        )}
      </View>
      <View style={styles.grow}>{children}</View>
      {account === undefined ? null : (
        <Sheet
          open={menu}
          onClose={() => {
            setMenu(false)
          }}
          title={account.name}
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
        </Sheet>
      )}
    </View>
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
  const insets = useSafeAreaInsets()
  const [sheet, setSheet] = useState(false)

  const primary = sections.find((section) => section.primary === true) ?? sections[0]
  const tabs = (primary?.items ?? []).slice(0, 4)
  const overflow = sections.flatMap((section) =>
    section.items.filter((item) => !tabs.some((tab) => tab.href === item.href)),
  )

  return (
    <View testID={testID} style={[styles.grow, { backgroundColor: colors.bg.ground }]}>
      <View
        style={[
          styles.phoneHeader,
          {
            backgroundColor: colors.bg.surface,
            borderBottomColor: colors.border.hairline,
            paddingTop: insets.top + space[2],
          },
        ]}
      >
        <View style={styles.grow}>{tenant ? <TenantSwitcher {...tenant} /> : null}</View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('nav.more')}
          onPress={() => {
            setSheet(true)
          }}
          style={{ minWidth: touchSize, minHeight: touchSize, justifyContent: 'center' }}
        >
          <Txt field="title" desk="pageTitle">
            ⋯
          </Txt>
        </Pressable>
      </View>
      {connection === undefined ? null : <View style={styles.connection}>{connection}</View>}

      <View style={styles.grow}>{children}</View>

      {tabs.length > 0 ? (
        <View
          style={[
            styles.tabBar,
            {
              backgroundColor: colors.bg.surface,
              borderTopColor: colors.border.hairline,
              paddingBottom: insets.bottom,
            },
          ]}
        >
          {tabs.map((item) => {
            const active = isActive(activeHref, item.href)
            return (
              <Pressable
                key={item.href}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                onPress={() => {
                  onNavigate(item.href)
                }}
                style={[styles.tab, { minHeight: touchSize }]}
              >
                {active ? (item.activeIcon ?? item.icon) : item.icon}
                <Txt
                  field="label"
                  desk="label"
                  color={active ? colors.accent.fg : colors.text.secondary}
                >
                  {item.label}
                </Txt>
              </Pressable>
            )
          })}
        </View>
      ) : null}

      <Sheet
        open={sheet}
        onClose={() => {
          setSheet(false)
        }}
        title={t('nav.more')}
      >
        {search}
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
    </View>
  )
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  deskRoot: { flex: 1, flexDirection: 'row' },
  rail: {
    width: layout.railWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space[3],
    gap: space[3],
  },
  railList: { gap: space[4], paddingBottom: space[4] },
  railItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    height: 40,
    paddingHorizontal: space[2],
    borderRadius: 6,
  },
  switcher: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  menuRow: { paddingHorizontal: space[3], paddingVertical: space[2], justifyContent: 'center' },
  account: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  phoneHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    paddingHorizontal: space[4],
    paddingBottom: space[2],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  connection: { paddingHorizontal: space[4] },
  tabBar: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2 },
})
