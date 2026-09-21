/**
 * `/` — the one route of the one app that belongs to no group (docs/31 §1.2).
 *
 * It renders a skeleton and nothing else, ON PURPOSE. Six apps each had a home screen at `/`; this
 * app has six homes, one per group, and which one a person gets is not this file's decision — it is
 * the elected role in the token, read by the root layout's ladder, which replaces this route with
 * `/<group>` on the render after the session settles.
 *
 * It exists because something has to: `/` is where a bookmark, a change-password, a shared link and
 * the browser's own address bar all land, and an expo-router tree with no `index` answers those with
 * "Unmatched Route" rather than with the two frames of skeleton the ladder needs.
 */
import { Screen, Skeleton } from '@dos/ui'

export default function Home(): React.JSX.Element {
  return (
    <Screen>
      <Skeleton rows={4} />
    </Screen>
  )
}
