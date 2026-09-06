/**
 * The layout vocabulary of docs/08 section 0, for React Native.
 *
 * Every name and every prop type is the web renderer's (`src/types.ts`), so one screen file lays out
 * identically on both. What differs is spent where a phone needs it: `FlatList` windowing rather than
 * a DOM spacer, `SafeAreaView` insets from the first frame, and a press feedback the OS recognises.
 */
import { useCallback, useMemo } from 'react'
import {
  FlatList,
  Image,
  Pressable as RNPressable,
  ScrollView,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { useTheme } from '../theme.js'
import { layout, radius as radii, space, type SemanticColors } from '../tokens.js'
import type {
  BorderEdge,
  BorderTone,
  BoxProps,
  ImgProps,
  LinkProps,
  ListProps,
  PressableProps,
  RadiusName,
  RowProps,
  ScreenProps,
  ScrollProps,
  SpaceStep,
  StackProps,
  SurfaceName,
} from '../types.js'
import { Txt } from './base.js'

// ---------------------------------------------------------------------------
// Token readers — identical semantics to the web renderer's
// ---------------------------------------------------------------------------

function px(step: SpaceStep | undefined): number | undefined {
  return step === undefined ? undefined : space[step]
}

function surface(colors: SemanticColors, name: SurfaceName | undefined): string | undefined {
  switch (name) {
    case 'ground':
      return colors.bg.ground
    case 'surface':
      return colors.bg.surface
    case 'raised':
      return colors.bg.raised
    case 'sunken':
      return colors.bg.sunken
    default:
      return undefined
  }
}

function corner(name: RadiusName | undefined): number | undefined {
  if (name === undefined || name === 'none') return undefined
  return radii[name]
}

function borderColor(colors: SemanticColors, tone: BorderTone | undefined): string {
  if (tone === 'strong') return colors.border.strong
  if (tone === 'faint') return colors.border.faint
  return colors.border.hairline
}

function borderStyle(
  colors: SemanticColors,
  edge: BorderEdge | undefined,
  tone: BorderTone | undefined,
): ViewStyle {
  if (edge === undefined || edge === 'none') return {}
  const width = StyleSheet.hairlineWidth
  const borderColorValue = borderColor(colors, tone)
  switch (edge) {
    case 'all':
      return { borderWidth: width, borderColor: borderColorValue }
    case 'top':
      return { borderTopWidth: width, borderTopColor: borderColorValue }
    case 'bottom':
      return { borderBottomWidth: width, borderBottomColor: borderColorValue }
    case 'left':
      return { borderLeftWidth: width, borderLeftColor: borderColorValue }
    case 'right':
      return { borderRightWidth: width, borderRightColor: borderColorValue }
  }
}

const ALIGN = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  stretch: 'stretch',
} as const

const JUSTIFY = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  between: 'space-between',
} as const

function boxStyle(colors: SemanticColors, props: BoxProps): ViewStyle {
  const padAll = px(props.pad)
  return {
    paddingTop: px(props.padY) ?? padAll,
    paddingBottom: px(props.padY) ?? padAll,
    paddingLeft: px(props.padX) ?? padAll,
    paddingRight: px(props.padX) ?? padAll,
    marginTop: px(props.marginTop),
    backgroundColor: surface(colors, props.background),
    borderRadius: corner(props.radius),
    flexGrow: props.grow === true ? 1 : undefined,
    flexShrink: props.grow === true ? 1 : undefined,
    flexBasis: props.grow === true ? 0 : undefined,
    width: props.width === 'full' ? '100%' : props.width,
    height: props.height,
    minHeight: props.minHeight,
    maxWidth: props.maxWidth,
    alignSelf: props.align === undefined ? undefined : ALIGN[props.align],
    marginHorizontal: props.center === true ? 'auto' : undefined,
    ...borderStyle(colors, props.border, props.borderTone),
  }
}

// ---------------------------------------------------------------------------
// Box, Stack, Row
// ---------------------------------------------------------------------------

export function Box(props: BoxProps): React.JSX.Element {
  const { colors } = useTheme()
  return (
    <View testID={props.testID} style={boxStyle(colors, props)}>
      {props.children}
    </View>
  )
}

