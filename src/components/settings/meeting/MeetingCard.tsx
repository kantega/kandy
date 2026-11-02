import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlignLeft,
  Check,
  ChevronsUpDown,
  Copy,
  Download,
  ListTree,
  Loader2,
  RefreshCw,
  Settings,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import type { Meeting } from "@/bindings";
import type { ExportDoc } from "@/lib/export";
import { formatDateTime, formatListTimestamp } from "@/utils/dateFormat";
import { AudioPlayer, type AudioPlayerHandle } from "../../ui/AudioPlayer";
import { Button } from "../../ui/Button";
import { IconButton } from "../../ui/IconButton";
import {
  ActionMenu,
  type ActionMenuItem,
  Dialog,
  EditableText,
  EXPORT_FORMATS,
  Textarea,
  useExportAction,
} from "../../ui";
import { InlineTitle } from "./InlineTitle";
import { MeetingStatusLine, type MeetingStep } from "./MeetingStatusLine";
import { MeetingTranscript } from "./MeetingTranscript";
import { Highlight } from "./MeetingSearch";
import { formatDuration, type MeetingActions } from "./useMeetings";

type Tab = "summary" | "transcript";

interface TabButtonProps {
  selected: boolean;
  onSelect: () => void;
  icon: typeof Sparkles;
  label: string;
}

