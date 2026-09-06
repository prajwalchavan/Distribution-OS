/**
 * The in-process change bus `useTable` re-runs on (docs/27 §11).
 *
 * A live query is not a subscription to SQLite: it is a query that is asked again when the ONE writer
 * in this process — a pull applying rows, or the outbox touching a row — says the table it reads has
 * changed. Keyed by table, so a beat screen does not re-query on every GPS point.
 */
export type TableListener = (tables: ReadonlySet<string>) => void

export class ChangeBus {
  private readonly listeners = new Set<TableListener>()

  subscribe(listener: TableListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  emit(tables: Iterable<string>): void {
    const changed = new Set(tables)
    if (changed.size === 0) return
    for (const listener of [...this.listeners]) listener(changed)
  }
}

/** The pseudo-table name the outbox and the error tray publish under. */
export const OUTBOX_CHANNEL = '_outbox'
export const ERRORS_CHANNEL = '_sync_errors'
