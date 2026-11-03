import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  FileAudio,
  FolderOpen,
  RotateCcw,
  Star,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  commands,
  events,
  type HistoryEntry,
  type HistoryUpdatePayload,
} from "@/bindings";
import { formatDateTime } from "@/utils/dateFormat";
import { AudioPlayer, AudioPlayerGroup } from "../../ui/AudioPlayer";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { CollapsibleText } from "../../ui/CollapsibleText";
import { EditableText } from "../../ui/EditableText";
import { ExportMenu } from "../../ui/ExportMenu";
import { IconButton } from "../../ui/IconButton";
import { copyToClipboard } from "./clipboard";

const PAGE_SIZE = 30;

/**
 * Transcripts shorter than this (and without a line break) are shown in full —
 * a collapse control would cost a click and save no space.
 */
const COLLAPSE_THRESHOLD = 180;

/** True when a transcript is long enough that collapsing it earns its keep. */
const isCollapsible = (text: string): boolean =>
  text.trim().length > COLLAPSE_THRESHOLD || text.trim().includes("\n");

/** An entry keeps its row after its recording is deleted, with no file name. */
const hasAudio = (entry: HistoryEntry): boolean => entry.file_name !== "";

interface OpenRecordingsButtonProps {
  onClick: () => void;
  label: string;
}

const OpenRecordingsButton: React.FC<OpenRecordingsButtonProps> = ({
  onClick,
  label,
}) => (
  <Button
    onClick={onClick}
    variant="secondary"
    size="sm"
    className="flex items-center gap-2"
    title={label}
  >
    <FolderOpen className="w-4 h-4" />
    <span>{label}</span>
  </Button>
);

