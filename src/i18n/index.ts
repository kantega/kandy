import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { LANGUAGE_METADATA } from "./languages";
import { commands } from "@/bindings";

// Auto-discover translation files using Vite's glob import
const localeModules = import.meta.glob<{ default: Record<string, unknown> }>(
  "./locales/*/translation.json",
  { eager: true },
);

// Build resources from discovered locale files
const resources: Record<string, { translation: Record<string, unknown> }> = {};
for (const [path, module] of Object.entries(localeModules)) {
  const langCode = path.match(/\.\/locales\/(.+)\/translation\.json/)?.[1];
  if (langCode) {
    resources[langCode] = { translation: module.default };
  }
}

// Build supported languages list from discovered locales + metadata
export const SUPPORTED_LANGUAGES = Object.keys(resources)
  .map((code) => {
    const meta = LANGUAGE_METADATA[code];
    if (!meta) {
      console.warn(`Missing metadata for locale "${code}" in languages.ts`);
      return { code, name: code, nativeName: code, priority: undefined };
    }
    return {
      code,
      name: meta.name,
      nativeName: meta.nativeName,
      priority: meta.priority,
    };
  })
  .sort((a, b) => {
    // Sort by priority first (lower = higher), then alphabetically
    if (a.priority !== undefined && b.priority !== undefined) {
      return a.priority - b.priority;
    }
    if (a.priority !== undefined) return -1;
    if (b.priority !== undefined) return 1;
    return a.name.localeCompare(b.name);
  });

export type SupportedLanguageCode = string;

// Check if a language code is supported. Kandy only ships nb and en, so we
// try the exact code first, then the bare language subtag ("nb-NO" → "nb").
export const getSupportedLanguage = (
  langCode: string | null | undefined,
): SupportedLanguageCode | null => {
  if (!langCode) return null;

  const normalized = langCode.toLowerCase().replace(/_/g, "-");
  const language = normalized.split("-")[0];

  const exact = SUPPORTED_LANGUAGES.find(
    (lang) => lang.code.toLowerCase() === normalized,
  );
  if (exact) return exact.code;

  const base = SUPPORTED_LANGUAGES.find(
    (lang) => lang.code.toLowerCase() === language,
  );
  return base ? base.code : null;
};

// Initialize i18n with Norwegian as default (Kandy is a Kantega project).
// Language will be synced from settings after init.
i18n.use(initReactI18next).init({
  resources,
  lng: "nb",
  fallbackLng: "en",
  interpolation: {
    escapeValue: false, // React already escapes values
  },
  react: {
    useSuspense: false, // Disable suspense for SSR compatibility
  },
});

// Sync language from app settings. If the user has explicitly picked a
// language it wins; otherwise stay on Norwegian (the Kandy default) rather
// than following system locale — Kantega-branded product ships Norwegian by
// default, and English is the fallback only when nb-keys are missing.
export const syncLanguageFromSettings = async () => {
  try {
    const result = await commands.getAppSettings();
    if (result.status === "ok" && result.data.app_language) {
      const supported = getSupportedLanguage(result.data.app_language);
      if (supported && supported !== i18n.language) {
        await i18n.changeLanguage(supported);
      }
    }
    // No else: leave the language at the init default ("nb").
  } catch (e) {
    console.warn("Failed to sync language from settings:", e);
  }
};

// Run language sync on init
syncLanguageFromSettings();

// Keep the document's lang attribute in step with the UI language.
i18n.on("languageChanged", (lng) => {
  document.documentElement.setAttribute("lang", lng);
});

export default i18n;
