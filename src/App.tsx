import {
  useEffect,
  useLayoutEffect,
  useState,
  useRef,
  type ReactNode,
} from "react";
import { toast, Toaster } from "sonner";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { platform } from "@tauri-apps/plugin-os";
import {
  checkAccessibilityPermission,
  checkMicrophonePermission,
} from "tauri-plugin-macos-permissions-api";
import { ModelStateEvent, RecordingErrorEvent } from "./lib/types/events";
import "./App.css";
import AccessibilityPermissions from "./components/AccessibilityPermissions";
import SecureInputWarning from "./components/SecureInputWarning";
import Onboarding, { AccessibilityOnboarding } from "./components/onboarding";
import { Sidebar, SidebarSection, SECTIONS_CONFIG } from "./components/Sidebar";
import { useSettings } from "./hooks/useSettings";
import { useSettingsStore } from "./stores/settingsStore";
import { useMeetingStore } from "./stores/meetingStore";
import { commands } from "@/bindings";

type OnboardingStep = "accessibility" | "model" | "done";

const renderSettingsContent = (section: SidebarSection) => {
  const ActiveComponent =
    SECTIONS_CONFIG[section]?.component || SECTIONS_CONFIG.meeting.component;
  return <ActiveComponent />;
};

/**
 * Page header: the section's name and a one-line explanation of what lives
 * there. Sticky, so the band keeps the top edge of the scrolling column
 * instead of peeling off and leaving the page color behind it.
 */
const SectionHeader: React.FC<{ section: SidebarSection }> = ({ section }) => {
  const { t } = useTranslation();
  const config = SECTIONS_CONFIG[section] ?? SECTIONS_CONFIG.meeting;
  return (
    <header className="sticky top-0 z-20 w-full bg-band-gradient border-b border-edge">
      <div className="h-[3px] w-full bg-accent-rule" aria-hidden="true" />
      <div className="max-w-3xl w-full mx-auto px-6 pt-5 pb-4">
        <h1 className="text-[22px] leading-7 font-semibold text-text tracking-tight">
          {t(config.labelKey)}
        </h1>
        <p className="text-sm text-mid-gray mt-1">{t(config.descriptionKey)}</p>
      </div>
    </header>
  );
};