export const HistorySettings: React.FC = () => {
  const { t, i18n } = useTranslation();
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<number>>(
    () => new Set(),
  );
  /** Entries the open confirmation is about; null when it is closed. */
  const [pendingDelete, setPendingDelete] = useState<HistoryEntry[] | null>(
    null,
  );
  const [includeSaved, setIncludeSaved] = useState(false);
  const [deleting, setDeleting] = useState(false);
  /** Entries whose recordings the open confirmation is about. */
  const [pendingAudioDelete, setPendingAudioDelete] = useState<
    HistoryEntry[] | null
  >(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const entriesRef = useRef<HistoryEntry[]>([]);
  const loadingRef = useRef(false);

  // Keep ref in sync for use in IntersectionObserver callback
  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  const loadPage = useCallback(async (cursor?: number) => {
    const isFirstPage = cursor === undefined;
    if (!isFirstPage && loadingRef.current) return;
    loadingRef.current = true;

    if (isFirstPage) setLoading(true);

    try {
      const result = await commands.getHistoryEntries(
        cursor ?? null,
        PAGE_SIZE,
      );
      if (result.status === "ok") {
        const { entries: newEntries, has_more } = result.data;
        // A live "added" event can land a row that the next page also
        // returns, so append only rows not already shown.
        setEntries((prev) => {
          if (isFirstPage) return newEntries;
          const existingIds = new Set(prev.map((entry) => entry.id));
          return [
            ...prev,
            ...newEntries.filter((entry) => !existingIds.has(entry.id)),
          ];
        });
        setHasMore(has_more);
      }
    } catch (error) {
      console.error("Failed to load history entries:", error);
    } finally {
      setLoading(false);
      loadingRef.current = false;
    }
  }, []);

  // Initial load
  useEffect(() => {
    loadPage();
  }, [loadPage]);

  // Infinite scroll via IntersectionObserver
  useEffect(() => {
    if (loading) return;

    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore) return;

    const observer = new IntersectionObserver(
      (observerEntries) => {
        const first = observerEntries[0];
        if (first.isIntersecting) {
          const lastEntry = entriesRef.current[entriesRef.current.length - 1];
          if (lastEntry) {
            loadPage(lastEntry.id);
          }
        }
      },
      { threshold: 0 },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loading, hasMore, loadPage]);

  // Listen for new entries added from the transcription pipeline
  useEffect(() => {
    const unlisten = events.historyUpdatePayload.listen((event) => {
      const payload: HistoryUpdatePayload = event.payload;
      if (payload.action === "added") {
        setEntries((prev) => [
          payload.entry,
          ...prev.filter((entry) => entry.id !== payload.entry.id),
        ]);
      } else if (payload.action === "updated") {
        setEntries((prev) =>
          prev.map((e) => (e.id === payload.entry.id ? payload.entry : e)),
        );
      }
      // "deleted" and "toggled" are handled by optimistic updates only,
      // so we intentionally ignore them here to avoid double-mutation.
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const toggleSaved = async (id: number) => {
    // Optimistic update
    setEntries((prev) =>
      prev.map((e) => (e.id === id ? { ...e, saved: !e.saved } : e)),
    );
    try {
      const result = await commands.toggleHistoryEntrySaved(id);
      if (result.status !== "ok") {
        // Revert on failure
        setEntries((prev) =>
          prev.map((e) => (e.id === id ? { ...e, saved: !e.saved } : e)),
        );
      }
    } catch (error) {
      console.error("Failed to toggle saved status:", error);
      // Revert on failure
      setEntries((prev) =>
        prev.map((e) => (e.id === id ? { ...e, saved: !e.saved } : e)),
      );
    }
  };

  const getAudioUrl = useCallback(async (fileName: string) => {
    try {
      const result = await commands.getAudioFilePath(fileName);
      if (result.status === "ok") {
        return convertFileSrc(result.data, "asset");
      }
      return null;
    } catch (error) {
      console.error("Failed to get audio file path:", error);
      return null;
    }
  }, []);

  const deselect = useCallback((ids: readonly number[]) => {
    setSelectedIds((prev) => {
      if (!ids.some((id) => prev.has(id))) return prev;
      const next = new Set(prev);
      for (const id of ids) next.delete(id);
      return next;
    });
  }, []);

  const deleteAudioEntry = async (id: number) => {
    // Optimistically remove
    setEntries((prev) => prev.filter((e) => e.id !== id));
    deselect([id]);
    try {
      const result = await commands.deleteHistoryEntry(id);
      if (result.status !== "ok") {
        // Reload on failure
        loadPage();
      }
    } catch (error) {
      console.error("Failed to delete entry:", error);
      loadPage();
    }
  };

  /**
   * Delete the recordings of `ids` and keep their transcripts. Optimistic, and
   * rolls back to the snapshot when the command fails.
   */
  const deleteRecordings = async (ids: readonly number[]) => {
    const targets = new Set(ids);
    const snapshot = entries;
    setEntries((prev) =>
      prev.map((e) => (targets.has(e.id) ? { ...e, file_name: "" } : e)),
    );

    const result = await commands
      .deleteHistoryAudio([...ids])
      .catch((error: unknown) => {
        setEntries(snapshot);
        throw error;
      });
    if (result.status !== "ok") {
      setEntries(snapshot);
      throw new Error(String(result.error));
    }
    return result.data;
  };

  const deleteEntryRecording = async (id: number) => {
    try {
      await deleteRecordings([id]);
    } catch (error) {
      console.error("Failed to delete recording:", error);
      toast.error(t("settings.history.deleteAudioError"));
    }
  };

  const confirmAudioDelete = async () => {
    if (!pendingAudioDelete || deleting) return;
    setDeleting(true);
    try {
      const count = await deleteRecordings(
        pendingAudioDelete.map((entry) => entry.id),
      );
      toast.success(t("settings.history.deletedAudioCount", { count }));
      setPendingAudioDelete(null);
    } catch (error) {
      console.error("Failed to delete recordings:", error);
      toast.error(t("settings.history.deleteAudioError"));
    } finally {
      setDeleting(false);
    }
  };

  const retryHistoryEntry = async (id: number) => {
    const result = await commands.retryHistoryEntryTranscription(id);
    if (result.status !== "ok") {
      throw new Error(String(result.error));
    }
  };

  const saveEntryText = useCallback(async (id: number, text: string) => {
    const result = await commands.updateHistoryEntryText(id, text);
    // EditableText reads a rejected promise as "keep the draft", so a failed
    // command has to throw rather than resolve quietly.
    if (result.status !== "ok") {
      throw new Error(String(result.error));
    }
    setEntries((prev) => prev.map((e) => (e.id === id ? result.data : e)));
  }, []);

  const openRecordingsFolder = async () => {
    try {
      const result = await commands.openRecordingsFolder();
      if (result.status !== "ok") {
        throw new Error(String(result.error));
      }
    } catch (error) {
      console.error("Failed to open recordings folder:", error);
    }
  };

  const toggleSelected = useCallback((id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const selectedEntries = useMemo(
    () => entries.filter((entry) => selectedIds.has(entry.id)),
    [entries, selectedIds],
  );

  const allLoadedSelected =
    entries.length > 0 && selectedEntries.length === entries.length;
  const someLoadedSelected = selectedEntries.length > 0 && !allLoadedSelected;

  const toggleSelectAll = () => {
    setSelectedIds(
      allLoadedSelected ? new Set() : new Set(entries.map((e) => e.id)),
    );
  };

  const openSelectionConfirm = () => {
    setIncludeSaved(false);
    setPendingDelete(selectedEntries);
  };

  /** Ids the confirmation is actually about, once starred entries are filtered. */
  const idsToDelete = useMemo(() => {
    if (!pendingDelete) return [];
    return pendingDelete
      .filter((entry) => includeSaved || !entry.saved)
      .map((entry) => entry.id);
  }, [pendingDelete, includeSaved]);

  const confirmDelete = async () => {
    if (!pendingDelete || deleting) return;
    setDeleting(true);

    try {
      if (idsToDelete.length === 0) return;
      const removed = new Set(idsToDelete);
      const snapshot = entries;

      // Optimistic, matching how single-entry deletes are handled: the
      // backend's "deleted" events are ignored by the listener above.
      setEntries((prev) => prev.filter((e) => !removed.has(e.id)));
      deselect(idsToDelete);

      const result = await commands.deleteHistoryEntries(idsToDelete);
      if (result.status !== "ok") {
        // The whole batch is one transaction, so nothing was removed. Put the
        // rows back exactly as they were.
        setEntries(snapshot);
        setSelectedIds(new Set(removed));
        throw new Error(String(result.error));
      }
      toast.success(t("settings.history.deletedCount", { count: result.data }));
      setPendingDelete(null);
    } catch (error) {
      console.error("Failed to delete entries:", error);
      toast.error(t("settings.history.deleteError"));
    } finally {
      setDeleting(false);
    }
  };

  let content: React.ReactNode;

  if (loading) {
    content = (
      <div className="px-4 py-8 text-center text-sm text-mid-gray">
        {t("settings.history.loading")}
      </div>
    );
  } else if (entries.length === 0) {
    content = (
      <div className="px-4 py-8 text-center text-sm text-mid-gray">
        {t("settings.history.empty")}
      </div>
    );
  } else {
    content = (
      <>
        <SelectionToolbar
          allSelected={allLoadedSelected}
          someSelected={someLoadedSelected}
          onToggleAll={toggleSelectAll}
          loadedCount={entries.length}
          hasMore={hasMore}
          selectedEntries={selectedEntries}
          onClearSelection={() => setSelectedIds(new Set())}
          onDeleteSelected={openSelectionConfirm}
          onDeleteSelectedAudio={() =>
            setPendingAudioDelete(selectedEntries.filter(hasAudio))
          }
        />
        <AudioPlayerGroup>
          <div className="divide-y divide-mid-gray/20">
            {entries.map((entry, index) => (
              <HistoryEntryComponent
                key={entry.id}
                entry={entry}
                // The newest transcription is the one the user came to copy,
                // so it opens with its text and actions already in reach.
                defaultExpanded={index === 0}
                selected={selectedIds.has(entry.id)}
                onToggleSelected={() => toggleSelected(entry.id)}
                onToggleSaved={() => toggleSaved(entry.id)}
                onCopyText={() => copyToClipboard(entry.transcription_text)}
                getAudioUrl={getAudioUrl}
                deleteAudio={deleteAudioEntry}
                deleteRecording={deleteEntryRecording}
                retryTranscription={retryHistoryEntry}
                saveText={saveEntryText}
              />
            ))}
          </div>
        </AudioPlayerGroup>
        {/* Sentinel for infinite scroll */}
        <div ref={sentinelRef} className="h-1" />
      </>
    );
  }

  const starredInSelection =
    pendingDelete?.filter((entry) => entry.saved).length ?? 0;

  const deleteCount = idsToDelete.length;

  return (
    <div className="max-w-3xl w-full mx-auto space-y-6">
      <div className="space-y-2">
        <div className="px-4 flex items-center justify-end gap-2">
          <OpenRecordingsButton
            onClick={openRecordingsFolder}
            label={t("settings.history.openFolder")}
          />
        </div>
        <div className="bg-surface border border-card-border shadow-card rounded-lg overflow-visible">
          {content}
        </div>
      </div>

      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setPendingDelete(null);
        }}
        title={t("settings.history.deleteSelectedTitle")}
        description={t("settings.history.deleteSelectedDescription", {
          count: deleteCount,
        })}
        closeLabel={t("settings.history.cancel")}
        footer={
          <>
            <Button
              variant="secondary"
              size="md"
              disabled={deleting}
              onClick={() => setPendingDelete(null)}
            >
              {t("settings.history.cancel")}
            </Button>
            <Button
              variant="danger"
              size="md"
              disabled={deleting || deleteCount === 0}
              onClick={() => void confirmDelete()}
            >
              {deleting
                ? t("settings.history.deleting")
                : t("settings.history.confirmDelete", { count: deleteCount })}
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm text-text/80">
          <p>{t("settings.history.deleteWarning")}</p>

          {starredInSelection > 0 && (
            <StarredNotice
              count={starredInSelection}
              includeSaved={includeSaved}
              onChange={setIncludeSaved}
              disabled={deleting}
            />
          )}

          {deleteCount === 0 && (
            <p className="text-mid-gray">
              {t("settings.history.onlyStarredSelected")}
            </p>
          )}
        </div>
      </Dialog>

      <Dialog
        open={pendingAudioDelete !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setPendingAudioDelete(null);
        }}
        title={t("settings.history.deleteAudioTitle")}
        description={t("settings.history.deleteAudioDescription", {
          count: pendingAudioDelete?.length ?? 0,
        })}
        closeLabel={t("settings.history.cancel")}
        footer={
          <>
            <Button
              variant="secondary"
              size="md"
              disabled={deleting}
              onClick={() => setPendingAudioDelete(null)}
            >
              {t("settings.history.cancel")}
            </Button>
            <Button
              variant="danger"
              size="md"
              disabled={deleting || (pendingAudioDelete?.length ?? 0) === 0}
              onClick={() => void confirmAudioDelete()}
            >
              {deleting
                ? t("settings.history.deleting")
                : t("settings.history.confirmDeleteAudio", {
                    count: pendingAudioDelete?.length ?? 0,
                  })}
            </Button>
          </>
        }
      >
        <p className="text-sm text-text/80">
          {t("settings.history.deleteWarning")}
        </p>
      </Dialog>
    </div>
  );
};

interface StarredNoticeProps {
  count: number;
  includeSaved: boolean;
  onChange: (value: boolean) => void;
  disabled: boolean;
}

/**
 * Warning shown when a bulk delete would touch starred entries.
 *
 * Starred entries are opted out by default — losing one is the mistake that is
 * hardest to undo, so including them takes a deliberate second click.
 */
const StarredNotice: React.FC<StarredNoticeProps> = ({
  count,
  includeSaved,
  onChange,
  disabled,
}) => {
  const { t } = useTranslation();

  return (
    <div className="rounded-md border border-warning/40 bg-warning/10 p-3 space-y-2">
      <p className="text-text/90">
        {t("settings.history.starredWarning", { count })}
      </p>
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={includeSaved}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
          className="accent-logo-primary"
        />
        <span className="text-text/90">
          {t("settings.history.includeStarred", { count })}
        </span>
      </label>
    </div>
  );
};

interface SelectionToolbarProps {
  allSelected: boolean;
  someSelected: boolean;
  onToggleAll: () => void;
  loadedCount: number;
  hasMore: boolean;
  selectedEntries: HistoryEntry[];
  onClearSelection: () => void;
  onDeleteSelected: () => void;
  onDeleteSelectedAudio: () => void;
}

/**
 * Header row above the list: the select-all box, the counter, and the actions
 * that apply to the current selection.
 *
 * "Select all" deliberately means "all rows loaded so far", not "all rows in
 * the database": the list pages in 30 at a time, and a checkbox that silently
 * covers thousands of unseen rows is a trap. The counter spells out the
 * distinction, and "Slett all historikk" under Advanced covers the
 * whole-table case.
 */
const SelectionToolbar: React.FC<SelectionToolbarProps> = ({
  allSelected,
  someSelected,
  onToggleAll,
  loadedCount,
  hasMore,
  selectedEntries,
  onClearSelection,
  onDeleteSelected,
  onDeleteSelectedAudio,
}) => {
  const { t, i18n } = useTranslation();
  const selectAllRef = useRef<HTMLInputElement>(null);

  // `indeterminate` is a DOM property with no HTML attribute, so React cannot
  // set it declaratively.
  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someSelected;
    }
  }, [someSelected]);

  const selectedCount = selectedEntries.length;
  const exportableEntries = selectedEntries.filter(
    (entry) => entry.transcription_text.trim().length > 0,
  );
  const withAudioCount = selectedEntries.filter(hasAudio).length;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-mid-gray/20 px-4 py-2">
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          ref={selectAllRef}
          type="checkbox"
          checked={allSelected}
          onChange={onToggleAll}
          className="accent-logo-primary"
        />
        <span className="text-xs font-medium text-text/70">
          {allSelected
            ? t("settings.history.selectNone")
            : t("settings.history.selectAllLoaded")}
        </span>
      </label>

      {selectedCount > 0 && (
        <span className="text-xs text-mid-gray">
          {hasMore
            ? t("settings.history.selectedOfLoadedPartial", {
                selected: selectedCount,
                loaded: loadedCount,
              })
            : t("settings.history.selectedOfLoaded", {
                selected: selectedCount,
                loaded: loadedCount,
              })}
        </span>
      )}

      {selectedCount > 0 && (
        <div className="ml-auto flex items-center gap-1">
          <ExportMenu
            disabled={exportableEntries.length === 0}
            buildDoc={() => ({
              title: t("settings.history.exportSelectionTitle", {
                count: exportableEntries.length,
              }),
              subtitle: formatDateTime(
                String(Math.floor(Date.now() / 1000)),
                i18n.language,
              ),
              // Entries are separated by a date line and a blank line so that
              // each becomes its own paragraph in the exported document.
              markdown: exportableEntries
                .map(
                  (entry) =>
                    `${formatDateTime(String(entry.timestamp), i18n.language)}\n\n${entry.transcription_text.trim()}`,
                )
                .join("\n\n"),
              bodyFormat: "text",
            })}
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={onClearSelection}
            className="text-xs text-mid-gray"
          >
            {t("settings.history.clearSelection")}
          </Button>
          <Button
            variant="danger-ghost"
            size="sm"
            onClick={onDeleteSelectedAudio}
            disabled={withAudioCount === 0}
            className="flex items-center gap-1.5"
          >
            <FileAudio className="w-3.5 h-3.5" />
            {t("settings.history.deleteSelectedAudio", {
              count: withAudioCount,
            })}
          </Button>
          <Button
            variant="danger-ghost"
            size="sm"
            onClick={onDeleteSelected}
            className="flex items-center gap-1.5"
          >
            <Trash2 className="w-3.5 h-3.5" />
            {t("settings.history.deleteSelected", { count: selectedCount })}
          </Button>
        </div>
      )}
    </div>
  );
};

interface HistoryEntryProps {
  entry: HistoryEntry;
  /** Start with the transcript open instead of the one-line preview. */
  defaultExpanded: boolean;
  selected: boolean;
  onToggleSelected: () => void;
  onToggleSaved: () => void;
  onCopyText: () => Promise<boolean>;
  getAudioUrl: (fileName: string) => Promise<string | null>;
  deleteAudio: (id: number) => Promise<void>;
  /** Delete only the recording and keep the transcript. */
  deleteRecording: (id: number) => Promise<void>;
  retryTranscription: (id: number) => Promise<void>;
  saveText: (id: number, text: string) => Promise<void>;
}

const HistoryEntryComponent: React.FC<HistoryEntryProps> = ({
  entry,
  defaultExpanded,
  selected,
  onToggleSelected,
  onToggleSaved,
  onCopyText,
  getAudioUrl,
  deleteAudio,
  deleteRecording,
  retryTranscription,
  saveText,
}) => {
  const { t, i18n } = useTranslation();
  const [showCopied, setShowCopied] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [expanded, setExpanded] = useState(defaultExpanded);
  const entryHasAudio = hasAudio(entry);
  const checkboxId = `history-select-${entry.id}`;

  const hasTranscription = entry.transcription_text.trim().length > 0;
  const collapsible = isCollapsible(entry.transcription_text);

  const handleLoadAudio = useCallback(
    () => getAudioUrl(entry.file_name),
    [getAudioUrl, entry.file_name],
  );

  const handleCopyText = async () => {
    if (!hasTranscription) {
      return;
    }

    const copied = await onCopyText();
    if (!copied) {
      toast.error(t("settings.history.copyError"));
      return;
    }

    setShowCopied(true);
    setTimeout(() => setShowCopied(false), 2000);
  };

  const handleDeleteEntry = async () => {
    try {
      await deleteAudio(entry.id);
    } catch (error) {
      console.error("Failed to delete entry:", error);
      toast.error(t("settings.history.deleteError"));
    }
  };

  const handleRetranscribe = async () => {
    try {
      setRetrying(true);
      await retryTranscription(entry.id);
    } catch (error) {
      console.error("Failed to re-transcribe:", error);
      toast.error(t("settings.history.retranscribeError"));
    } finally {
      setRetrying(false);
    }
  };

  const handleSaveText = useCallback(
    (text: string) => saveText(entry.id, text),
    [saveText, entry.id],
  );

  const formattedDate = formatDateTime(String(entry.timestamp), i18n.language);

  const editorProps = {
    value: entry.transcription_text,
    onSave: handleSaveText,
    // Transcripts are not markdown: a line starting with "- " is a dash, and
    // *asterisks* must survive the round trip.
    format: "text" as const,
    editLabel: t("settings.history.editTranscript"),
    emptyLabel: t("settings.history.transcriptionFailed"),
    disabled: retrying,
    rows: 8,
  };

  return (
    <div className="px-4 py-2 pb-5 flex flex-col gap-3">
      <div className="flex justify-between items-center gap-2">
        <div className="flex items-center gap-3 min-w-0">
          <input
            id={checkboxId}
            type="checkbox"
            checked={selected}
            onChange={onToggleSelected}
            className="accent-logo-primary shrink-0 cursor-pointer"
          />
          <label
            htmlFor={checkboxId}
            className="text-sm font-medium truncate cursor-pointer"
          >
            {formattedDate}
          </label>
          {entry.edited && (
            <span className="shrink-0 text-[11px] uppercase tracking-wider text-mid-gray">
              {t("settings.history.editedBadge")}
            </span>
          )}
        </div>
        <div className="flex items-center">
          <IconButton
            onClick={handleCopyText}
            disabled={!hasTranscription || retrying}
            label={t("settings.history.copyToClipboard")}
          >
            {showCopied ? (
              <Check width={16} height={16} />
            ) : (
              <Copy width={16} height={16} />
            )}
          </IconButton>
          <IconButton
            onClick={onToggleSaved}
            disabled={retrying}
            active={entry.saved}
            label={
              entry.saved
                ? t("settings.history.unsave")
                : t("settings.history.save")
            }
          >
            <Star
              width={16}
              height={16}
              fill={entry.saved ? "currentColor" : "none"}
            />
          </IconButton>
          <IconButton
            onClick={handleRetranscribe}
            disabled={retrying || !entryHasAudio}
            label={t("settings.history.retranscribe")}
          >
            <RotateCcw
              width={16}
              height={16}
              style={
                retrying
                  ? { animation: "spin 1s linear infinite reverse" }
                  : undefined
              }
            />
          </IconButton>
          {/* ExportMenu owns the save dialog, the write and both toasts. */}
          <ExportMenu
            compact
            disabled={!hasTranscription || retrying}
            buildDoc={() => ({
              title: t("settings.history.exportDocTitle"),
              subtitle: formattedDate,
              markdown: entry.transcription_text,
              bodyFormat: "text",
            })}
          />
          <IconButton
            onClick={handleDeleteEntry}
            disabled={retrying}
            label={t("settings.history.delete")}
          >
            <Trash2 width={16} height={16} />
          </IconButton>
        </div>
      </div>

      {retrying ? (
        <p
          className="italic text-sm pb-2"
          style={{ animation: "transcribe-pulse 3s ease-in-out infinite" }}
        >
          <style>{`
            @keyframes transcribe-pulse {
              0%, 100% { color: color-mix(in srgb, var(--color-text) 40%, transparent); }
              50% { color: color-mix(in srgb, var(--color-text) 90%, transparent); }
            }
          `}</style>
          {t("settings.history.transcribing")}
        </p>
      ) : collapsible ? (
        <div className="pb-2">
          <button
            type="button"
            onClick={() => setExpanded((open) => !open)}
            aria-expanded={expanded}
            className="flex items-center gap-1 rounded text-xs text-mid-gray hover:text-logo-primary transition-colors cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-logo-primary"
          >
            {expanded ? (
              <ChevronDown className="w-3.5 h-3.5" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5" />
            )}
            {t("settings.history.transcript")}
          </button>
          <div className={expanded ? "mt-2" : "mt-1"}>
            <CollapsibleText
              {...editorProps}
              expanded={expanded}
              onExpandedChange={setExpanded}
              expandLabel={t("settings.history.expandTranscript")}
            />
          </div>
        </div>
      ) : (
        <div className="pb-2">
          <EditableText {...editorProps} />
        </div>
      )}

      {entryHasAudio ? (
        <div className="flex items-center gap-2">
          <AudioPlayer onLoadRequest={handleLoadAudio} className="flex-1" />
          <IconButton
            onClick={() => void deleteRecording(entry.id)}
            disabled={retrying}
            label={t("settings.history.deleteAudio")}
          >
            <Trash2 width={16} height={16} />
          </IconButton>
        </div>
      ) : (
        <p className="text-xs text-mid-gray">
          {t("settings.history.audioDeleted")}
        </p>
      )}
    </div>
  );
};
