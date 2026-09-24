import React from "react";
import { useTranslation } from "react-i18next";
import { ShowOverlay } from "../ShowOverlay";
import { CustomWords } from "../CustomWords";
import { SettingsGroup } from "../../ui/SettingsGroup";
import { AutostartToggle } from "../AutostartToggle";
import { PasteMethodSetting } from "../PasteMethod";
import { AutoSubmit } from "../AutoSubmit";
import { VoiceActivityDetection } from "../VoiceActivityDetection";
import { VadBackendSelector } from "../VadBackendSelector";
import { FillerWordRemoval } from "../FillerWordRemoval";
import { DeleteData } from "./DeleteData";
import { useSettings } from "../../../hooks/useSettings";

export const AdvancedSettings: React.FC = () => {
  const { t } = useTranslation();
  const { getSetting } = useSettings();
  // The backend only matters when a detector actually runs.
  const vadEnabled = getSetting("vad_enabled") ?? true;

  return (
    <div className="max-w-3xl w-full mx-auto space-y-6">
      <SettingsGroup title={t("settings.advanced.groups.app")}>
        <AutostartToggle grouped={true} />
        <ShowOverlay grouped={true} />
      </SettingsGroup>

      <SettingsGroup title={t("settings.advanced.groups.output")}>
        <PasteMethodSetting grouped={true} />
        <AutoSubmit grouped={true} />
      </SettingsGroup>

      <SettingsGroup title={t("settings.advanced.groups.transcription")}>
        <VoiceActivityDetection grouped={true} />
        {vadEnabled && <VadBackendSelector grouped={true} />}
        <FillerWordRemoval grouped={true} />
        <CustomWords grouped />
      </SettingsGroup>

      <SettingsGroup title={t("settings.advanced.groups.data")}>
        <DeleteData />
      </SettingsGroup>
    </div>
  );
};