export function Stack(props: StackProps): React.JSX.Element {
  const { colors } = useTheme()
  return (
    <View
      testID={props.testID}
      style={[
        boxStyle(colors, props),
        {
          flexDirection: 'column',
          gap: px(props.gap),
          alignItems: props.align === undefined ? undefined : ALIGN[props.align],
        },
      ]}
    >
      {props.children}
    </View>
  )
}

export function Row(props: RowProps): React.JSX.Element {
  const { colors } = useTheme()
  return (
    <View
      testID={props.testID}
      style={[
        boxStyle(colors, props),
        {
          flexDirection: 'row',
          gap: px(props.gap),
          alignItems: ALIGN[props.align ?? 'center'],
          justifyContent: props.justify === undefined ? undefined : JUSTIFY[props.justify],
          flexWrap: props.wrap === true ? 'wrap' : undefined,
        },
      ]}
    >
      {props.children}
    </View>
  )
}

// ---------------------------------------------------------------------------
// Scroll
// ---------------------------------------------------------------------------

export function Scroll(props: ScrollProps): React.JSX.Element {
  return (
    <ScrollView
      testID={props.testID}
      horizontal={props.horizontal === true}
      style={props.grow === true ? styles.grow : undefined}
      contentContainerStyle={{ padding: px(props.pad) }}
      onScroll={
        props.onEndReached
          ? ({ nativeEvent }) => {
              const { layoutMeasurement, contentOffset, contentSize } = nativeEvent
              const axisOffset = props.horizontal === true ? contentOffset.x : contentOffset.y
              const axisLayout =
                props.horizontal === true ? layoutMeasurement.width : layoutMeasurement.height
              const axisContent =
                props.horizontal === true ? contentSize.width : contentSize.height
              if (axisContent - axisOffset - axisLayout < axisLayout * 0.5) props.onEndReached?.()
            }
          : undefined
      }
      scrollEventThrottle={200}
      keyboardShouldPersistTaps="handled"
    >
      {props.children}
    </ScrollView>
  )
}

// ---------------------------------------------------------------------------
// List — FlatList, the native half of the virtualisation contract
// ---------------------------------------------------------------------------

export function List<Item>(props: ListProps<Item>): React.JSX.Element {
  const {
    items,
    keyExtractor,
    renderItem,
    itemHeight = 64,
    onEndReached,
    separator = false,
    header,
    footer,
    empty,
    grow = true,
    testID,
  } = props
  const { colors } = useTheme()

  const getItemLayout = useMemo(
    () =>
      (_data: ArrayLike<Item> | null | undefined, index: number) => ({
        length: itemHeight,
        offset: itemHeight * index,
        index,
      }),
    [itemHeight],
  )

  const Separator = useCallback(
    () => <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border.faint }} />,
    [colors.border.faint],
  )

  return (
    <FlatList
      testID={testID}
      data={items}
      keyExtractor={(item, index) => keyExtractor(item, index)}
      renderItem={({ item, index }) => <>{renderItem(item, index)}</>}
      getItemLayout={getItemLayout}
      onEndReached={onEndReached}
      onEndReachedThreshold={0.5}
      ItemSeparatorComponent={separator ? Separator : null}
      ListHeaderComponent={header === undefined ? null : <>{header}</>}
      ListFooterComponent={footer === undefined ? null : <>{footer}</>}
      ListEmptyComponent={empty === undefined ? null : <>{empty}</>}
      style={grow ? styles.grow : undefined}
      scrollEnabled={grow}
      keyboardShouldPersistTaps="handled"
      removeClippedSubviews
      initialNumToRender={16}
      windowSize={7}
    />
  )
}

// ---------------------------------------------------------------------------
// Pressable, Img, Link
// ---------------------------------------------------------------------------

export function Pressable(props: PressableProps): React.JSX.Element {
  const { touchSize, colors } = useTheme()
  const {
    onPress,
    children,
    disabled = false,
    label,
    minHeight = touchSize,
    grow = false,
    role = 'button',
    testID,
  } = props
  return (
    <RNPressable
      testID={testID}
      accessibilityLabel={label}
      accessibilityRole={role === 'row' ? 'button' : role}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      android_ripple={{ color: colors.accent.tint }}
      style={({ pressed }) => [
        {
          minHeight,
          flex: grow ? 1 : undefined,
          justifyContent: 'center',
          opacity: pressed && !disabled ? 0.82 : 1,
        },
      ]}
    >
      {children}
    </RNPressable>
  )
}

