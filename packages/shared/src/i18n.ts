export const LANGS = ['id', 'en'] as const
export type Lang = (typeof LANGS)[number]

/**
 * Every word a designer sees. Plain language only — no model names, prompts or API terms.
 * Keys are grouped by screen.
 */
const en = {
  'app.name': 'ONIC Studio',
  'login.title': 'Sign in',
  'login.lede': 'Feed posts, carousels, stories and merch — made with your design team.',
  'login.email': 'Work email',
  'login.password': 'Password',
  'login.submit': 'Sign in',
  'login.submitting': 'Signing in…',
  'login.forgot': 'Forgot your password?',
  'login.inviteOnly': 'Accounts are created by your Admin. Ask them for an invite.',
  'login.error.invalid': 'That email and password don’t match. Check them and try again.',
  'login.error.missing': 'Enter your email and password.',
  'login.error.network': 'Can’t reach the server. Check your internet connection and try again.',
  'login.error.notConfigured':
    'ONIC Studio isn’t connected to its server yet. Let your Admin know.',
  'login.signedIn': 'You’re signed in. Your workspace is coming soon.',
  'login.signOut': 'Sign out',
  'settings.language': 'Language',
  'settings.theme': 'Appearance',
  'settings.theme.system': 'Match my computer',
  'settings.theme.light': 'Light',
  'settings.theme.dark': 'Dark',
} as const

export type MessageKey = keyof typeof en

const id: Record<MessageKey, string> = {
  'app.name': 'ONIC Studio',
  'login.title': 'Masuk',
  'login.lede': 'Feed post, carousel, story, dan merch — dibuat bersama tim desainmu.',
  'login.email': 'Email kantor',
  'login.password': 'Kata sandi',
  'login.submit': 'Masuk',
  'login.submitting': 'Sedang masuk…',
  'login.forgot': 'Lupa kata sandi?',
  'login.inviteOnly': 'Akun dibuat oleh Admin. Minta undangan ke Admin.',
  'login.error.invalid': 'Email dan kata sandi tidak cocok. Periksa lalu coba lagi.',
  'login.error.missing': 'Isi email dan kata sandi.',
  'login.error.network': 'Server tidak bisa dihubungi. Periksa koneksi internet lalu coba lagi.',
  'login.error.notConfigured':
    'ONIC Studio belum tersambung ke server. Kabari Admin.',
  'login.signedIn': 'Kamu sudah masuk. Ruang kerjamu segera hadir.',
  'login.signOut': 'Keluar',
  'settings.language': 'Bahasa',
  'settings.theme': 'Tampilan',
  'settings.theme.system': 'Ikuti komputer',
  'settings.theme.light': 'Terang',
  'settings.theme.dark': 'Gelap',
}

export const messages: Record<Lang, Record<MessageKey, string>> = { en, id }
