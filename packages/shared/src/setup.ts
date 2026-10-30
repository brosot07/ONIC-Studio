/** What ONIC Studio needs before the design team can work. Drives the Admin setup checklist on Home. */

export type BrandSlotId =
  | 'logo_primary'
  | 'logo_mono'
  | 'logo_white'
  | 'logo_icon'
  | 'sub_brand_logo'
  | 'font'
  | 'background'
  | 'texture'
  | 'template'
  | 'guideline'

export interface BrandSlot {
  id: BrandSlotId
  kind: 'logo' | 'font' | 'background' | 'texture' | 'template' | 'guideline'
  variant?: 'primary' | 'mono' | 'white' | 'icon'
  /** Several files allowed (fonts, backgrounds…) versus one current file (the primary logo). */
  multiple: boolean
  /** Sub-brand logos ask which sub-brand they belong to. */
  needsBrand?: boolean
  /** File picker filter; the server still checks the bytes. */
  accept: string
  required: boolean
}

export const BRAND_SLOTS: readonly BrandSlot[] = [
  { id: 'logo_primary', kind: 'logo', variant: 'primary', multiple: false, accept: '.svg,.png', required: true },
  { id: 'logo_mono', kind: 'logo', variant: 'mono', multiple: false, accept: '.svg,.png', required: true },
  { id: 'logo_white', kind: 'logo', variant: 'white', multiple: false, accept: '.svg,.png', required: true },
  { id: 'logo_icon', kind: 'logo', variant: 'icon', multiple: false, accept: '.svg,.png', required: true },
  { id: 'sub_brand_logo', kind: 'logo', variant: 'primary', multiple: true, needsBrand: true, accept: '.svg,.png', required: false },
  { id: 'font', kind: 'font', multiple: true, accept: '.otf,.ttf,.woff,.woff2', required: true },
  { id: 'background', kind: 'background', multiple: true, accept: '.png,.jpg,.jpeg', required: false },
  { id: 'texture', kind: 'texture', multiple: true, accept: '.png,.jpg,.jpeg', required: false },
  { id: 'template', kind: 'template', multiple: true, accept: '.png,.jpg,.jpeg,.svg,.pdf', required: false },
  { id: 'guideline', kind: 'guideline', multiple: false, accept: '.pdf', required: true },
]

export const SUB_BRANDS: readonly string[] = ['ONIC ID', 'ONIC PH', 'ONIC Padel']

export const PLAYER_ASSET_KINDS = ['cutout', 'headshot', 'action'] as const
export const SPONSOR_ASSET_KINDS = ['logo_light', 'logo_dark', 'logo_mono', 'guideline'] as const

export const PLAYER_ACCEPT: Record<(typeof PLAYER_ASSET_KINDS)[number], string> = {
  cutout: '.png',
  headshot: '.jpg,.jpeg,.png',
  action: '.jpg,.jpeg,.png',
}
export const SPONSOR_ACCEPT: Record<(typeof SPONSOR_ASSET_KINDS)[number], string> = {
  logo_light: '.svg,.png',
  logo_dark: '.svg,.png',
  logo_mono: '.svg,.png',
  guideline: '.pdf',
}

/** Spreadsheet columns for importing players and sponsors (CSV, first row = these headers). */
export const PLAYER_CSV_COLUMNS = ['name', 'ign', 'role_lane', 'team_name', 'status', 'rights_expires_on', 'consent', 'notes'] as const
export const SPONSOR_CSV_COLUMNS = [
  'name',
  'tier',
  'instagram_handle',
  'mandatory_tags',
  'hashtags',
  'mentions',
  'monthly_deliverables',
  'contract_start',
  'contract_end',
  'conflicts',
  'placement_rules',
  'min_logo_px',
  'clear_space_ratio',
] as const
