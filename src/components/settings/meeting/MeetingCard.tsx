import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Check,
  Copy,
  Download,
  Loader2,
  RefreshCw,
  Sparkles,
  X,
} from "lucide-react";
import type { Meeting } from "@/bindings";
import { formatDateTime, formatListTimestamp } from "@/utils/dateFormat";
import { AudioPlayer } from "../../ui/AudioPlayer";
import { Button } from "../../ui/Button";
import { IconButton } from "../../ui/IconButton";
import { EditableText, ExportMenu, Textarea } from "../../ui";
import { InlineTitle } from "./InlineTitle";
import { Highlight } from "./MeetingSearch";
import { formatDuration, type MeetingActions } from "./useMeetings";

const SECTION_HEADING =
  "text-[11px] font-semibold uppercase tracking-wider text-mid-gray";

interface MeetingCardProps {
  meeting: Meeting;
  model: string;
  hasKey: boolean;
  summarizing: boolean;
  expanded: boolean;
  onToggle: () => void;
  /** Active search terms, for highlighting. Empty when not searching. */
  terms: string[];
  /** Snippet around the first hit; null when not searching or hit is in title. */
  snippet: string | null;
  /** Global summary prompt; the starting point when a meeting has none. */
  defaultPrompt: string;
  onRequestDelete: () => void;
  actions: MeetingActions;
}

/**
 * One meeting in the list.
 *
 * Collapsed it carries a title, a timestamp and a delete cross, nothing else.
 * The header row is the expand/collapse control itself, so there is no chevron
 * to aim at; the title and the cross stop the click from reaching it.
 */
