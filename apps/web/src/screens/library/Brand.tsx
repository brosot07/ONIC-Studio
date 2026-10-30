import { useCallback, useEffect, useState } from 'react'
import { BRAND_SLOTS } from '@onic/shared'
import { usePrefs } from '../../lib/prefs'
import { loadBrandAssets, loadColors, loadVoices, type BrandAsset, type BrandColor, type VoiceGuide } from '../../lib/library'
import { signedUrls } from '../../lib/upload'
import { BrandSlotRow } from './BrandSlotRow'
import { Palette } from './Palette'
import { Voices } from './Voices'

export const useBrand = () => {
  const [assets, setAssets] = useState<BrandAsset[]>([])
  const [colors, setColors] = useState<BrandColor[]>([])
  const [voices, setVoices] = useState<VoiceGuide[]>([])
  const [urls, setUrls] = useState<Record<string, string>>({})
  const fetchAll = useCallback(async () => {
    const [a, c, v] = await Promise.all([loadBrandAssets(), loadColors(), loadVoices()])
    return { a, c, v, u: await signedUrls('brand', a.map((x) => x.path)) }
  }, [])
  const apply = useCallback((r: Awaited<ReturnType<typeof fetchAll>>) => {
    setAssets(r.a)
    setColors(r.c)
    setVoices(r.v)
    setUrls(r.u)
  }, [])
  const reload = useCallback(() => void fetchAll().then(apply), [fetchAll, apply])
  useEffect(() => {
    let live = true
    void fetchAll().then((r) => live && apply(r))
    return () => {
      live = false
    }
  }, [fetchAll, apply])
  return { assets, colors, voices, urls, reload }
}

export const Brand = ({ isAdmin }: { isAdmin: boolean }) => {
  const { t } = usePrefs()
  const { assets, colors, voices, urls, reload } = useBrand()
  return (
    <section className="page">
      <div>
        <h1>{t('brand.title')}</h1>
        <p className="lede">{t('brand.lede')}</p>
        {!isAdmin && <p className="hint">{t('library.readOnly')}</p>}
      </div>
      <div className="slots">
        {BRAND_SLOTS.map((slot) => (
          <BrandSlotRow key={slot.id} slot={slot} assets={assets} urls={urls} isAdmin={isAdmin} onChange={reload} />
        ))}
      </div>
      <h2 className="section-title">{t('setup.palette')}</h2>
      <Palette colors={colors} isAdmin={isAdmin} onChange={reload} />
      <h2 className="section-title">{t('setup.voice')}</h2>
      <p className="hint">{t('setup.voice.hint')}</p>
      <Voices voices={voices} isAdmin={isAdmin} onChange={reload} />
    </section>
  )
}
