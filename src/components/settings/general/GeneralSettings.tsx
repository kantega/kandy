import React from "react";
import { useTranslation } from "react-i18next";
import { MicrophoneSelector } from "../MicrophoneSelector";
import { ChannelSelector } from "../ChannelSelector";
import { ShortcutInput } from "../ShortcutInput";
import { SettingsGroup } from "../../ui/SettingsGroup";
import { OutputDeviceSelector } from "../OutputDeviceSelector";
import { ShortcutActivationSetting } from "../ShortcutActivation";
import { HoldThreshold } from "../HoldThreshold";
import { AudioFeedback } from "../AudioFeedback";
import { useSettings } from "../../../hooks/useSettings";
import { VolumeSlider } from "../VolumeSlider";
import { MuteWhileRecording } from "../MuteWhileRecording";
import { ModelSettingsCard } from "./ModelSettingsCard";
import { AppLanguageSelector } from "../AppLanguageSelector";
import { ThemeSelector } from "../ThemeSelector";

export const GeneralSettings: React.FC = () => {
  const { t } = useTranslation();
  const { audioFeedbackEnabled, getSetting } = useSettings();
  const activation = getSetting("shortcut_activation") ?? "hold_or_toggle";
  // Releases only end a recording in the hold modes, so the cancel shortcut is
  // only reachable (and only needed) under toggle.
  const releaseEndsRecording = activation !== "toggle";
  return (
    <div className="max-w-3xl w-full mx-auto space-y-6">
      <SettingsGroup title={t("settings.general.title")}>
        <ShortcutInput shortcutId="transcribe" grouped={true} />
        <ShortcutActivationSetting grouped={true} />
        {activation === "hold_or_toggle" && <HoldThreshold grouped={true} />}
        {!releaseEndsRecording && (
          <ShortcutInput shortcutId="cancel" grouped={true} />
        )}
      </SettingsGroup>
      <ModelSettingsCard />
      <SettingsGroup title={t("settings.sound.title")}>
        <MicrophoneSelector grouped={true} />
        <ChannelSelector grouped={true} />
        <MuteWhileRecording grouped={true} />
        <AudioFeedback grouped={true} />
        <OutputDeviceSelector grouped={true} disabled={!audioFeedbackEnabled} />
        <VolumeSlider disabled={!audioFeedbackEnabled} />
      </SettingsGroup>
      {/* Appearance and app language live here rather than under About: they are
          preferences the user sets, not information about the build. */}
      <SettingsGroup title={t("settings.appearance.title")}>
        <ThemeSelector grouped={true} />
        <AppLanguageSelector grouped={true} />
      </SettingsGroup>
    </div>
  );
};
