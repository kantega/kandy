import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { getVersion } from "@tauri-apps/api/app";
import { SettingsGroup } from "../../ui/SettingsGroup";
import { SettingContainer } from "../../ui/SettingContainer";
import { AppDataDirectory } from "../AppDataDirectory";
import { LogDirectory } from "../LogDirectory";

const PrivacySection: React.FC = () => {
  const { t } = useTranslation();
  // Points come from i18n as arrays. `returnObjects` lets us map over them
  // instead of hand-listing each key.
  const localPoints = t("settings.about.privacy.localPoints", {
    returnObjects: true,
  }) as string[];
  const cloudPoints = t("settings.about.privacy.cloudPoints", {
    returnObjects: true,
  }) as string[];
  const controlPoints = t("settings.about.privacy.controlPoints", {
    returnObjects: true,
  }) as string[];

  return (
    <div className="space-y-5 px-4 py-3">
      <p className="text-sm">{t("settings.about.privacy.intro")}</p>

      <div>
        <h3 className="text-sm font-semibold mb-2">
          {t("settings.about.privacy.localTitle")}
        </h3>
        <ul className="text-sm text-text/80 space-y-1 list-disc pl-5">
          {localPoints.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      </div>

      <div>
        <h3 className="text-sm font-semibold mb-2">
          {t("settings.about.privacy.cloudTitle")}
        </h3>
        <ul className="text-sm text-text/80 space-y-1 list-disc pl-5">
          {cloudPoints.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      </div>

      <div>
        <h3 className="text-sm font-semibold mb-2">
          {t("settings.about.privacy.controlTitle")}
        </h3>
        <ul className="text-sm text-text/80 space-y-1 list-disc pl-5">
          {controlPoints.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      </div>

      <div>
        <h3 className="text-sm font-semibold mb-2">
          {t("settings.about.privacy.noTelemetryTitle")}
        </h3>
        <p className="text-sm text-text/80">
          {t("settings.about.privacy.noTelemetryBody")}
        </p>
      </div>
    </div>
  );
};

export const AboutSettings: React.FC = () => {
  const { t } = useTranslation();
  const [version, setVersion] = useState("");

  useEffect(() => {
    const fetchVersion = async () => {
      try {
        const appVersion = await getVersion();
        setVersion(appVersion);
      } catch (error) {
        console.error("Failed to get app version:", error);
        setVersion("");
      }
    };

    fetchVersion();
  }, []);

  return (
    <div className="max-w-3xl w-full mx-auto space-y-6">
      <SettingsGroup title={t("settings.about.title")}>
        <SettingContainer
          title={t("settings.about.version.title")}
          description={t("settings.about.version.description")}
          grouped={true}
        >
          {/* eslint-disable-next-line i18next/no-literal-string */}
          {version && <span className="text-sm font-mono">v{version}</span>}
        </SettingContainer>

        <AppDataDirectory grouped={true} />
        <LogDirectory grouped={true} />
      </SettingsGroup>

      <SettingsGroup title={t("settings.about.privacy.title")}>
        <PrivacySection />
      </SettingsGroup>

      <SettingsGroup title={t("settings.about.acknowledgments.title")}>
        <SettingContainer
          title={t("settings.about.acknowledgments.ggml.title")}
          description={t("settings.about.acknowledgments.ggml.description")}
          grouped={true}
          layout="stacked"
        >
          <div className="text-sm text-mid-gray">
            {t("settings.about.acknowledgments.ggml.details")}
          </div>
        </SettingContainer>
      </SettingsGroup>
    </div>
  );
};
