import { useRef, type MouseEvent } from 'react'
import { usePrefs } from '../../lib/prefs'
import { previewPath, type EventMedia } from '../../lib/library'

/**
 * Event photos and videos as a grid of small previews. When `selected` is given, clicking a tile selects it
 * (Shift-click selects everything between the last click and this one).
 */
export const MediaGrid = ({
  media,
  urls,
  playerNames,
  selected,
  onSelect,
  caption,
}: {
  media: EventMedia[]
  urls: Record<string, string>
  playerNames: Record<string, string>
  selected?: Set<string>
  onSelect?: (next: Set<string>) => void
  /** Extra line under each tile, e.g. the event name on a player's page. */
  caption?: (m: EventMedia) => string | undefined
}) => {
  const { t } = usePrefs()
  const last = useRef<number | null>(null)

  const click = (e: MouseEvent, index: number) => {
    if (!selected || !onSelect) return
    const next = new Set(selected)
    const id = media[index]!.id
    if (e.shiftKey && last.current !== null) {
      const [a, b] = [Math.min(last.current, index), Math.max(last.current, index)]
      for (let i = a; i <= b; i++) next.add(media[i]!.id)
    } else if (next.has(id)) next.delete(id)
    else next.add(id)
    last.current = index
    onSelect(next)
  }

  return (
    <ul className="media-grid">
      {media.map((m, i) => {
        const tags = m.event_media_players.map((p) => playerNames[p.player_id]).filter(Boolean)
        const preview = urls[previewPath(m)]
        const isSelected = selected?.has(m.id) ?? false
        const body = (
          <>
            <span className="media-preview">
              {preview && m.kind === 'photo' && <img src={preview} alt="" loading="lazy" />}
              {preview && m.kind === 'video' && <video src={preview} muted playsInline preload="metadata" />}
              {m.kind === 'video' && <span className="media-badge">▶</span>}
            </span>
            <span className="media-name" title={m.name}>
              {m.name}
            </span>
            {caption?.(m) && <span className="media-caption">{caption(m)}</span>}
            <span className="media-tags">{tags.length ? tags.join(', ') : t('events.show.untagged')}</span>
          </>
        )
        return (
          <li key={m.id} className={`media-tile${isSelected ? ' is-selected' : ''}`}>
            {onSelect ? (
              <button type="button" className="media-hit" aria-pressed={isSelected} onClick={(e) => click(e, i)}>
                {body}
              </button>
            ) : (
              <a className="media-hit" href={urls[m.path]} target="_blank" rel="noopener noreferrer">
                {body}
              </a>
            )}
          </li>
        )
      })}
    </ul>
  )
}
