/**
 * Client-safe locale metadata.
 *
 * Split out from `lib/i18n.ts` deliberately: the dictionaries there are ~1.2k
 * lines across three languages, and the only client component that needs locale
 * information is the language switcher. Importing `lib/i18n.ts` from a Client
 * Component would ship every translation to the browser — this module is what
 * keeps that from happening.
 */

export type Lang = "en" | "hi" | "fr";

export const LANGS: Array<{ code: Lang; label: string; native: string }> = [
  { code: "en", label: "EN", native: "English" },
  { code: "hi", label: "हिं", native: "हिन्दी" },
  { code: "fr", label: "FR", native: "Français" },
];

export const DEFAULT_LANG: Lang = "en";

export const LANG_COOKIE = "ems-lang";
export const THEME_COOKIE = "ems-theme";

export type Theme = "dark" | "light";
export const DEFAULT_THEME: Theme = "dark";

export function isLang(value: string | undefined): value is Lang {
  return value === "en" || value === "hi" || value === "fr";
}

export function isTheme(value: string | undefined): value is Theme {
  return value === "dark" || value === "light";
}
