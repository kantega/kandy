export interface Language {
  value: string;
  label: string;
}

export const LANGUAGES: Language[] = [
  { value: "auto", label: "Auto" },
  { value: "nb", label: "Norsk" },
  { value: "en", label: "English" },
];

const LANGUAGE_LABELS = new Map(
  LANGUAGES.map((language) => [language.value, language.label] as const),
);

export const MODEL_CAPABILITY_LANGUAGES: Language[] = LANGUAGES.filter(
  (language) => language.value !== "auto",
);

// Languages offered in the transcription-language picker.
export const SELECTABLE_LANGUAGES: Language[] = LANGUAGES;

// Collapse a language tag to the base code Kandy matches on, dropping any
// BCP-47 region or script subtag: "en-US" → "en". Bare codes pass through
// unchanged. This lets the picker match a model's real codes (which may be
// full locales) against Kandy's canonical bare-code LANGUAGES list.
export const recognitionLanguage = (languageCode: string): string => {
  const separatorIndex = languageCode.indexOf("-");
  const base =
    separatorIndex === -1
      ? languageCode
      : languageCode.slice(0, separatorIndex);
  // Whisper advertises Norwegian as "no" (and Nynorsk as "nn"); Kandy's
  // canonical code is "nb". Treat them as one language.
  return base === "no" || base === "nn" ? "nb" : base;
};

export const supportsLanguageCode = (
  supportedLanguages: string[],
  languageCode: string,
): boolean => {
  const recognitionCode = recognitionLanguage(languageCode);
  return supportedLanguages.some(
    (supportedLanguage) =>
      recognitionLanguage(supportedLanguage) === recognitionCode,
  );
};

export const getUniqueCapabilityLanguages = (
  supportedLanguages: string[],
): string[] => {
  const seen = new Set<string>();
  return supportedLanguages.map(recognitionLanguage).filter((languageCode) => {
    if (seen.has(languageCode)) return false;
    seen.add(languageCode);
    return true;
  });
};

export const getLanguageLabel = (languageCode: string): string | undefined =>
  LANGUAGE_LABELS.get(languageCode);
