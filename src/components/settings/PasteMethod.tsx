import React from "react";
import { useTranslation } from "react-i18next";
import { Dropdown, type DropdownOption } from "../ui/Dropdown";
import { SettingContainer } from "../ui/SettingContainer";
import { useSettings } from "../../hooks/useSettings";
import { useOsType } from "../../hooks/useOsType";
import type { PasteMethod } from "@/bindings";

interface PasteMethodProps {
  grouped?: boolean;
}

export const PasteMethodSetting: React.FC<PasteMethodProps> = React.memo(
  ({ grouped = false }) => {
    const { t } = useTranslation();
    const { getSetting, updateSetting, isUpdating } = useSettings();
    const osType = useOsType();

    const selectedMethod = (getSetting("paste_method") ||
      "ctrl_v") as PasteMethod;

    const getPasteMethodOptions = (osType: string) => {
      const mod = osType === "macos" ? "Cmd" : "Ctrl";

      const options: DropdownOption[] = [
        {
          value: "ctrl_v",
          label: t("settings.advanced.pasteMethod.options.clipboard", {
            modifier: mod,
          }),
        },
      ];

      // Direct input is not offered on macOS, but keep an existing/manual
      // selection visible so the UI accurately represents the saved setting.
      if (osType !== "macos" || selectedMethod === "direct") {
        options.push({
          value: "direct",
          label: t("settings.advanced.pasteMethod.options.direct"),
          disabled: osType === "macos",
        });
      }

      options.push({
        value: "none",
        label: t("settings.advanced.pasteMethod.options.none"),
      });

      return options;
    };

    const pasteMethodOptions = getPasteMethodOptions(osType);

    return (
      <SettingContainer
        title={t("settings.advanced.pasteMethod.title")}
        description={t("settings.advanced.pasteMethod.description")}
        grouped={grouped}
      >
        <Dropdown
          options={pasteMethodOptions}
          selectedValue={selectedMethod}
          onSelect={(value) =>
            updateSetting("paste_method", value as PasteMethod)
          }
          disabled={isUpdating("paste_method")}
        />
      </SettingContainer>
    );
  },
);
