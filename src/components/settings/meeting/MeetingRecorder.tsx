import React from "react";
import { useTranslation } from "react-i18next";
import { FileAudio, Loader2, Mic, Square, Upload } from "lucide-react";
import { Button } from "../../ui/Button";
import { formatDuration, type MeetingPhase } from "./useMeetings";

interface MeetingRecorderProps {
  phase: MeetingPhase;
  elapsed: number;
  isDragging: boolean;
  hasKey: boolean;
  onStart: () => void;
  onStop: () => void;
  onUpload: () => void;
}

export const MeetingRecorder: React.FC<MeetingRecorderProps> = ({
  phase,
  elapsed,
  isDragging,
  hasKey,
  onStart,
  onStop,
  onUpload,
}) => {
  const { t } = useTranslation();

  return (
    <div className="space-y-2">
      {/* Hero surface: always dark, on its own sweep rather than the sidebar's.
          The sidebar starts at the page purple, which *is* the page in the dark
          theme, so the hero would otherwise dissolve into it. .scope-dark
          re-points the palette so every token inside resolves to its dark
          value in both themes. */}
      <div
        className={`scope-dark bg-hero-gradient text-text relative border rounded-xl px-4 py-8 flex flex-col items-center gap-4 transition-colors ${
          isDragging
            ? "border-pink border-dashed"
            : "border-[var(--color-hero-edge)]"
        }`}
      >
        {phase === "recording" && (
          <>
            <div
              className="flex items-center gap-3 text-text"
              role="status"
              aria-live="polite"
            >
              <span
                className="w-3 h-3 rounded-full bg-pink animate-pulse"
                aria-hidden="true"
              />
              <span className="text-sm text-mid-gray">
                {t("meeting.recording")}
              </span>
              <span className="font-mono text-3xl font-semibold tabular-nums">
                {formatDuration(elapsed)}
              </span>
            </div>
            <Button
              onClick={onStop}
              variant="primary"
              size="lg"
              className="flex items-center gap-2 min-w-48 justify-center"
            >
              <Square className="w-4 h-4" aria-hidden="true" />
              {t("meeting.stop")}
            </Button>
          </>
        )}

        {phase === "transcribing" && (
          <div
            className="flex items-center gap-2 text-text py-3"
            role="status"
            aria-live="polite"
          >
            <Loader2
              className="w-5 h-5 animate-spin text-accent-cool"
              aria-hidden="true"
            />
            <span className="text-sm">{t("meeting.transcribing")}</span>
          </div>
        )}

        {phase === "idle" && (
          <>
            <Button
              onClick={onStart}
              variant="primary"
              size="lg"
              className="flex items-center gap-2 min-w-56 justify-center py-3 text-lg shadow-menu"
            >
              <Mic className="w-5 h-5" aria-hidden="true" />
              {t("meeting.record")}
            </Button>
            <Button
              onClick={onUpload}
              variant="ghost"
              size="sm"
              className="flex items-center gap-1.5 text-text/85 hover:bg-white/10 hover:border-transparent"
            >
              <Upload className="w-3.5 h-3.5" aria-hidden="true" />
              {t("meeting.upload")}
            </Button>
            <p className="text-xs text-mid-gray text-center max-w-md">
              {t("meeting.hint")}
            </p>
          </>
        )}

        {isDragging && (
          <div className="absolute inset-0 rounded-xl bg-background/90 flex flex-col items-center justify-center gap-2 text-pink pointer-events-none">
            <FileAudio className="w-6 h-6" aria-hidden="true" />
            <span className="text-sm font-medium">
              {t("meeting.dropActive")}
            </span>
          </div>
        )}
      </div>

      {!hasKey && (
        <p className="px-4 text-xs text-warning">{t("meeting.noKey")}</p>
      )}
    </div>
  );
};
