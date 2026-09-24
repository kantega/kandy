import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Input, SettingContainer, SettingsGroup } from "@/components/ui";
import { ResetButton } from "../ui/ResetButton";
import { useSavedHint } from "../ui/SavedHint";
import { useSettings } from "@/hooks/useSettings";
import { LlmApiKeyField } from "./LlmApiKeyField";

const LlmModelField: React.FC = () => {
  const { t } = useTranslation();
  const { getSetting, updateSetting, resetSetting, isUpdating } = useSettings();
  const model = getSetting("llm_model") ?? "";
  const [draft, setDraft] = useState(model);
  useEffect(() => setDraft(model), [model]);
  const busy = isUpdating("llm_model");
  const saved = useSavedHint();

  const commit = () => {
    const next = draft.trim();
    if (busy || !next || next === model) return;
    updateSetting("llm_model", next);
    saved.markSaved();
  };

  return (
    <SettingContainer
      title={t("settings.llm.model.title")}
      description={t("settings.llm.model.description")}
      grouped={true}
      layout="stacked"
    >
      <div className="flex items-center gap-2">
        <Input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
          }}
          variant="compact"
          className="flex-1 font-mono"
          disabled={busy}
          aria-label={t("settings.llm.model.title")}
        />
        {saved.element}
        <ResetButton
          onClick={() => resetSetting("llm_model")}
          disabled={busy}
          ariaLabel={t("common.resetToDefault")}
        />
      </div>
    </SettingContainer>
  );
};

/**
 * The Kantega LLM proxy configuration: one API key and one model, shared by
 * dictation post-processing and meeting summaries. Lives in the Models pane
 * next to the transcription models.
 */
export const LlmSettingsCard: React.FC = () => {
  const { t } = useTranslation();
  return (
    <SettingsGroup title={t("settings.llm.sectionTitle")}>
      <LlmApiKeyField grouped={true} />
      <LlmModelField />
    </SettingsGroup>
  );
};
