import React from "react";
import { useTranslation } from "react-i18next";
import { Cog, History, Info, Sparkles, Cpu, Users } from "lucide-react";
import KandyTextLogo from "./icons/KandyTextLogo";
import MicrophoneOutlineIcon from "./icons/MicrophoneOutlineIcon";
import { useMeetingStore } from "../stores/meetingStore";
import {
  GeneralSettings,
  AdvancedSettings,
  HistorySettings,
  AboutSettings,
  PostProcessingSettings,
  ModelsSettings,
  MeetingSettings,
} from "./settings";

export type SidebarSection = keyof typeof SECTIONS_CONFIG;

interface IconProps {
  width?: number | string;
  height?: number | string;
  className?: string;
  [key: string]: any;
}

interface SectionConfig {
  labelKey: string;
  descriptionKey: string;
  icon: React.ComponentType<IconProps>;
  component: React.ComponentType;
  /** Visual grouping in the sidebar: everyday use vs. configuration. */
  group: "use" | "configure" | "meta";
}

export const SECTIONS_CONFIG = {
  meeting: {
    labelKey: "sidebar.meeting",
    descriptionKey: "sidebar.descriptions.meeting",
    group: "use",
    icon: Users,
    component: MeetingSettings,
  },
  history: {
    labelKey: "sidebar.history",
    descriptionKey: "sidebar.descriptions.history",
    group: "use",
    icon: History,
    component: HistorySettings,
  },
  general: {
    labelKey: "sidebar.general",
    descriptionKey: "sidebar.descriptions.general",
    group: "configure",
    icon: MicrophoneOutlineIcon,
    component: GeneralSettings,
  },
  models: {
    labelKey: "sidebar.models",
    descriptionKey: "sidebar.descriptions.models",
    group: "configure",
    icon: Cpu,
    component: ModelsSettings,
  },
  postprocessing: {
    labelKey: "sidebar.postProcessing",
    descriptionKey: "sidebar.descriptions.postProcessing",
    group: "configure",
    icon: Sparkles,
    component: PostProcessingSettings,
  },
  advanced: {
    labelKey: "sidebar.advanced",
    descriptionKey: "sidebar.descriptions.advanced",
    group: "configure",
    icon: Cog,
    component: AdvancedSettings,
  },
  about: {
    labelKey: "sidebar.about",
    descriptionKey: "sidebar.descriptions.about",
    group: "meta",
    icon: Info,
    component: AboutSettings,
  },
} as const satisfies Record<string, SectionConfig>;

interface SidebarProps {
  activeSection: SidebarSection;
  onSectionChange: (section: SidebarSection) => void;
}

const GROUPS: SectionConfig["group"][] = ["use", "configure", "meta"];

export const Sidebar: React.FC<SidebarProps> = ({
  activeSection,
  onSectionChange,
}) => {
  const { t } = useTranslation();
  const meetingPhase = useMeetingStore((s) => s.phase);

  const availableSections = Object.entries(SECTIONS_CONFIG).map(
    ([id, config]) => ({ id: id as SidebarSection, ...config }),
  );

  return (
    <nav
      aria-label={t("sidebar.navLabel")}
      // Always the dark brand surface, whatever the active theme: .scope-dark
      // re-points the palette tokens so text-text, text-mid-gray etc. resolve
      // to their dark values on top of the purple-to-navy sweep.
      className="scope-dark bg-brand-gradient text-text flex flex-col w-52 h-full min-h-0 shrink-0 overflow-y-auto px-3 py-4 gap-2 border-e border-edge"
    >
      <KandyTextLogo width={120} wordmark="text" className="mx-1 mb-2" />
      {GROUPS.map((group) => {
        const items = availableSections.filter((s) => s.group === group);
        if (items.length === 0) return null;
        return (
          <div
            key={group}
            className={`flex flex-col gap-0.5 ${group === "meta" ? "mt-auto" : ""}`}
          >
            {group !== "meta" && (
              <span className="px-2.5 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wider text-mid-gray">
                {t(`sidebar.groups.${group}`)}
              </span>
            )}
            {items.map((section) => {
              const Icon = section.icon;
              const isActive = activeSection === section.id;
              const showRecordingDot =
                section.id === "meeting" && meetingPhase === "recording";

              return (
                <button
                  key={section.id}
                  type="button"
                  aria-current={isActive ? "page" : undefined}
                  onClick={() => onSectionChange(section.id)}
                  className={`flex gap-2.5 items-center px-2.5 h-9 w-full shrink-0 rounded-lg cursor-pointer transition-colors text-start focus:outline-none focus-visible:ring-2 focus-visible:ring-off-white ${
                    isActive
                      ? "bg-background-ui text-on-accent"
                      : "text-text/85 hover:bg-white/10 hover:text-text"
                  }`}
                >
                  <Icon width={18} height={18} className="shrink-0" />
                  <span className="text-sm font-medium truncate flex-1">
                    {t(section.labelKey)}
                  </span>
                  {showRecordingDot && (
                    <span
                      aria-label={t("meeting.transcribing")}
                      className={`w-2 h-2 rounded-full animate-pulse shrink-0 ${
                        isActive ? "bg-on-accent" : "bg-pink"
                      }`}
                    />
                  )}
                </button>
              );
            })}
          </div>
        );
      })}
    </nav>
  );
};
