/**
 * The migration folder is only as good as its journal, and drizzle fails SILENTLY when the two
 * disagree.
 *
 * `drizzle-orm/pg-core/dialect.js` applies a folder only when
 * `lastDbMigration.created_at < folderMillis` — it walks the journal in order and skips every entry
 * whose `when` is not newer than the newest row already in `drizzle.__drizzle_migrations`. So a
 * branch that appends its own `0048_…` while main has appended a different `0048_…` does not
 * collide loudly: on every database that already ran main's 0048..0054 the branch's file is quietly
 * passed over, no error, no row, and the service then 500s on a column that the schema says exists.
 * That is exactly what merge-review blocker B1 caught on this lane before it could reach dos_qa or
 * the founder's own database.
 *
 * An orphan SQL file — one sitting in the folder that no journal entry names — is the same defect
 * wearing different clothes: it is never read, never applied, and looks applied to anyone reading
 * the folder.
 *
 * These are cheap, total facts about the folder, so assert them on every run rather than trusting a
 * reviewer to notice a number.
 *
 * The index must climb, but it need not be dense: two lanes in flight at once are given DIFFERENT
 * numbers up front (S-176's pair was ruled 0060/0061 while another lane held 0058/0059, since renumbered 0063–0065) precisely so
 * that neither collides with the other, and whichever merges first leaves a gap until the second
 * lands. Drizzle never reads `idx` — only the journal's order and `when` decide what runs — so a gap
 * costs nothing, while a repeated or backwards index is the collision this file exists to catch.
 */
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

interface JournalEntry {
  readonly idx: number
  readonly when: number
  readonly tag: string
}

/**
 * Every way a journal and a folder of SQL files can disagree, as sentences. Empty means healthy.
 * Pure on purpose: the second test below feeds it the arrangement this lane actually carried, which
 * cannot be reproduced on disk without breaking the repository.
 */
export function journalFaults(
  entries: readonly JournalEntry[],
  sqlFiles: readonly string[],
): string[] {
  const faults: string[] = []

  entries.forEach((entry, position) => {
    const prefix = String(entry.idx).padStart(4, '0')
    if (!entry.tag.startsWith(`${prefix}_`)) {
      faults.push(`idx ${entry.idx} is tagged "${entry.tag}", which does not begin ${prefix}_`)
    }
    const previous = position > 0 ? entries[position - 1] : undefined
    if (previous !== undefined) {
      if (entry.idx <= previous.idx) {
        faults.push(
          `idx ${entry.idx} follows idx ${previous.idx}: the journal must be a strictly increasing list`,
        )
      }
      if (entry.when <= previous.when) {
        faults.push(
          `"${entry.tag}" (when ${entry.when}) is not newer than "${previous.tag}" (when ${previous.when}): ` +
            'drizzle applies a folder only when the last applied migration is older, so this one is SKIPPED ' +
            'in silence on any database that already ran the one before it',
        )
      }
    }
  })

  const tagged = new Set(entries.map((entry) => entry.tag))
  for (const file of sqlFiles) {
    const tag = file.replace(/\.sql$/, '')
    if (!tagged.has(tag)) {
      faults.push(`${file} is in the folder but no journal entry names it, so it never runs`)
    }
  }
  const present = new Set(sqlFiles.map((file) => file.replace(/\.sql$/, '')))
  for (const entry of entries) {
    if (!present.has(entry.tag)) {
      faults.push(`the journal names "${entry.tag}" but migrations/${entry.tag}.sql does not exist`)
    }
  }

  return faults
}

const here = dirname(fileURLToPath(import.meta.url))
const migrationsDir = resolve(here, '../migrations')

describe('migration journal', () => {
  it('names every SQL file exactly once, in strictly increasing `when` order', () => {
    const journal = JSON.parse(
      readFileSync(resolve(migrationsDir, 'meta/_journal.json'), 'utf8'),
    ) as { entries: JournalEntry[] }
    const sqlFiles = readdirSync(migrationsDir).filter((name) => name.endsWith('.sql'))

    expect(sqlFiles.length).toBeGreaterThan(50)
    expect(journal.entries[0]?.idx).toBe(0)
    expect(journalFaults(journal.entries, sqlFiles)).toEqual([])
  })

  it('reports the silent skip when two branches both append the same index (DOS-103 / blocker B1)', () => {
    // The arrangement this lane carried before main was merged in: main had appended 0048..0054
    // ending at `when` 1789941326945, while the branch had appended its own pair at 48/49 with
    // OLDER `when` values. Both journals are individually plausible; together the inbound pair is
    // never applied to a database that is already at 0054.
    const collided: JournalEntry[] = [
      { idx: 47, when: 1789293246405, tag: '0047_pack_confirmations_created_idx' },
      { idx: 48, when: 1789893891220, tag: '0048_order_cess_expand' },
      { idx: 49, when: 1789894648769, tag: '0049_order_stock_shortages_expand' },
      { idx: 50, when: 1789895106285, tag: '0050_order_credit_notice_expand' },
      { idx: 51, when: 1789895719323, tag: '0051_scheme_per_unit_amount_expand' },
      { idx: 52, when: 1789939621499, tag: '0052_list_dates_and_pick_cancelled_at' },
      { idx: 53, when: 1789941326944, tag: '0053_grns_supplier_expand' },
      { idx: 54, when: 1789941326945, tag: '0054_grns_supplier_guarantees' },
      { idx: 55, when: 1789915099506, tag: '0055_inbound_reports_expand' },
      { idx: 56, when: 1789915099507, tag: '0056_inbound_reports_guarantees' },
    ].map((entry, position) => ({ ...entry, idx: position + 47 }))

    const faults = journalFaults(
      collided,
      collided.map((entry) => `${entry.tag}.sql`),
    )
    expect(faults).toHaveLength(1)
    expect(faults[0]).toContain('0055_inbound_reports_expand')
    expect(faults[0]).toContain('SKIPPED')
  })

  it('allows the gap two lanes numbered apart leave behind, but not a repeated or backwards idx', () => {
    const gapped: JournalEntry[] = [
      { idx: 57, when: 1789961540000, tag: '0057_role_election_expand' },
      { idx: 60, when: 1789979170000, tag: '0060_hsn_rate_subheadings' },
      { idx: 61, when: 1789979170001, tag: '0061_hsn_rate_unique_expand' },
    ]
    expect(
      journalFaults(
        gapped,
        gapped.map((entry) => `${entry.tag}.sql`),
      ),
    ).toEqual([])

    const repeated: JournalEntry[] = [
      { idx: 57, when: 1789961540000, tag: '0057_role_election_expand' },
      { idx: 58, when: 1789971778028, tag: '0058_stock_expand' },
      { idx: 58, when: 1789978208509, tag: '0058_undelivered_expand' },
    ]
    expect(
      journalFaults(
        repeated,
        repeated.map((entry) => `${entry.tag}.sql`),
      ),
    ).toEqual(['idx 58 follows idx 58: the journal must be a strictly increasing list'])
  })

  it('reports an SQL file the journal forgot, which is the same defect in another shape', () => {
    const entries: JournalEntry[] = [{ idx: 0, when: 1, tag: '0000_init' }]
    expect(journalFaults(entries, ['0000_init.sql', '0001_orphan.sql'])).toEqual([
      '0001_orphan.sql is in the folder but no journal entry names it, so it never runs',
    ])
  })
})
