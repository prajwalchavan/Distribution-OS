/**
 * The desk keyboard contract of UX-00 §8.1: `/` go to search · `Esc` close one level · `Enter` commit
 * · `↑ ↓` move in a register · `j` / `k` in a queue · `1` / `2` approve / reject.
 *
 * WHY IT IS HERE AND NOT IN `@dos/ui/platform`. A keyboard is a platform capability like a camera or
 * a printer, and it belongs beside them — but `@dos/ui/platform` has no keyboard pair yet, and adding
 * one is a change to the shared kit that six sibling app slices are also writing against. So this
 * file is the app's own, deliberately the ONLY place in the owner app that touches a global: it feature
 * -detects `document` (which exists in a browser and nowhere else — no `react-dom` import, no DOM node
 * is ever created or read) and does nothing at all on a phone, where UX-00 gives the same screens a
 * thumb instead. The moment the kit grows `platform.keyboard`, this file becomes a one-line re-export.
 */
import { useEffect, useRef } from 'react'

/** A DOM-ish keyboard event, described structurally so no DOM type is imported. */
interface KeyEventLike {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  preventDefault: () => void
  target: unknown
}

interface DocumentLike {
  addEventListener: (type: string, handler: (event: KeyEventLike) => void) => void
  removeEventListener: (type: string, handler: (event: KeyEventLike) => void) => void
  activeElement?: unknown
}

function documentOrNull(): DocumentLike | null {
  const candidate = (globalThis as { document?: unknown }).document
  if (candidate === undefined || candidate === null) return null
  const doc = candidate as Partial<DocumentLike>
  return typeof doc.addEventListener === 'function' ? (doc as DocumentLike) : null
}

/**
 * True while the person is typing into a field. A register's `j` must not eat the `j` of a shop name,
 * so every shortcut below one character wide is suppressed inside an input.
 */
function isTyping(target: unknown): boolean {
  if (typeof target !== 'object' || target === null) return false
  const node = target as { tagName?: unknown; isContentEditable?: unknown }
  const tag = typeof node.tagName === 'string' ? node.tagName.toUpperCase() : ''
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  return node.isContentEditable === true
}

export type Hotkeys = Readonly<Record<string, (() => void) | undefined>>

/**
 * Binds a map of `key` → handler for as long as the component is mounted.
 *
 * Keys are matched case-insensitively against `KeyboardEvent.key`: `'/'`, `'Escape'`, `'Enter'`,
 * `'ArrowDown'`, `'j'`, `'1'`. A handler that fires calls `preventDefault()`, so `/` never reaches
 * the browser's own find bar. `Escape` is the one key that still fires while a field has focus —
 * closing the thing you are in is exactly what it is for.
 */
export function useHotkeys(keys: Hotkeys, enabled = true): void {
  const ref = useRef(keys)
  ref.current = keys

  useEffect(() => {
    if (!enabled) return
    const doc = documentOrNull()
    if (doc === null) return

    const onKey = (event: KeyEventLike): void => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const handler = ref.current[event.key] ?? ref.current[event.key.toLowerCase()]
      if (handler === undefined) return
      if (event.key !== 'Escape' && isTyping(event.target)) return
      event.preventDefault()
      handler()
    }

    doc.addEventListener('keydown', onKey)
    return () => {
      doc.removeEventListener('keydown', onKey)
    }
  }, [enabled])
}

/**
 * The register's own arrow keys (UX-00 §8.1: "`↑ ↓` move, `Enter` open", "`j`/`k` queues").
 *
 * `rows` is whatever the screen is showing, `selected` the key of the highlighted row and `onSelect`
 * the screen's own setter — so moving the selection and clicking a row are the same one code path,
 * and `Enter` opens whatever the selection already is.
 */
export function useRegisterKeys<Row>(input: {
  rows: readonly Row[]
  rowKey: (row: Row) => string
  selected: string | null
  onSelect: (row: Row) => void
  onOpen?: (() => void) | undefined
  enabled?: boolean
}): void {
  const { rows, rowKey, selected, onSelect, onOpen, enabled = true } = input

  const move = (delta: number): void => {
    if (rows.length === 0) return
    const at = rows.findIndex((row) => rowKey(row) === selected)
    const next = at === -1 ? (delta > 0 ? 0 : rows.length - 1) : at + delta
    const clamped = Math.max(0, Math.min(rows.length - 1, next))
    const row = rows[clamped]
    if (row !== undefined) onSelect(row)
  }

  useHotkeys(
    {
      ArrowDown: () => {
        move(1)
      },
      ArrowUp: () => {
        move(-1)
      },
      j: () => {
        move(1)
      },
      k: () => {
        move(-1)
      },
      ...(onOpen === undefined ? {} : { Enter: onOpen }),
    },
    enabled,
  )
}
