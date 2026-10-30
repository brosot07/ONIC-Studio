import { useState } from 'react'
import { SUB_BRANDS, type BrandSlot, type MessageKey } from '@onic/shared'
import { supabase } from '../../lib/supabase'
import { usePrefs } from '../../lib/prefs'
import { displayName, uploadToLibrary } from '../../lib/upload'
import type { BrandAsset } from '../../lib/library'
import { DropZone } from '../../ui/DropZone'
import { ReadyChip } from '../../ui/Chip'
import { FileTiles } from './FileTiles'

const HINT: Record<BrandSlot['kind'], MessageKey> = {
  logo: 'slot.hint.logo',
  font: 'slot.hint.font',
  background: 'slot.hint.image',
  texture: 'slot.hint.image',
  template: 'slot.hint.template',
  guideline: 'slot.hint.pdf',
}

/** Files that fill a slot: the main ONIC logos are matched on variant; sub-brand logos on brand. */
export const slotAssets = (slot: BrandSlot, assets: BrandAsset[]) =>
  assets.filter((a) => {
    if (a.kind !== slot.kind) return false
    if (slot.kind !== 'logo') return true
    if (slot.needsBrand) return a.brand !== 'ONIC'
    return a.brand === 'ONIC' && a.variant === slot.variant
  })

export const BrandSlotRow = ({
  slot,
  assets,
  urls,
  isAdmin,
  onChange,
}: {
  slot: BrandSlot
  assets: BrandAsset[]
  urls: Record<string, string>
  isAdmin: boolean
  onChange: () => void
}) => {
  const { t } = usePrefs()
  const [subBrand, setSubBrand] = useState(SUB_BRANDS[0]!)
  const mine = slotAssets(slot, assets)

  const upload = (file: File) =>
    uploadToLibrary(file, {
      library: 'brand',
      kind: slot.kind,
      brand: slot.needsBrand ? subBrand : 'ONIC',
      variant: slot.variant ?? null,
      name: slot.needsBrand ? `${subBrand} — ${displayName(file)}` : displayName(file),
      // A single-file slot keeps one current file: the new one becomes the next version.
      replaces: !slot.multiple && mine[0] ? mine[0].lineage_id : undefined,
    })

  const retire = async (id: string) => {
    await supabase?.from('brand_assets').update({ is_current: false }).eq('id', id)
    onChange()
  }

  return (
    <div className="slot">
      <div className="slot-head">
        <h3>{t(`slot.${slot.id}`)}</h3>
        <ReadyChip ready={mine.length > 0} optional={!slot.required} />
      </div>
      <p className="hint">{t(HINT[slot.kind])}</p>
      <FileTiles
        tiles={mine.map((a) => ({ id: a.id, name: a.name, path: a.path, label: slot.needsBrand ? a.brand : undefined }))}
        urls={urls}
        onRemove={isAdmin ? (tile) => void retire(tile.id) : undefined}
      />
      {isAdmin && (
        <>
          {slot.needsBrand && (
            <label className="field field-inline">
              <span>{t('slot.subBrand')}</span>
              <select value={subBrand} onChange={(e) => setSubBrand(e.target.value)}>
                {SUB_BRANDS.map((b) => (
                  <option key={b}>{b}</option>
                ))}
              </select>
            </label>
          )}
          <DropZone accept={slot.accept} multiple={slot.multiple} hasFile={mine.length > 0} onUpload={upload} onDone={onChange} />
        </>
      )}
    </div>
  )
}
