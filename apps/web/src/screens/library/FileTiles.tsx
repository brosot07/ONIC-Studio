import { usePrefs } from '../../lib/prefs'

export interface Tile {
  id: string
  name: string
  path: string
  mime?: string
  label?: string
}

const isImage = (t: Tile) => /\.(png|jpe?g|svg|webp)$/i.test(t.path)
const isVideo = (t: Tile) => /\.(mp4|mov)$/i.test(t.path)

/** Previews of library files. Images show a thumbnail, videos play in place; PDFs and fonts show their name with an Open link. */
export const FileTiles = ({
  tiles,
  urls,
  onRemove,
}: {
  tiles: Tile[]
  urls: Record<string, string>
  onRemove?: (tile: Tile) => void
}) => {
  const { t } = usePrefs()
  if (tiles.length === 0) return null
  return (
    <ul className="tiles">
      {tiles.map((tile) => (
        <li key={tile.id} className="tile">
          <div className="tile-preview">
            {isImage(tile) && urls[tile.path] ? (
              <img src={urls[tile.path]} alt="" loading="lazy" />
            ) : isVideo(tile) && urls[tile.path] ? (
              <video src={urls[tile.path]} controls muted playsInline preload="metadata" />
            ) : (
              <span className="tile-ext">{tile.path.split('.').pop()?.toUpperCase()}</span>
            )}
          </div>
          <span className="tile-name" title={tile.name}>
            {tile.label ? `${tile.label} · ` : ''}
            {tile.name}
          </span>
          <span className="tile-actions">
            {urls[tile.path] && !isImage(tile) && !isVideo(tile) && (
              <a href={urls[tile.path]} target="_blank" rel="noopener noreferrer">
                {t('library.open')}
              </a>
            )}
            {onRemove && (
              <button type="button" className="link" onClick={() => window.confirm(t('library.retire.confirm')) && onRemove(tile)}>
                {t('library.retire')}
              </button>
            )}
          </span>
        </li>
      ))}
    </ul>
  )
}