const TabButton: React.FC<TabButtonProps> = ({
  selected,
  onSelect,
  icon: Icon,
  label,
}) => (
  <button
    type="button"
    role="tab"
    aria-selected={selected}
    onClick={onSelect}
    className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium cursor-pointer transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-logo-primary ${
      selected
        ? "bg-surface text-text shadow-card"
        : "text-mid-gray hover:text-text"
    }`}
  >
    <Icon className="w-4 h-4" aria-hidden="true" />
    {label}
  </button>
);

interface MeetingCardProps {
  meeting: Meeting;
  model: string;
  hasKey: boolean;
  summarizing: boolean;
  chaptering: boolean;
  improving: boolean;
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
 * Collapsed it carries a title, a line of facts and a delete cross, nothing
 * else. The header row is the expand/collapse control itself; the title and
 * the cross stop the click from reaching it.
 *
 * Open, the recording sits at the top and stays there while scrolling, so it
 * is in reach from any time in the transcript. Below it a status line shows
 * what is still being made, and two tabs hold the two kinds of text: the
 * summary, set as a document to read and share, and the transcript, set as
 * source material with chapters and times.
 */
export const MeetingCard: React.FC<MeetingCardProps> = ({
  meeting,
  model,
  hasKey,
  summarizing,
  chaptering,
  improving,
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
  const hasChapters = meeting.chapters.length > 0;
  const hasParagraphs = meeting.paragraphs.length > 0;
  const hasTranscript = meeting.transcript.trim().length > 0;
  const exportDoc = useExportAction();

  const [tab, setTab] = useState<Tab>(() =>
    meeting.summary || summarizing ? "summary" : "transcript",
  );

  const [copied, setCopied] = useState(false);
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  };

  // Meeting-specific prompt. Starts from the prompt this meeting was last
  // summarised with, else the global one. Persisted on the meeting by the
  // backend when a summary is generated.
  const [promptOpen, setPromptOpen] = useState(false);
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
  const facts = [
    timestamp,
    duration,
    hasChapters
      ? t("meeting.chapterCount", { count: meeting.chapters.length })
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const handleLoadAudio = useCallback(
    () => actions.getAudioUrl(meeting.audio_file),
    [actions, meeting.audio_file],
  );

  const [confirmAudioDelete, setConfirmAudioDelete] = useState(false);
  const [deletingAudio, setDeletingAudio] = useState(false);

  const handleDeleteAudio = async () => {
    setDeletingAudio(true);
    try {
      await actions.deleteAudio(meeting.id);
      setConfirmAudioDelete(false);
    } finally {
      setDeletingAudio(false);
    }
  };

  const playerRef = useRef<AudioPlayerHandle>(null);
  const handleSeek = useCallback((ms: number) => {
    playerRef.current?.seekTo(ms / 1000);
  }, []);

  // The chapter the recording is in, for the highlight in the transcript.
  // Set only when it changes, not on every position update.
  const [activeChapter, setActiveChapter] = useState<number | null>(null);
  const chaptersRef = useRef(meeting.chapters);
  useEffect(() => {
    chaptersRef.current = meeting.chapters;
  }, [meeting.chapters]);
  const handleTimeUpdate = useCallback((seconds: number) => {
    const ms = seconds * 1000;
    const after = chaptersRef.current.findIndex((c) => c.start_ms > ms);
    const last = after === -1 ? chaptersRef.current.length - 1 : after - 1;
    const index = last >= 0 ? last : null;
    setActiveChapter((current) => (current === index ? current : index));
  }, []);

  // Chapters start folded, so the transcript first reads as a table of
  // contents. New chapters fold again, since old indexes no longer apply.
  const [openChapters, setOpenChapters] = useState<ReadonlySet<number>>(
    () => new Set(),
  );
  const chapterStarts = meeting.chapters.map((c) => c.start_ms).join(",");
  useEffect(() => {
    setOpenChapters(new Set());
    setActiveChapter(null);
  }, [chapterStarts]);
  const allChaptersOpen =
    hasChapters && openChapters.size === meeting.chapters.length;

  const toggleChapter = useCallback((index: number) => {
    setOpenChapters((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  const handleSaveParagraph = useCallback(
    (index: number, text: string) =>
      actions.saveParagraph(meeting.id, index, text),
    [actions, meeting.id],
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

  const exportItems = (buildDoc: () => ExportDoc): ActionMenuItem[] =>
    EXPORT_FORMATS.map(({ format, labelKey, Icon }, index) => ({
      label: t(labelKey),
      icon: Icon,
      onSelect: () => void exportDoc(buildDoc(), format),
      separated: index === 0,
    }));

  const busy = summarizing || chaptering || improving;

  const summaryMenu: ActionMenuItem[] = [
    {
      label: t("meeting.regenerate"),
      icon: RefreshCw,
      onSelect: () => void actions.summarize(meeting.id, null),
      disabled: busy || !hasKey,
    },
    {
      label: t("meeting.customPrompt.title"),
      icon: Settings,
      onSelect: () => setPromptOpen((open) => !open),
    },
    ...(hasSummary
      ? exportItems(() => ({
          title: meeting.title,
          subtitle,
          markdown: summary,
        }))
      : []),
  ];

  const transcriptMenu: ActionMenuItem[] = [
    ...(hasChapters
      ? [
          {
            label: allChaptersOpen
              ? t("meeting.chapters.collapseAll")
              : t("meeting.chapters.expandAll"),
            icon: ChevronsUpDown,
            onSelect: () =>
              setOpenChapters(
                allChaptersOpen
                  ? new Set()
                  : new Set(meeting.chapters.map((_, index) => index)),
              ),
          },
        ]
      : []),
    {
      label: hasChapters
        ? t("meeting.chapters.regenerate")
        : t("meeting.chapters.generate"),
      icon: ListTree,
      onSelect: () => void actions.generateChapters(meeting.id),
      disabled: busy || !hasKey,
    },
    ...(hasParagraphs
      ? []
      : [
          {
            label: t("meeting.improve.run"),
            icon: Sparkles,
            onSelect: () => void actions.improveTranscript(meeting.id),
            disabled: busy || !hasKey,
          },
        ]),
    ...(hasTranscript
      ? exportItems(() => ({
          title: meeting.title,
          subtitle,
          markdown: meeting.transcript,
          bodyFormat: "text",
        }))
      : []),
  ];

  const audioMenu: ActionMenuItem[] = [
    {
      label: t("meeting.downloadAudio"),
      icon: Download,
      onSelect: () => void actions.downloadAudio(meeting),
    },
    {
      label: t("meeting.deleteAudio"),
      icon: Trash2,
      onSelect: () => setConfirmAudioDelete(true),
      danger: true,
      separated: true,
    },
  ];

  const steps: MeetingStep[] = [
    {
      label: t("meeting.sections.summary"),
      done: hasSummary,
      running: summarizing,
      onRun: () => void actions.summarize(meeting.id, null),
      runLabel: t("meeting.generateSummary"),
    },
    {
      label: t("meeting.status.chapters"),
      done: hasChapters,
      running: chaptering,
      onRun: () => void actions.generateChapters(meeting.id),
      runLabel: t("meeting.chapters.generate"),
    },
    {
      label: t("meeting.sections.transcript"),
      done: hasParagraphs,
      running: improving,
      onRun: () => void actions.improveTranscript(meeting.id),
      runLabel: t("meeting.improve.run"),
    },
  ];

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
        className="flex items-start gap-2 rounded-lg px-5 py-4 cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-logo-primary"
      >
        <div className="min-w-0 flex-1 space-y-0.5">
          <InlineTitle
            value={meeting.title}
            label={t("export.edit.editTitle")}
            onSave={handleRename}
          />
          <p className="px-1 text-xs text-mid-gray">{facts}</p>
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
        <div id={bodyId} className="border-t border-mid-gray/20">
          {meeting.audio_file ? (
            // Sticky, so the recording stays in reach while reading and
            // clicking times far down a long transcript.
            <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-mid-gray/20 bg-surface px-5 py-2.5">
              <AudioPlayer
                ref={playerRef}
                onLoadRequest={handleLoadAudio}
                onTimeUpdate={handleTimeUpdate}
                className="flex-1"
              />
              <ActionMenu label={t("meeting.audioActions")} items={audioMenu} />
            </div>
          ) : (
            <p className="border-b border-mid-gray/20 px-5 py-2.5 text-xs text-mid-gray">
              {t("meeting.audioDeleted")}
            </p>
          )}

          <div className="space-y-5 px-5 pt-4 pb-6">
            {hasTranscript && (
              <MeetingStatusLine steps={steps} hasKey={hasKey} />
            )}

            <div className="flex items-center justify-between gap-2">
              <div
                role="tablist"
                className="inline-flex gap-1 rounded-lg bg-mid-gray/10 p-1"
              >
                <TabButton
                  selected={tab === "summary"}
                  onSelect={() => setTab("summary")}
                  icon={Sparkles}
                  label={t("meeting.sections.summary")}
                />
                <TabButton
                  selected={tab === "transcript"}
                  onSelect={() => setTab("transcript")}
                  icon={AlignLeft}
                  label={t("meeting.sections.transcript")}
                />
              </div>

              <div className="flex items-center gap-0.5">
                {(tab === "summary" ? hasSummary : hasTranscript) && (
                  <IconButton
                    label={
                      tab === "summary"
                        ? t("meeting.copySummary")
                        : t("meeting.copyTranscript")
                    }
                    onClick={() =>
                      copy(tab === "summary" ? summary : meeting.transcript)
                    }
                  >
                    {copied ? (
                      <Check className="w-4 h-4" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </IconButton>
                )}
                <ActionMenu
                  label={t("meeting.moreActions")}
                  items={tab === "summary" ? summaryMenu : transcriptMenu}
                />
              </div>
            </div>

            {tab === "summary" ? (
              <div role="tabpanel" className="space-y-3">
                {promptOpen && (
                  <div className="flex flex-col gap-2 rounded-lg border border-mid-gray/20 bg-mid-gray/5 p-4">
                    <p className="flex items-center gap-1.5 text-sm font-medium">
                      <Settings className="w-4 h-4" aria-hidden="true" />
                      {t("meeting.customPrompt.title")}
                    </p>
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
                          onClick={() => setPromptOpen(false)}
                          variant="ghost"
                          size="sm"
                        >
                          {t("settings.history.cancel")}
                        </Button>
                        <Button
                          onClick={() => setPromptDraft(defaultPrompt)}
                          variant="ghost"
                          size="sm"
                          disabled={!promptIsCustom}
                        >
                          {t("meeting.customPrompt.reset")}
                        </Button>
                        <Button
                          onClick={() => {
                            setPromptOpen(false);
                            void actions.summarize(meeting.id, promptDraft);
                          }}
                          variant="primary"
                          size="sm"
                          className="flex items-center gap-1.5"
                          disabled={busy || !hasKey || !promptDraft.trim()}
                          title={hasKey ? undefined : t("meeting.addKeyHint")}
                        >
                          <Sparkles
                            className="w-3.5 h-3.5"
                            aria-hidden="true"
                          />
                          {t("meeting.customPrompt.run")}
                        </Button>
                      </div>
                    </div>
                  </div>
                )}

                {hasSummary ? (
                  <>
                    <div className="rounded-xl border border-logo-primary/10 bg-logo-primary/[0.04] px-6 py-5">
                      <EditableText
                        className="max-w-[70ch]"
                        variant="document"
                        value={summary}
                        editLabel={t("export.edit.editSummary")}
                        onSave={(next) => actions.saveSummary(meeting.id, next)}
                      />
                    </div>
                    <p className="flex items-center gap-1.5 text-xs text-mid-gray">
                      <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
                      {t("meeting.disclaimer", {
                        model: meeting.model ?? model,
                      })}
                    </p>
                  </>
                ) : summarizing ? (
                  <div className="flex items-center gap-2 py-6 text-sm text-mid-gray">
                    <Loader2
                      className="w-4 h-4 animate-spin"
                      aria-hidden="true"
                    />
                    {t("meeting.summarizing")}
                  </div>
                ) : hasKey ? (
                  <div className="flex justify-center py-6">
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
                  <p className="py-6 text-center text-sm text-mid-gray">
                    {t("meeting.addKeyHint")}
                  </p>
                )}
              </div>
            ) : (
              <div role="tabpanel" className="space-y-4">
                {(hasChapters || hasParagraphs) && (
                  <MeetingTranscript
                    paragraphs={meeting.paragraphs}
                    chapters={meeting.chapters}
                    openChapters={openChapters}
                    activeChapter={activeChapter}
                    onToggleChapter={toggleChapter}
                    onSeek={handleSeek}
                    onSaveParagraph={handleSaveParagraph}
                  />
                )}
                {/* The plain transcript, until it has been split into timed
                    paragraphs. */}
                {!hasParagraphs && (
                  <EditableText
                    className="max-w-[70ch]"
                    value={meeting.transcript}
                    format="text"
                    emptyLabel={t("meeting.noTranscript")}
                    editLabel={t("export.edit.editTranscript")}
                    onSave={(next) => actions.saveTranscript(meeting.id, next)}
                  />
                )}
              </div>
            )}
          </div>
        </div>
      )}

      <Dialog
        open={confirmAudioDelete}
        onOpenChange={(open) => {
          if (!open && !deletingAudio) setConfirmAudioDelete(false);
        }}
        title={t("meeting.deleteAudioTitle")}
        description={t("meeting.deleteAudioDescription")}
        closeLabel={t("settings.history.cancel")}
        footer={
          <>
            <Button
              variant="secondary"
              size="md"
              disabled={deletingAudio}
              onClick={() => setConfirmAudioDelete(false)}
            >
              {t("settings.history.cancel")}
            </Button>
            <Button
              variant="danger"
              size="md"
              disabled={deletingAudio}
              onClick={() => void handleDeleteAudio()}
            >
              {deletingAudio
                ? t("settings.history.deleting")
                : t("meeting.confirmDeleteAudio")}
            </Button>
          </>
        }
      >
        <p className="text-sm text-text/80">
          {t("settings.history.deleteWarning")}
        </p>
      </Dialog>
    </article>
  );
};