export const MeetingCard: React.FC<MeetingCardProps> = ({
  meeting,
  model,
  hasKey,
  summarizing,
  expanded,
  onToggle,
  terms,
  snippet,
  defaultPrompt,
  onRequestDelete,
  actions,
}) => {
  const { t, i18n } = useTranslation();
  const hasSummary = Boolean(meeting.summary);
  const summary = meeting.summary ?? "";

  const [copied, setCopied] = useState<"summary" | "transcript" | null>(null);
  const copy = async (text: string, which: "summary" | "transcript") => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      /* clipboard unavailable */
    }
  };

  // Meeting-specific prompt. Starts from the prompt this meeting was last
  // summarised with, else the global one. Persisted on the meeting by the
  // backend when a summary is generated.
  const [promptDraft, setPromptDraft] = useState(
    meeting.summary_prompt ?? defaultPrompt,
  );
  useEffect(() => {
    setPromptDraft(meeting.summary_prompt ?? defaultPrompt);
  }, [meeting.summary_prompt, defaultPrompt]);
  const promptIsCustom = promptDraft.trim() !== defaultPrompt.trim();

  const timestamp = formatListTimestamp(
    String(meeting.timestamp),
    i18n.language,
  );
  const duration = formatDuration(meeting.duration_secs);
  // Exports carry the full date rather than the list's weekday shorthand.
  const subtitle = `${formatDateTime(String(meeting.timestamp), i18n.language)} · ${duration}`;

  const handleLoadAudio = useCallback(
    () => actions.getAudioUrl(meeting.audio_file),
    [actions, meeting.audio_file],
  );

  const handleRename = useCallback(
    (title: string) => actions.renameMeeting(meeting.id, title),
    [actions, meeting.id],
  );

  const handleHeaderKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      // Keystrokes from the title or the cross are theirs to handle.
      if (event.target !== event.currentTarget) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onToggle();
      }
    },
    [onToggle],
  );

  const bodyId = `meeting-${meeting.id}-body`;

  return (
    <article
      className={`rounded-lg border bg-surface shadow-card transition-colors ${
        expanded ? "border-logo-primary/40" : "border-card-border"
      }`}
    >
      <div
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        aria-controls={bodyId}
        aria-label={expanded ? t("meeting.collapse") : t("meeting.expand")}
        onClick={onToggle}
        onKeyDown={handleHeaderKeyDown}
        className="flex items-start gap-2 rounded-lg px-3 py-3 cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-logo-primary"
      >
        <div className="min-w-0 flex-1 space-y-0.5">
          <InlineTitle
            value={meeting.title}
            label={t("export.edit.editTitle")}
            onSave={handleRename}
          />
          <p className="px-1 text-xs text-mid-gray">{timestamp}</p>
          {!expanded && snippet && (
            <p className="px-1 text-xs text-text/70 truncate">
              <Highlight text={snippet} terms={terms} />
            </p>
          )}
        </div>

        <button
          type="button"
          aria-label={t("meeting.delete")}
          title={t("meeting.delete")}
          onClick={(event) => {
            event.stopPropagation();
            onRequestDelete();
          }}
          className="mt-0.5 shrink-0 rounded p-0.5 text-mid-gray cursor-pointer transition-colors hover:text-danger focus:outline-none focus-visible:ring-1 focus-visible:ring-logo-primary"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {expanded && (
        <div
          id={bodyId}
          className="border-t border-mid-gray/20 px-4 py-3 space-y-4"
        >
          <section className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h3 className={SECTION_HEADING}>
                {t("meeting.sections.summary")}
              </h3>
              {hasSummary && (
                <div className="flex items-center gap-0.5">
                  <IconButton
                    label={t("meeting.regenerate")}
                    onClick={() => void actions.summarize(meeting.id, null)}
                    disabled={summarizing || !hasKey}
                  >
                    <RefreshCw
                      className={`w-3.5 h-3.5 ${summarizing ? "animate-spin" : ""}`}
                    />
                  </IconButton>
                  <IconButton
                    label={t("meeting.copySummary")}
                    onClick={() => copy(summary, "summary")}
                  >
                    {copied === "summary" ? (
                      <Check className="w-3.5 h-3.5" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </IconButton>
                  <ExportMenu
                    compact
                    buildDoc={() => ({
                      title: meeting.title,
                      subtitle,
                      markdown: summary,
                    })}
                  />
                </div>
              )}
            </div>

            {hasSummary ? (
              <>
                <EditableText
                  value={summary}
                  editLabel={t("export.edit.editSummary")}
                  onSave={(next) => actions.saveSummary(meeting.id, next)}
                />
                <p className="text-xs text-mid-gray">
                  {t("meeting.disclaimer", { model: meeting.model ?? model })}
                </p>
              </>
            ) : summarizing ? (
              <div className="flex items-center gap-2 py-2 text-sm text-mid-gray">
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                {t("meeting.summarizing")}
              </div>
            ) : hasKey ? (
              <div className="flex justify-center py-4">
                <Button
                  onClick={() => void actions.summarize(meeting.id, null)}
                  variant="primary"
                  size="md"
                  className="flex items-center gap-1.5"
                >
                  <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
                  {t("meeting.generateSummary")}
                </Button>
              </div>
            ) : (
              <p className="py-4 text-center text-sm text-mid-gray">
                {t("meeting.addKeyHint")}
              </p>
            )}
          </section>

          <section className="flex flex-col gap-2">
            <h3 className={SECTION_HEADING}>
              {t("meeting.customPrompt.title")}
            </h3>
            <Textarea
              value={promptDraft}
              onChange={(e) => setPromptDraft(e.target.value)}
              rows={4}
              variant="compact"
              aria-label={t("meeting.customPrompt.title")}
              className="w-full whitespace-pre-wrap"
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-mid-gray">
                {t("meeting.customPrompt.help")}
              </p>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  onClick={() => setPromptDraft(defaultPrompt)}
                  variant="ghost"
                  size="sm"
                  disabled={!promptIsCustom}
                >
                  {t("meeting.customPrompt.reset")}
                </Button>
                <Button
                  onClick={() =>
                    void actions.summarize(meeting.id, promptDraft)
                  }
                  variant="primary"
                  size="sm"
                  className="flex items-center gap-1.5"
                  disabled={summarizing || !hasKey || !promptDraft.trim()}
                  title={hasKey ? undefined : t("meeting.addKeyHint")}
                >
                  {summarizing ? (
                    <Loader2
                      className="w-3.5 h-3.5 animate-spin"
                      aria-hidden="true"
                    />
                  ) : (
                    <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
                  )}
                  {t("meeting.customPrompt.run")}
                </Button>
              </div>
            </div>
          </section>

          <section className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h3 className={SECTION_HEADING}>
                {t("meeting.sections.transcript")}
              </h3>
              {meeting.transcript && (
                <div className="flex items-center gap-0.5">
                  <IconButton
                    label={t("meeting.copyTranscript")}
                    onClick={() => copy(meeting.transcript, "transcript")}
                  >
                    {copied === "transcript" ? (
                      <Check className="w-3.5 h-3.5" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </IconButton>
                  <ExportMenu
                    compact
                    buildDoc={() => ({
                      title: meeting.title,
                      subtitle,
                      markdown: meeting.transcript,
                      bodyFormat: "text",
                    })}
                  />
                </div>
              )}
            </div>
            <EditableText
              value={meeting.transcript}
              format="text"
              emptyLabel={t("meeting.noTranscript")}
              editLabel={t("export.edit.editTranscript")}
              onSave={(next) => actions.saveTranscript(meeting.id, next)}
            />
          </section>

          {meeting.audio_file && (
            <div className="flex items-center gap-2">
              <AudioPlayer onLoadRequest={handleLoadAudio} className="flex-1" />
              <span className="shrink-0 text-xs text-mid-gray tabular-nums">
                {duration}
              </span>
              <IconButton
                label={t("meeting.downloadAudio")}
                onClick={() => void actions.downloadAudio(meeting)}
              >
                <Download className="w-4 h-4" />
              </IconButton>
            </div>
          )}
        </div>
      )}
    </article>
  );
};
