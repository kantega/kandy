import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { SettingContainer, SettingsGroup, Textarea } from "@/components/ui";
import { Button } from "../../ui/Button";
import { ToggleSwitch } from "../../ui/ToggleSwitch";
import { useHasLlmKey } from "../LlmApiKeyField";
import { ShortcutInput } from "../ShortcutInput";
import { useSettings } from "@/hooks/useSettings";

const AutoPostProcessToggle: React.FC = () => {
  const { t } = useTranslation();
  const { getSetting, updateSetting, isUpdating } = useSettings();
  return (
    <ToggleSwitch
      checked={getSetting("post_process_enabled") ?? false}
      onChange={(enabled) => updateSetting("post_process_enabled", enabled)}
      isUpdating={isUpdating("post_process_enabled")}
      label={t("settings.postProcessing.auto.title")}
      description={t("settings.postProcessing.auto.description")}
      grouped={true}
    />
  );
};

const PromptField: React.FC = () => {
  const { t } = useTranslation();
  const { getSetting, updateSetting, resetSetting, isUpdating } = useSettings();
  const prompt = getSetting("post_process_prompt") ?? "";
  const [draft, setDraft] = useState(prompt);
  useEffect(() => setDraft(prompt), [prompt]);
  const busy = isUpdating("post_process_prompt");

  return (
    <SettingContainer
      title={t("settings.postProcessing.prompt.title")}
      description={t("settings.postProcessing.prompt.description")}
      grouped={true}
      layout="stacked"
    >
      <div className="flex flex-col gap-2">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={8}
          className="w-full whitespace-pre-wrap"
          disabled={busy}
          aria-label={t("settings.postProcessing.prompt.title")}
        />
        <div className="flex justify-end gap-2">
          <Button
            onClick={() => resetSetting("post_process_prompt")}
            variant="ghost"
            size="sm"
            disabled={busy}
          >
            {t("common.resetToDefault")}
          </Button>
          <Button
            onClick={() => updateSetting("post_process_prompt", draft)}
            variant="primary"
            size="sm"
            disabled={busy || !draft.trim() || draft === prompt}
          >
            {t("common.save")}
          </Button>
        </div>
      </div>
    </SettingContainer>
  );
};

export const PostProcessingSettings: React.FC = () => {
  const { t } = useTranslation();
  const hasKey = useHasLlmKey();

  return (
    <div className="max-w-3xl w-full mx-auto space-y-6">
      <SettingsGroup title={t("settings.postProcessing.groups.behaviour")}>
        <AutoPostProcessToggle />
        <ShortcutInput
          shortcutId="transcribe_with_post_process"
          grouped={true}
        />
      </SettingsGroup>

      <SettingsGroup title={t("settings.postProcessing.groups.llm")}>
        {!hasKey && (
          <p className="px-4 py-3 text-xs text-warning">
            {t("settings.postProcessing.noKey")}
          </p>
        )}
        <PromptField />
      </SettingsGroup>
    </div>
  );
};
