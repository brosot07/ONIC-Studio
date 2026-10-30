import { usePrefs } from '../lib/prefs'

export const ReadyChip = ({ ready, optional }: { ready: boolean; optional?: boolean }) => {
  const { t } = usePrefs()
  if (ready) return <span className="pill pill-active">{t('setup.done')}</span>
  return <span className={`pill${optional ? '' : ' pill-needed'}`}>{optional ? t('setup.optional') : t('setup.missing')}</span>
}