function App() {
  const { t } = useTranslation();
  const [onboardingStep, setOnboardingStep] = useState<OnboardingStep | null>(
    null,
  );
  // Track if this is a returning user who just needs to grant permissions
  // (vs a new user who needs full onboarding including model selection)
  const [isReturningUser, setIsReturningUser] = useState(false);
  const [currentSection, setCurrentSection] =
    useState<SidebarSection>("meeting");
  const { settings } = useSettings();
  const refreshAudioDevices = useSettingsStore(
    (state) => state.refreshAudioDevices,
  );
  const refreshOutputDevices = useSettingsStore(
    (state) => state.refreshOutputDevices,
  );
  const hasCompletedPostOnboardingInit = useRef(false);
  const mainScrollRef = useRef<HTMLElement>(null);
  const isShowingOnboarding =
    onboardingStep === "accessibility" || onboardingStep === "model";

  // Sections share one persistent scroller, so reset the scroll position
  // whenever the active section changes.
  useLayoutEffect(() => {
    mainScrollRef.current?.scrollTo({ top: 0 });
  }, [currentSection]);

  // Classic scrollbars consume layout space. Reserve a matching gutter on the
  // opposite edge while onboarding is visible so its content stays centered in
  // the physical window. Overlay scrollbars ignore scrollbar-gutter.
  useLayoutEffect(() => {
    const attribute = "data-onboarding-active";
    document.documentElement.toggleAttribute(attribute, isShowingOnboarding);
    return () => document.documentElement.removeAttribute(attribute);
  }, [isShowingOnboarding]);

  useEffect(() => {
    checkOnboardingStatus();
  }, []);

  // Poll backend for meeting recording state so the sidebar badge stays in
  // sync while the user is on other tabs. 2s is a good balance — fast enough
  // that the dot appears/disappears without visible lag, cheap enough not to
  // matter (single IPC call).
  const syncMeetingState = useMeetingStore((s) => s.syncFromBackend);
  useEffect(() => {
    if (onboardingStep !== "done") return;
    syncMeetingState();
    const id = setInterval(syncMeetingState, 2000);
    return () => clearInterval(id);
  }, [onboardingStep, syncMeetingState]);

  // Initialize Enigo, shortcuts, and refresh audio devices when main app loads
  useEffect(() => {
    if (onboardingStep === "done" && !hasCompletedPostOnboardingInit.current) {
      hasCompletedPostOnboardingInit.current = true;
      Promise.all([
        commands.initializeEnigo(),
        commands.initializeShortcuts(),
      ]).catch((e) => {
        console.warn("Failed to initialize:", e);
      });
      refreshAudioDevices();
      refreshOutputDevices();
    }
  }, [onboardingStep, refreshAudioDevices, refreshOutputDevices]);

  // Listen for recording errors from the backend and show a toast
  useEffect(() => {
    const unlisten = listen<RecordingErrorEvent>("recording-error", (event) => {
      const { error_type, detail } = event.payload;

      if (error_type === "microphone_permission_denied") {
        const currentPlatform = platform();
        const platformKey = `errors.micPermissionDenied.${currentPlatform}`;
        const description = t(platformKey, {
          defaultValue: t("errors.micPermissionDenied.generic"),
        });
        toast.error(t("errors.micPermissionDeniedTitle"), { description });
      } else if (error_type === "no_input_device") {
        toast.error(t("errors.noInputDeviceTitle"), {
          description: t("errors.noInputDevice"),
        });
      } else {
        toast.error(
          t("errors.recordingFailed", { error: detail ?? "Unknown error" }),
        );
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [t]);

  // Listen for paste failures and show a toast.
  // The technical error detail is logged to handy.log on the Rust side
  // (see actions.rs `error!("Failed to paste transcription: ...")`),
  // so we show a localized, user-friendly message here instead of the raw error.
  useEffect(() => {
    const unlisten = listen("paste-error", () => {
      toast.error(t("errors.pasteFailedTitle"), {
        description: t("errors.pasteFailed"),
      });
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [t]);

  // Listen for transcription failures and show a toast.
  // The payload is the backend error message (also logged to handy.log).
  useEffect(() => {
    const unlisten = listen<string>("transcription-error", (event) => {
      toast.error(t("errors.transcriptionFailedTitle"), {
        description: event.payload,
      });
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [t]);

  // Listen for model loading failures and show a toast
  useEffect(() => {
    const unlisten = listen<ModelStateEvent>("model-state-changed", (event) => {
      if (event.payload.event_type === "loading_failed") {
        toast.error(
          t("errors.modelLoadFailed", {
            model:
              event.payload.model_name || t("errors.modelLoadFailedUnknown"),
          }),
          {
            description: event.payload.error,
          },
        );
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [t]);

  const revealMainWindowForPermissions = async () => {
    try {
      await commands.showMainWindowCommand();
    } catch (e) {
      console.warn("Failed to show main window for permission onboarding:", e);
    }
  };

  const checkOnboardingStatus = async () => {
    try {
      const settingsResult = await commands.getAppSettings();
      const hasCompletedOnboarding =
        settingsResult.status === "ok" &&
        settingsResult.data.onboarding_completed === true;
      const currentPlatform = platform();

      // DEV-ONLY bypass: macOS re-signs the unsigned `tauri dev` binary on
      // every rebuild, which invalidates the Accessibility grant and traps the
      // onboarding wizard on "Waiting…". Skip the permission gate under Vite
      // dev so the app is usable locally. Never compiled into a release build
      // (import.meta.env.DEV is false there), so the real gate stays intact.
      // Text-injection still needs Accessibility granted to actually type.
      if (import.meta.env.DEV) {
        setIsReturningUser(hasCompletedOnboarding);
        setOnboardingStep(hasCompletedOnboarding ? "done" : "model");
        return;
      }

      if (hasCompletedOnboarding) {
        // Returning user - check if they need to grant permissions first
        setIsReturningUser(true);

        if (currentPlatform === "macos") {
          try {
            const [hasAccessibility, hasMicrophone] = await Promise.all([
              checkAccessibilityPermission(),
              checkMicrophonePermission(),
            ]);
            if (!hasAccessibility || !hasMicrophone) {
              await revealMainWindowForPermissions();
              setOnboardingStep("accessibility");
              return;
            }
          } catch (e) {
            console.warn("Failed to check macOS permissions:", e);
            // If we can't check, proceed to main app and let them fix it there
          }
        }

        setOnboardingStep("done");
      } else {
        // New user - start full onboarding
        setIsReturningUser(false);
        setOnboardingStep("accessibility");
      }
    } catch (error) {
      console.error("Failed to check onboarding status:", error);
      setOnboardingStep("accessibility");
    }
  };

  const handleAccessibilityComplete = () => {
    // Returning users already have models, skip to main app
    // New users need to select a model
    setOnboardingStep(isReturningUser ? "done" : "model");
  };

  const handleModelSelected = () => {
    // Transition to main app - user has started a download
    setOnboardingStep("done");
  };

  // Rendered once around every step below (including onboarding) so
  // toast.error() calls surface to the user. sonner renders via a portal, so
  // its position in the tree doesn't affect layout. Without this, errors during
  // onboarding (e.g. a model download failing because blob.handy.computer is
  // unreachable) are silently swallowed and the wizard just appears to "blink".
  const toaster = (
    <Toaster
      theme={settings?.theme ?? "system"}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            "bg-surface border border-mid-gray/20 rounded-lg shadow-menu px-4 py-3 flex items-center gap-3 text-sm",
          title: "font-medium",
          description: "text-mid-gray",
          actionButton:
            "px-2 py-1 text-xs font-medium rounded-lg border bg-mid-gray/10 border-mid-gray/20 hover:bg-background-ui/30 hover:border-logo-primary cursor-pointer whitespace-nowrap",
        },
      }}
    />
  );

  // Still checking onboarding status
  if (onboardingStep === null) {
    return null;
  }

  // Select the content for the current step. The Toaster is rendered once, in a
  // stable wrapper around this node, so crossing between onboarding steps and
  // the main app never remounts it (which would drop any in-flight toast).
  let content: ReactNode;
  if (onboardingStep === "accessibility") {
    content = (
      <AccessibilityOnboarding onComplete={handleAccessibilityComplete} />
    );
  } else if (onboardingStep === "model") {
    content = <Onboarding onModelSelected={handleModelSelected} />;
  } else {
    // The window is one non-scrolling row: the sidebar is a fixed-height flex
    // child whose gradient covers the whole column, and `main` is the only
    // scroller.
    content = (
      <div className="h-screen overflow-hidden flex select-none cursor-default">
        <Sidebar
          activeSection={currentSection}
          onSectionChange={setCurrentSection}
        />
        <main ref={mainScrollRef} className="flex-1 min-h-0 overflow-y-auto">
          <SectionHeader section={currentSection} />
          <div className="flex flex-col items-center px-6 py-6 gap-6">
            <AccessibilityPermissions />
            <SecureInputWarning />
            {renderSettingsContent(currentSection)}
          </div>
        </main>
      </div>
    );
  }

  return (
    <>
      {toaster}
      {content}
    </>
  );
}

export default App;
