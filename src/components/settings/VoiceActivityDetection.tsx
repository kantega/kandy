import React from "react";
import { useTranslation } from "react-i18next";
import { ToggleSwitch } from "../ui/ToggleSwitch";
import { useSettings } from "../../hooks/useSettings";

interface VoiceActivityDetectionProps {
  grouped?: boolean;
}

export const VoiceActivityDetection: React.FC<VoiceActivityDetectionProps> = ({
  grouped = false,
}) => {
  const { t } = useTranslation();
  const { getSetting, updateSetting, isUpdating } = useSettings();
  const enabled = getSetting("vad_enabled") ?? true;

  return (
    <ToggleSwitch
      checked={enabled}
      onChange={(enabled) => updateSetting("vad_enabled", enabled)}
      isUpdating={isUpdating("vad_enabled")}
      label={t("settings.advanced.voiceActivityDetection.title")}
      description={t("settings.advanced.voiceActivityDetection.description")}
      grouped={grouped}
    />
  );
};