export function Img(props: ImgProps): React.JSX.Element {
  const { source, alt, width, height, radius, fit = 'cover', testID } = props
  return (
    <Image
      testID={testID}
      source={{ uri: source }}
      accessible
      accessibilityLabel={alt}
      resizeMode={fit}
      style={{
        width,
        height,
        borderRadius: radius === 'full' ? radii.full : corner(radius),
      }}
    />
  )
}

/**
 * The same contract as the web anchor. expo-router lives in the app, not the kit, so the app's root
 * layout registers `router.push` / `router.replace` once through `setRouterNavigate`; a `<Link>`
 * before that is inert rather than crashing.
 */
export function Link(props: LinkProps): React.JSX.Element {
  const { colors, touchSize } = useTheme()
  const { href, children, replace = false, variant = 'text', testID } = props
  return (
    <RNPressable
      testID={testID}
      accessibilityRole="link"
      onPress={() => {
        routerNavigate?.(href, replace)
      }}
      style={{ minHeight: variant === 'text' ? undefined : touchSize, justifyContent: 'center' }}
    >
      {variant === 'text' ? (
        <Txt field="body" desk="body" color={colors.accent.fg} style={styles.underline}>
          {children}
        </Txt>
      ) : (
        children
      )}
    </RNPressable>
  )
}

// ---------------------------------------------------------------------------
// Router bridge — the same module-level hand-off the web renderer uses
// ---------------------------------------------------------------------------

type Navigate = (href: string, replace: boolean) => void

let routerNavigate: Navigate | null = null

export function setRouterNavigate(navigate: Navigate | null): void {
  routerNavigate = navigate
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

/**
 * The phone frame of UX-00 section 8.2: insets from the first frame (a hard-coded `paddingTop` is a
 * bug), the context line, the title, the chips, the scrolling body, and the bottom bar sitting on
 * `insets.bottom` so the primary action is never under the home indicator.
 */
export function Screen(props: ScreenProps): React.JSX.Element {
  const { colors, density } = useTheme()
  const insets = useSafeAreaInsets()
  const {
    title,
    context,
    actions,
    chips,
    scroll = true,
    bottomBar,
    readingWidth = true,
    pad,
    children,
    testID,
  } = props
  const desk = density === 'desk'
  const padding = px(pad) ?? (desk ? layout.deskPadding : layout.fieldGutter)
  const hasHeader = title !== undefined || context !== undefined || actions !== undefined

  const body = (
    <View
      style={{
        padding,
        maxWidth: readingWidth ? layout.deskMaxWidth : undefined,
        width: '100%',
        alignSelf: 'center',
      }}
    >
      {children}
    </View>
  )

  return (
    <View testID={testID} style={[styles.grow, { backgroundColor: colors.bg.ground }]}>
      {hasHeader ? (
        <View
          style={{
            paddingTop: insets.top + space[3],
            paddingBottom: space[3],
            paddingHorizontal: padding,
            backgroundColor: desk ? colors.bg.ground : colors.bg.surface,
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderBottomColor: colors.border.hairline,
          }}
        >
          {context === undefined ? null : (
            <Txt field="label" desk="meta" color={colors.text.secondary}>
              {context}
            </Txt>
          )}
          {title === undefined ? null : (
            <Txt field="title" desk="pageTitle" as="h1">
              {title}
            </Txt>
          )}
          {chips === undefined ? null : (
            <View style={styles.chips}>{chips}</View>
          )}
          {actions === undefined ? null : <View style={styles.actions}>{actions}</View>}
        </View>
      ) : (
        <View style={{ height: insets.top }} />
      )}

      {scroll ? (
        <ScrollView style={styles.grow} keyboardShouldPersistTaps="handled">
          {body}
        </ScrollView>
      ) : (
        <View style={styles.grow}>{body}</View>
      )}

      {bottomBar === undefined ? null : (
        <View
          style={{
            backgroundColor: colors.bg.surface,
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: colors.border.hairline,
            paddingHorizontal: padding,
            paddingTop: space[3],
            paddingBottom: insets.bottom + space[3],
          }}
        >
          {bottomBar}
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  underline: { textDecorationLine: 'underline' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2], marginTop: space[2] },
  actions: { flexDirection: 'row', gap: space[2], marginTop: space[2] },
})
