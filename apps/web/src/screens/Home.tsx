import { usePrefs } from '../lib/prefs'

export const Home = () => {
  const { t } = usePrefs()
  return (
    <section className="page">
      <h1>{t('home.title')}</h1>
      <p className="lede">{t('home.soon')}</p>
    </section>
  )
}
