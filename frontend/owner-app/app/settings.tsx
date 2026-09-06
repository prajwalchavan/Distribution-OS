/**
 * The second route, so the shell has something to navigate BETWEEN — the rail on a desk viewport and
 * the bottom tabs on a phone are the same `SECTIONS` array, and this is how you see that.
 */
import { Screen, Stack, Txt, useStrings } from '@dos/ui'

export default function Settings(): React.JSX.Element {
  const t = useStrings()
  return (
    <Screen title={t('app.settings')}>
      <Stack gap={4}>
        <Txt field="body" desk="body">
          {t('app.settingsBody')}
        </Txt>
      </Stack>
    </Screen>
  )
}
