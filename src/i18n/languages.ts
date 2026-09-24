/**
 * Language metadata for supported locales.
 *
 * Kandy er et internt Kantega-produkt og støtter kun norsk (default) og
 * engelsk (fallback). For å legge til et nytt språk:
 * 1. Lag ny mappe: src/i18n/locales/{code}/translation.json
 * 2. Legg til metadata under
 */
export const LANGUAGE_METADATA: Record<
  string,
  {
    name: string;
    nativeName: string;
    priority?: number;
    direction?: "ltr" | "rtl";
  }
> = {
  nb: { name: "Norwegian", nativeName: "Norsk", priority: 1 },
  en: { name: "English", nativeName: "English", priority: 2 },
};
