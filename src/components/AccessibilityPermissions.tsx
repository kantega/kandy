import { useEffect, useState } from "react";
import { Button } from "./ui/Button";
import { useTranslation } from "react-i18next";
import { type } from "@tauri-apps/plugin-os";
import {
  checkAccessibilityPermission,
  requestAccessibilityPermission,
} from "tauri-plugin-macos-permissions-api";

// Define permission state type
type PermissionState = "request" | "verify" | "granted";

const AccessibilityPermissions: React.FC = () => {
  const { t } = useTranslation();
  const [hasAccessibility, setHasAccessibility] = useState<boolean>(false);
  const [permissionState, setPermissionState] =
    useState<PermissionState>("request");

  // Accessibility permissions are only required on macOS
  const isMacOS = type() === "macos";

  // Check permissions without requesting
  const checkPermissions = async (): Promise<boolean> => {
    const hasPermissions: boolean = await checkAccessibilityPermission();
    setHasAccessibility(hasPermissions);
    setPermissionState(hasPermissions ? "granted" : "verify");
    return hasPermissions;
  };

  // Handle the unified button action based on current state
  const handleButtonClick = async (): Promise<void> => {
    if (permissionState === "request") {
      try {
        await requestAccessibilityPermission();
        // After system prompt, transition to verification state
        setPermissionState("verify");
      } catch (error) {
        console.error("Error requesting permissions:", error);
        setPermissionState("verify");
      }
    } else if (permissionState === "verify") {
      // State is "verify" - check if permission was granted
      await checkPermissions();
    }
  };

  // On app boot - check permissions (only on macOS)
  useEffect(() => {
    if (!isMacOS) return;

    const initialSetup = async (): Promise<void> => {
      const hasPermissions: boolean = await checkAccessibilityPermission();
      setHasAccessibility(hasPermissions);
      setPermissionState(hasPermissions ? "granted" : "request");
    };

    initialSetup();
  }, [isMacOS]);

  // Skip rendering on non-macOS platforms or if permission is already granted
  if (!isMacOS || hasAccessibility) {
    return null;
  }

  return (
    <div className="w-full rounded-lg border border-warning/40 bg-warning/10 px-3 py-2.5">
      <div className="flex justify-between items-center gap-3">
        <p className="min-w-0 flex-1 text-sm font-medium leading-5">
          {t("accessibility.permissionsDescription")}
        </p>
        <Button
          onClick={handleButtonClick}
          variant="warning"
          size="sm"
          className="shrink-0 whitespace-nowrap"
        >
          {t("accessibility.openSettings")}
        </Button>
      </div>
    </div>
  );
};

export default AccessibilityPermissions;
