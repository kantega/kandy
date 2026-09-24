import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { commands } from "@/bindings";
import { useSettings } from "@/hooks/useSettings";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { SettingContainer } from "../ui/SettingContainer";
import { useSavedHint } from "../ui/SavedHint";

/** SecretMap key the backend stores the Kantega LLM proxy key under (mirror of `crate::kantega_llm::LLM_KEY_ID`). */
export const LLM_KEY_ID = "kantega_llmproxy";

/** True when a Kantega LLM proxy key is stored. */
export const useHasLlmKey = (): boolean => {
  const { settings } = useSettings();
  return Boolean(settings?.llm_api_keys?.[LLM_KEY_ID]);
};

interface LlmApiKeyFieldProps {
  grouped?: boolean;
}

/**
 * The single Kantega LLM proxy API key shared by post-processing and meeting
 * summaries. Pasting a key and leaving the field (or pressing Enter) stores
 * it; removing it takes the explicit button, since that turns both features
 * off.
 */
export const LlmApiKeyField: React.FC<LlmApiKeyFieldProps> = ({
  grouped = false,
}) => {
  const { t } = useTranslation();
  const { refreshSettings } = useSettings();
  const hasKey = useHasLlmKey();
  const [keyInput, setKeyInput] = useState("");
  const [saving, setSaving] = useState(false);
  const saved = useSavedHint();

  const save = async (key: string) => {
    setSaving(true);
    try {
      const r = await commands.changeLlmApiKeySetting(key);
      if (r.status !== "ok") {
        toast.error(t("settings.llm.apiKey.saveFailed"));
        return;
      }
      await refreshSettings();
      setKeyInput("");
      if (key) {
        saved.markSaved();
      } else {
        toast.success(t("settings.llm.apiKey.removed"));
      }
    } finally {
      setSaving(false);
    }
  };

  // Committed on blur and Enter. An empty field is a no-op rather than a
  // removal: losing the key by tabbing past the box would be a nasty surprise.
  const commit = () => {
    const key = keyInput.trim();
    if (!key || saving) return;
    void save(key);
  };

  return (
    <SettingContainer
      title={t("settings.llm.apiKey.title")}
      description={
        hasKey
          ? t("settings.llm.apiKey.descriptionSet")
          : t("settings.llm.apiKey.description")
      }
      grouped={grouped}
      layout="stacked"
    >
      <div className="flex items-center gap-2">
        <Input
          type="password"
          value={keyInput}
          onChange={(e) => setKeyInput(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
          }}
          placeholder={
            hasKey
              ? t("settings.llm.apiKey.placeholderSet")
              : t("settings.llm.apiKey.placeholder")
          }
          variant="compact"
          className="flex-1 font-mono"
          disabled={saving}
          aria-label={t("settings.llm.apiKey.title")}
        />
        {saved.element}
        {hasKey && (
          <Button
            onClick={() => void save("")}
            variant="secondary"
            size="md"
            disabled={saving}
          >
            {t("settings.llm.apiKey.remove")}
          </Button>
        )}
      </div>
    </SettingContainer>
  );
};
