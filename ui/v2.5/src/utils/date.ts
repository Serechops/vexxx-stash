/**
 * Date utilities using date-fns as a lighter alternative to moment.js
 * 
 * Benefits:
 * - Tree-shakeable (~10-20KB vs moment's ~300KB)
 * - Modern functional API
 * - Immutable operations
 * 
 * Usage:
 *   import { formatRelativeTime, setDateLocale } from "src/utils/date";
 *   setDateLocale("de");
 *   formatRelativeTime(startTime); // "vor 5 Minuten"
 */

import { formatDistanceToNow } from "date-fns";
import { enUS, de, es, fr, it, ja, ko, pt, ru, zhCN, nl, pl, sv, uk, cs, da, fi, el, hu, nb, ro, tr, bg, hr, sk, sl, et, lt, lv, zhTW, th, vi, id, ms, hi, ar, he } from "date-fns/locale";

// Map of supported locales
const locales: Record<string, Locale> = {
  en: enUS,
  "en-US": enUS,
  "en-GB": enUS,
  de: de,
  "de-DE": de,
  es: es,
  "es-ES": es,
  fr: fr,
  "fr-FR": fr,
  it: it,
  "it-IT": it,
  ja: ja,
  "ja-JP": ja,
  ko: ko,
  "ko-KR": ko,
  pt: pt,
  "pt-BR": pt,
  "pt-PT": pt,
  ru: ru,
  "ru-RU": ru,
  zh: zhCN,
  "zh-CN": zhCN,
  "zh-TW": zhTW,
  nl: nl,
  "nl-NL": nl,
  pl: pl,
  "pl-PL": pl,
  sv: sv,
  "sv-SE": sv,
  uk: uk,
  "uk-UA": uk,
  cs: cs,
  "cs-CZ": cs,
  da: da,
  "da-DK": da,
  fi: fi,
  "fi-FI": fi,
  el: el,
  "el-GR": el,
  hu: hu,
  "hu-HU": hu,
  nb: nb,
  "nb-NO": nb,
  no: nb,
  ro: ro,
  "ro-RO": ro,
  tr: tr,
  "tr-TR": tr,
  bg: bg,
  "bg-BG": bg,
  hr: hr,
  "hr-HR": hr,
  sk: sk,
  "sk-SK": sk,
  sl: sl,
  "sl-SI": sl,
  et: et,
  "et-EE": et,
  lt: lt,
  "lt-LT": lt,
  lv: lv,
  "lv-LV": lv,
  th: th,
  "th-TH": th,
  vi: vi,
  "vi-VN": vi,
  id: id,
  "id-ID": id,
  ms: ms,
  "ms-MY": ms,
  hi: hi,
  "hi-IN": hi,
  ar: ar,
  "ar-SA": ar,
  he: he,
  "he-IL": he,
};

// Current active locale
let currentLocale: Locale = enUS;

/**
 * Set the current locale for date formatting.
 * Accepts language codes like "en", "de", "fr" or full locales like "en-US", "de-DE"
 * 
 * @param locale - Language code or array of language codes (uses first match)
 */
export function setDateLocale(locale: string | string[]): void {
  const codes = Array.isArray(locale) ? locale : [locale];
  
  for (const code of codes) {
    // Try exact match first
    if (locales[code]) {
      currentLocale = locales[code];
      return;
    }
    // Try base language (e.g., "en" from "en-GB")
    const baseLang = code.split("-")[0].split("_")[0];
    if (locales[baseLang]) {
      currentLocale = locales[baseLang];
      return;
    }
  }
  
  // Fallback to English
  currentLocale = enUS;
}

/**
 * Get relative time string (e.g., "5 minutes ago", "in 2 hours")
 * 
 * @param date - Date string, Date object, or timestamp
 * @param addSuffix - If true, adds "ago" or "in" suffix. If false, returns just the duration
 * @returns Localized relative time string
 */
export function formatRelativeTime(
  date: string | Date | number,
  addSuffix = false
): string {
  const dateObj = typeof date === "string" ? new Date(date) : date;
  return formatDistanceToNow(dateObj, {
    locale: currentLocale,
    addSuffix,
  });
}

/**
 * Get the current locale object (for direct use with date-fns functions)
 */
export function getDateLocale(): Locale {
  return currentLocale;
}

export default {
  setDateLocale,
  formatRelativeTime,
  getDateLocale,
};
