import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { SettingContainer } from "../ui/SettingContainer";
import { ResetButton } from "../ui/ResetButton";
import { Dropdown } from "../ui/Dropdown";
import { useSettings } from "../../hooks/useSettings";
import {
  recognitionLanguage,
  SELECTABLE_LANGUAGES,
  supportsLanguageCode,
} from "../../lib/constants/languages";

interface LanguageSelectorProps {
  grouped?: boolean;
  supportedLanguages?: string[];
  // Whether the model can auto-detect language. Gates the "Auto" option:
  // must-pick models (no detection) omit it and force a concrete choice.
  supportsLanguageDetection?: boolean;
}

// Mirrors the matching logic of `effective_language` in
// src-tauri/src/managers/model.rs. The Rust function is authoritative for the
// *concrete* code the engine receives (e.g. "en-US"); this resolves the
// canonical *base* code ("en") so the highlighted picker item matches an entry
// in the LANGUAGES list. Matching is base-aware (`supportsLanguageCode` strips
// region/script subtags), so a model advertising full locales still resolves.
const effectiveLanguage = (
  intent: string,
  supported: string[],
  supportsDetection: boolean,
): string => {
  if (supported.length === 0) return intent;
  if (intent !== "auto" && supportsLanguageCode(supported, intent))
    return intent;
  if (supportsDetection) return "auto";
  if (supportsLanguageCode(supported, "en")) return "en";
  return recognitionLanguage(supported[0]);
};

export const LanguageSelector: React.FC<LanguageSelectorProps> = ({
  grouped = false,
  supportedLanguages,
  supportsLanguageDetection = true,
}) => {
  const { t } = useTranslation();
  const { getSetting, updateSetting, resetSetting, isUpdating } = useSettings();
  const updating = isUpdating("selected_language");

  // The persisted *intent* (auto | code). What's actually used/shown is the
  // effective value resolved against the current model's capabilities.
  const intent = getSetting("selected_language") || "auto";
  const selectedLanguage = effectiveLanguage(
    intent,
    supportedLanguages ?? [],
    supportsLanguageDetection,
  );

  const options = useMemo(() => {
    const available =
      !supportedLanguages || supportedLanguages.length === 0
        ? SELECTABLE_LANGUAGES
        : SELECTABLE_LANGUAGES.filter((lang) =>
            lang.value === "auto"
              ? supportsLanguageDetection
              : supportsLanguageCode(supportedLanguages, lang.value),
          );
    return available.map((lang) => ({
      value: lang.value,
      label:
        lang.value === "auto"
          ? t("settings.general.language.auto")
          : lang.label,
    }));
  }, [supportedLanguages, supportsLanguageDetection, t]);

  return (
    <SettingContainer
      title={t("settings.general.language.title")}
      description={t("settings.general.language.description")}
      grouped={grouped}
    >
      <div className="flex items-center gap-1">
        <Dropdown
          options={options}
          selectedValue={selectedLanguage}
          onSelect={(value) => void updateSetting("selected_language", value)}
          disabled={updating}
        />
        <ResetButton
          onClick={() => void resetSetting("selected_language")}
          disabled={updating}
        />
      </div>
    </SettingContainer>
  );
};
