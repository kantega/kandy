import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "../../ui/Button";
import { SettingContainer, Textarea, ToggleSwitch } from "../../ui";

interface MeetingSummarySettingsProps {
  prompt: string;
  autoSummarize: boolean;
  autoSummarizeUpdating: boolean;
  autoTitle: boolean;
  autoTitleUpdating: boolean;
  onToggleAutoSummarize: (enabled: boolean) => void;
  onToggleAutoTitle: (enabled: boolean) => void;
  onSavePrompt: (prompt: string) => void;
}

/**
 * Configuration for the summary feature. Folded by default because it is
 * something you set once, not something you touch per meeting.
 */
export const MeetingSummarySettings: React.FC<MeetingSummarySettingsProps> = ({
  prompt,
  autoSummarize,
  autoSummarizeUpdating,
  autoTitle,
  autoTitleUpdating,
  onToggleAutoSummarize,
  onToggleAutoTitle,
  onSavePrompt,
}) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [promptInput, setPromptInput] = useState(prompt);

  useEffect(() => setPromptInput(prompt), [prompt]);

  return (
    <div className="bg-surface border border-card-border shadow-card rounded-lg">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="w-full px-4 py-3 flex items-center gap-2 text-start cursor-pointer text-text hover:text-logo-primary transition-colors rounded-lg focus:outline-none focus-visible:ring-1 focus-visible:ring-logo-primary"
      >
        {open ? (
          <ChevronDown className="w-4 h-4 shrink-0" aria-hidden="true" />
        ) : (
          <ChevronRight className="w-4 h-4 shrink-0" aria-hidden="true" />
        )}
        <span className="text-sm font-medium">
          {t("meeting.settings.title")}
        </span>
      </button>

      {open && (
        <div className="border-t border-mid-gray/20 divide-y divide-mid-gray/20">
          <ToggleSwitch
            checked={autoSummarize}
            onChange={onToggleAutoSummarize}
            isUpdating={autoSummarizeUpdating}
            label={t("meeting.settings.autoSummarize")}
            description={t("meeting.settings.autoSummarizeHelp")}
            grouped={true}
          />

          <ToggleSwitch
            checked={autoTitle}
            onChange={onToggleAutoTitle}
            isUpdating={autoTitleUpdating}
            label={t("meeting.settings.autoTitle")}
            description={t("meeting.settings.autoTitleHelp")}
            grouped={true}
          />

          <SettingContainer
            title={t("meeting.settings.prompt")}
            description={t("meeting.settings.promptHelp")}
            grouped={true}
            layout="stacked"
          >
            <div className="flex flex-col gap-2">
              <Textarea
                value={promptInput}
                onChange={(e) => setPromptInput(e.target.value)}
                rows={8}
                className="w-full whitespace-pre-wrap"
                aria-label={t("meeting.settings.prompt")}
              />
              <div className="flex justify-end">
                <Button
                  onClick={() => onSavePrompt(promptInput)}
                  variant="primary"
                  size="sm"
                  disabled={!promptInput.trim() || promptInput === prompt}
                >
                  {t("common.save")}
                </Button>
              </div>
            </div>
          </SettingContainer>
        </div>
      )}
    </div>
  );
};
