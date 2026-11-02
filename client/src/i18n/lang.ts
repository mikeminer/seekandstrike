/**
 * Game languages: the 17 UI languages of the Solana Mobile dApp Store app on the Seeker
 * (read from com.solanamobile.dappstore v1.59.0 resources on 2026-11-02: en + ar de es fr hi it ja ko nl pl pt ru th uk zh zh-TW).
 * Choice order: ?lang= → saved choice → device languages → English.
 */
export const LANGS = ['en', 'it', 'ar', 'de', 'es', 'fr', 'hi', 'ja', 'ko', 'nl', 'pl', 'pt', 'ru', 'th', 'uk', 'zh', 'zh-TW'] as const;
export type Lang = (typeof LANGS)[number];

/** Each language's own name, for the language picker. */
export const NATIVE_NAMES: Record<Lang, string> = {
  en: 'English', it: 'Italiano', ar: 'العربية', de: 'Deutsch', es: 'Español', fr: 'Français', hi: 'हिन्दी', ja: '日本語',
  ko: '한국어', nl: 'Nederlands', pl: 'Polski', pt: 'Português', ru: 'Русский', th: 'ไทย', uk: 'Українська', zh: '简体中文', 'zh-TW': '繁體中文',
};

/** BCP-47 tags for Intl number/date formatting. */
export const INTL_TAG: Record<Lang, string> = {
  en: 'en-GB', it: 'it-IT', ar: 'ar', de: 'de-DE', es: 'es-ES', fr: 'fr-FR', hi: 'hi-IN', ja: 'ja-JP', ko: 'ko-KR', nl: 'nl-NL',
  pl: 'pl-PL', pt: 'pt-BR', ru: 'ru-RU', th: 'th-TH', uk: 'uk-UA', zh: 'zh-CN', 'zh-TW': 'zh-TW',
};

export const isRtl = (l: Lang): boolean => l === 'ar';
export const isLang = (v: unknown): v is Lang => typeof v === 'string' && (LANGS as readonly string[]).includes(v);

/** Maps a BCP-47 tag (navigator.language) to a game language, or null. */
export function matchLang(tag: string): Lang | null {
  const t = tag.trim().toLowerCase().replace('_', '-');
  if (!t) return null;
  if (t.startsWith('zh')) return /-(tw|hk|mo|hant)\b/.test(t) ? 'zh-TW' : 'zh';
  const primary = t.split('-')[0]!;
  return isLang(primary) ? primary : null;
}

const KEY = 'seekstrike.lang';

export function detectLang(): Lang {
  if (typeof location !== 'undefined') {
    const q = new URLSearchParams(location.search).get('lang');
    if (q && isLang(q)) return q;
  }
  try { const s = localStorage.getItem(KEY); if (isLang(s)) return s; } catch { /* storage unavailable */ }
  if (typeof navigator !== 'undefined') {
    // The device language first: on the Seeker WebView navigator.languages can start with en-US even when the phone is in Italian.
    for (const tag of [navigator.language, ...(navigator.languages ?? [])]) { const l = tag ? matchLang(tag) : null; if (l) return l; }
  }
  return 'en';
}

/** Saves the choice and reloads (every label is built at start-up). */
export function chooseLang(l: Lang): void {
  try { localStorage.setItem(KEY, l); } catch { /* storage unavailable */ }
  const url = new URL(location.href);
  url.searchParams.delete('lang');
  location.replace(url.toString());
}
