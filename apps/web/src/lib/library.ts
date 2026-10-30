import { supabase } from './supabase'

export interface BrandAsset {
  id: string
  lineage_id: string
  version: number
  kind: string
  brand: string
  variant: string | null
  name: string
  path: string
  mime: string
  width: number | null
  height: number | null
}

export interface Player {
  id: string
  name: string
  ign: string
  role_lane: string | null
  team_name: string | null
  status: 'active' | 'inactive' | 'loaned'
  rights_expires_on: string | null
  consent: boolean
  player_assets: { id: string; lineage_id: string; kind: string; name: string; path: string; is_current: boolean }[]
}

export interface Sponsor {
  id: string
  name: string
  tier: string | null
  instagram_handle: string | null
  monthly_deliverables: number | null
  contract_start: string | null
  contract_end: string | null
  mandatory_tags: string[]
  hashtags: string[]
  conflicts: string[]
  placement_rules: string | null
  min_logo_px: number | null
  sponsor_assets: { id: string; lineage_id: string; kind: string; name: string; path: string; is_current: boolean }[]
}

export interface BrandColor {
  id: string
  name: string
  hex: string
  sort: number
}

export interface VoiceGuide {
  id: string
  account: string
  language: 'id' | 'en' | 'ph'
  sample_captions: string[]
  banned_words: string[]
  banned_topics: string[]
}

export const today = () => new Date().toISOString().slice(0, 10)

export const playerUsable = (p: Player) =>
  p.status === 'active' && p.consent && (!p.rights_expires_on || p.rights_expires_on >= today())

export const sponsorRunning = (s: Sponsor) =>
  (!s.contract_start || s.contract_start <= today()) && (!s.contract_end || s.contract_end >= today())

export const loadBrandAssets = async (): Promise<BrandAsset[]> => {
  const { data } = await supabase!
    .from('brand_assets')
    .select('id, lineage_id, version, kind, brand, variant, name, path, mime, width, height')
    .eq('is_current', true)
    .order('created_at', { ascending: false })
  return (data ?? []) as BrandAsset[]
}

export const loadPlayers = async (): Promise<Player[]> => {
  const { data } = await supabase!
    .from('players')
    .select('id, name, ign, role_lane, team_name, status, rights_expires_on, consent, player_assets(id, lineage_id, kind, name, path, is_current)')
    .order('ign')
  return ((data ?? []) as Player[]).map((p) => ({ ...p, player_assets: p.player_assets.filter((a) => a.is_current) }))
}

export const loadSponsors = async (): Promise<Sponsor[]> => {
  const { data } = await supabase!
    .from('sponsors')
    .select(
      'id, name, tier, instagram_handle, monthly_deliverables, contract_start, contract_end, mandatory_tags, hashtags, conflicts, placement_rules, min_logo_px, sponsor_assets(id, lineage_id, kind, name, path, is_current)',
    )
    .order('name')
  return ((data ?? []) as Sponsor[]).map((s) => ({ ...s, sponsor_assets: s.sponsor_assets.filter((a) => a.is_current) }))
}

export const loadColors = async (): Promise<BrandColor[]> => {
  const { data } = await supabase!.from('brand_colors').select('id, name, hex, sort').order('sort').order('name')
  return (data ?? []) as BrandColor[]
}

export const loadVoices = async (): Promise<VoiceGuide[]> => {
  const { data } = await supabase!.from('voice_guides').select('id, account, language, sample_captions, banned_words, banned_topics').order('account')
  return (data ?? []) as VoiceGuide[]
}
