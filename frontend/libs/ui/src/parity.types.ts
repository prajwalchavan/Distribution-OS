/**
 * Parity, the half a runtime test cannot see: SHAPES.
 *
 * `parity.test.ts` proves the two renderers export the same NAMES. This file proves each of those
 * names is the same component — every implementation on both sides is bound to the one contract in
 * `src/types.ts`, so a `<Screen>` whose native half quietly took a different prop fails
 * `pnpm typecheck` rather than failing on a phone.
 *
 * Nothing here is imported at runtime: `typeof import(...)` is a type expression, so this module
 * compiles to nothing and never asks Node to resolve `react-native`.
 */
/*
 * `typeof import('...')` is the ONLY way to name a module's value exports as a type without importing
 * it at runtime, and importing `./native/index.js` for real would ask Node to resolve `react-native`
 * outside Metro. `consistent-type-imports` cannot see that difference, so it is switched off here and
 * nowhere else.
 */
/* eslint-disable @typescript-eslint/consistent-type-imports */
import type { ComponentType } from 'react'

import type {
  AppShellProps,
  BoxProps,
  ButtonProps,
  ImgProps,
  LinkProps,
  ListProps,
  MapViewProps,
  MoneyProps,
  PressableProps,
  RowProps,
  ScreenProps,
  ScrollProps,
  StackProps,
  StatusChipProps,
  TenantSwitcherProps,
  TxtContract,
  Viewport,
} from './types.js'

type WebModule = typeof import('./web/index.js')
type NativeModule = typeof import('./native/index.js')

/** `Actual` must satisfy `Expected`; the compiler reports the difference where it is written. */
type Implements<Expected, Actual extends Expected> = Actual

/** The value exports of the two renderers, minus the documented renderer-private handful. */
type WebOnly =
  'BASE_CSS' | 'FONT_CSS' | 'buildStylesheet' | 'buildThemeVars' | 'cssVar' | 'cssVarName'

type MissingFromNative = Exclude<keyof WebModule, keyof NativeModule | WebOnly>
type MissingFromWeb = Exclude<keyof NativeModule, keyof WebModule>

/** Both must be `never`. A missing sibling names itself in the error. */
export type _EveryWebExportHasANativeSibling = Implements<never, MissingFromNative>
export type _EveryNativeExportHasAWebSibling = Implements<never, MissingFromWeb>

// --- the layout vocabulary of docs/08 §0, bound to its contract on both renderers ---------------

export type _Screen = [
  Implements<ComponentType<ScreenProps>, WebModule['Screen']>,
  Implements<ComponentType<ScreenProps>, NativeModule['Screen']>,
]
export type _Box = [
  Implements<ComponentType<BoxProps>, WebModule['Box']>,
  Implements<ComponentType<BoxProps>, NativeModule['Box']>,
]
export type _Stack = [
  Implements<ComponentType<StackProps>, WebModule['Stack']>,
  Implements<ComponentType<StackProps>, NativeModule['Stack']>,
]
export type _Row = [
  Implements<ComponentType<RowProps>, WebModule['Row']>,
  Implements<ComponentType<RowProps>, NativeModule['Row']>,
]
export type _Scroll = [
  Implements<ComponentType<ScrollProps>, WebModule['Scroll']>,
  Implements<ComponentType<ScrollProps>, NativeModule['Scroll']>,
]
export type _List = [
  Implements<ComponentType<ListProps<string>>, WebModule['List']>,
  Implements<ComponentType<ListProps<string>>, NativeModule['List']>,
]
export type _Pressable = [
  Implements<ComponentType<PressableProps>, WebModule['Pressable']>,
  Implements<ComponentType<PressableProps>, NativeModule['Pressable']>,
]
export type _Img = [
  Implements<ComponentType<ImgProps>, WebModule['Img']>,
  Implements<ComponentType<ImgProps>, NativeModule['Img']>,
]
export type _Link = [
  Implements<ComponentType<LinkProps>, WebModule['Link']>,
  Implements<ComponentType<LinkProps>, NativeModule['Link']>,
]
export type _Txt = [
  Implements<ComponentType<TxtContract>, WebModule['Txt']>,
  Implements<ComponentType<TxtContract>, NativeModule['Txt']>,
]

// --- the shell ----------------------------------------------------------------------------------

export type _AppShell = [
  Implements<ComponentType<AppShellProps>, WebModule['AppShell']>,
  Implements<ComponentType<AppShellProps>, NativeModule['AppShell']>,
]
export type _TenantSwitcher = [
  Implements<ComponentType<TenantSwitcherProps>, WebModule['TenantSwitcher']>,
  Implements<ComponentType<TenantSwitcherProps>, NativeModule['TenantSwitcher']>,
]
export type _useViewport = [
  Implements<() => Viewport, WebModule['useViewport']>,
  Implements<() => Viewport, NativeModule['useViewport']>,
]
export type _setRouterNavigate = [
  Implements<
    (navigate: ((href: string, replace: boolean) => void) | null) => void,
    WebModule['setRouterNavigate']
  >,
  Implements<
    (navigate: ((href: string, replace: boolean) => void) | null) => void,
    NativeModule['setRouterNavigate']
  >,
]

// --- a sample of the UX-00 §6 set, so a future edit to one renderer cannot drift alone -----------

export type _Button = [
  Implements<ComponentType<ButtonProps>, WebModule['Button']>,
  Implements<ComponentType<ButtonProps>, NativeModule['Button']>,
]
export type _Money = [
  Implements<ComponentType<MoneyProps>, WebModule['Money']>,
  Implements<ComponentType<MoneyProps>, NativeModule['Money']>,
]
export type _MapView = [
  Implements<ComponentType<MapViewProps>, WebModule['MapView']>,
  Implements<ComponentType<MapViewProps>, NativeModule['MapView']>,
]
export type _StatusChip = [
  Implements<ComponentType<StatusChipProps>, WebModule['StatusChip']>,
  Implements<ComponentType<StatusChipProps>, NativeModule['StatusChip']>,
]

// --- the platform pairs -------------------------------------------------------------------------

type WebPlatform = typeof import('./platform/index.web.js')
type NativePlatform = typeof import('./platform/index.native.js')

export type _PlatformWebHasEveryNativeName = Implements<
  never,
  Exclude<keyof NativePlatform, keyof WebPlatform>
>
export type _PlatformNativeHasEveryWebName = Implements<
  never,
  Exclude<keyof WebPlatform, keyof NativePlatform>
>
