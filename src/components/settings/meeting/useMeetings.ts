import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { convertFileSrc } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import {
  open as openFileDialog,
  save as saveFileDialog,
} from "@tauri-apps/plugin-dialog";
import { readFile, writeFile } from "@tauri-apps/plugin-fs";
import {
  commands,
  events,
  type Meeting,
  type MeetingUpdatePayload,
} from "@/bindings";
import { sanitizeFilename } from "@/lib/export";
import { useMeetingStore } from "@/stores/meetingStore";

export type MeetingPhase = "idle" | "recording" | "transcribing";

/**
 * File extensions the backend can actually decode.
 *
 * Derived from the `symphonia` feature list in `src-tauri/Cargo.toml`. The
 * demuxers register these extensions and every one of them resolves to a codec
 * that is compiled in. Change one side and you must change the other.
 *
 * Deliberately absent: `.opus` and `.spx`, which the Ogg demuxer claims but no
 * compiled decoder can handle, and `.m4p`, which is DRM-wrapped.
 */
export const SUPPORTED_AUDIO_EXTENSIONS = [
  "aac",
  "aif",
  "aifc",
  "aiff",
  "caf",
  "flac",
  "m4a",
  "m4b",
  "m4r",
  "m4v",
  "mov",
  "mp3",
  "mp4",
  "oga",
  "ogg",
  "wav",
  "wave",
] as const;

/** Prefix `upload_meeting_audio` uses for "this file could not be read". */
const DECODE_ERROR_PREFIX = "Failed to decode audio:";

export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function fileExtension(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? "";
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

function isSupportedAudioFile(path: string): boolean {
  const ext = fileExtension(path);
  return (SUPPORTED_AUDIO_EXTENSIONS as readonly string[]).includes(ext);
}

export interface MeetingActions {
  summarize: (id: number, prompt?: string | null) => Promise<void>;
  deleteMeeting: (id: number) => Promise<void>;
  renameMeeting: (id: number, title: string) => Promise<void>;
  saveSummary: (id: number, summary: string) => Promise<void>;
  saveTranscript: (id: number, transcript: string) => Promise<void>;
  downloadAudio: (meeting: Meeting) => Promise<void>;
  getAudioUrl: (fileName: string) => Promise<string | null>;
}

export interface UseMeetingsResult extends MeetingActions {
  meetings: Meeting[];
  phase: MeetingPhase;
  elapsed: number;
  summarizingId: number | null;
  isDragging: boolean;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
  uploadAudio: () => Promise<void>;
}

/**
 * Meeting data and every backend interaction of the meeting pane: loading,
 * live update events, recording, file ingestion (dialog and drag-drop),
 * summarising and CRUD. Components below only render.
 */
export function useMeetings(autoSummarize: boolean): UseMeetingsResult {
  const { t } = useTranslation();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [summarizingId, setSummarizingId] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  // Phase lives in a zustand store so the sidebar can render a "recording"
  // badge even while this component is unmounted.
  const phase = useMeetingStore((s) => s.phase);
  const setPhase = useMeetingStore((s) => s.setPhase);
  const syncMeetingState = useMeetingStore((s) => s.syncFromBackend);
  const recordingStartedAt = useMeetingStore((s) => s.recordingStartedAt);

  // Load existing meetings + subscribe to live updates. The backend emits
  // "updated" for renames (including automatic titles), summaries and edits,
  // so the list is the single source of truth after the initial load.
  useEffect(() => {
    syncMeetingState();
    commands.getMeetings().then((r) => {
      if (r.status === "ok") setMeetings(r.data);
    });
    const unlisten = events.meetingUpdatePayload.listen((event) => {
      const p: MeetingUpdatePayload = event.payload;
      if (p.action === "added") {
        setMeetings((prev) => [p.meeting, ...prev]);
      } else if (p.action === "updated") {
        setMeetings((prev) =>
          prev.map((m) => (m.id === p.meeting.id ? p.meeting : m)),
        );
      } else if (p.action === "deleted") {
        setMeetings((prev) => prev.filter((m) => m.id !== p.id));
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Recording timer. Elapsed is derived from the store's start timestamp so
  // it survives tab changes (which unmount the pane).
  useEffect(() => {
    if (phase !== "recording" || recordingStartedAt === null) return;
    const tick = () =>
      setElapsed(Math.floor((Date.now() - recordingStartedAt) / 1000));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [phase, recordingStartedAt]);

  const summarize = useCallback(
    async (id: number, prompt: string | null = null) => {
      setSummarizingId(id);
      try {
        const r = await commands.summarizeMeeting(id, prompt);
        if (r.status !== "ok") {
          toast.error(t("meeting.errors.summaryFailed"), {
            description: String(r.error),
          });
        }
      } finally {
        setSummarizingId(null);
      }
    },
    [t],
  );

  const startRecording = useCallback(async () => {
    const r = await commands.startMeetingRecording();
    if (r.status !== "ok") {
      toast.error(t("meeting.errors.startFailed"), {
        description: String(r.error),
      });
      return;
    }
    setPhase("recording");
    setElapsed(0);
  }, [setPhase, t]);

  const stopRecording = useCallback(async () => {
    setPhase("transcribing");
    try {
      const r = await commands.stopMeetingRecording();
      if (r.status !== "ok") {
        toast.error(t("meeting.errors.transcribeFailed"), {
          description: String(r.error),
        });
        return;
      }
      // The meeting itself arrives via the event listener.
      if (autoSummarize) {
        void summarize(r.data.id);
      }
    } finally {
      setPhase("idle");
    }
  }, [autoSummarize, setPhase, summarize, t]);

  /**
   * Transcribe dropped/picked files one after another. Sequential on purpose:
   * the transcription model is a single shared resource, and a queue gives the
   * user one honest "transcribing" state instead of several fighting over it.
   */
  const ingestFiles = useCallback(
    async (paths: string[]) => {
      const supported = paths.filter(isSupportedAudioFile);
      const rejected = paths.length - supported.length;

      if (rejected > 0) {
        toast.error(t("meeting.errors.unsupportedFile", { count: rejected }), {
          description: t("meeting.errors.unsupportedFileHint", {
            formats: SUPPORTED_AUDIO_EXTENSIONS.join(", "),
          }),
        });
      }
      if (supported.length === 0) return;

      if (supported.length > 1) {
        toast.info(t("meeting.queued", { count: supported.length }));
      }

      setPhase("transcribing");
      try {
        for (const path of supported) {
          const r = await commands.uploadMeetingAudio(path);
          if (r.status !== "ok") {
            const message = String(r.error);
            const undecodable = message.startsWith(DECODE_ERROR_PREFIX);
            console.error("Meeting audio import failed:", message);
            toast.error(
              undecodable
                ? t("meeting.errors.decodeFailed")
                : t("meeting.errors.transcribeFailed"),
              {
                description: undecodable
                  ? t("meeting.errors.decodeFailedHint", {
                      file: path.split(/[\\/]/).pop() ?? path,
                    })
                  : message,
              },
            );
            continue;
          }
          if (autoSummarize) {
            await summarize(r.data.id);
          }
        }
      } finally {
        setPhase("idle");
      }
    },
    [autoSummarize, setPhase, summarize, t],
  );

  const uploadAudio = useCallback(async () => {
    const selected = await openFileDialog({
      multiple: true,
      filters: [
        {
          name: t("meeting.audioFiles"),
          extensions: [...SUPPORTED_AUDIO_EXTENSIONS],
        },
      ],
    });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    if (paths.length === 0) return;
    await ingestFiles(paths);
  }, [ingestFiles, t]);

  const isBusy = phase !== "idle";
  // Read inside the drag handler without making the listener depend on it.
  // Re-subscribing mid-drag would drop the in-flight `leave`/`drop`.
  const isBusyRef = useRef(isBusy);
  useEffect(() => {
    isBusyRef.current = isBusy;
  }, [isBusy]);

  // Tauri file drops. The browser's own drag events never carry a usable path
  // inside a webview, so the native webview event is the only workable source.
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    getCurrentWebview()
      .onDragDropEvent((event) => {
        const payload = event.payload;
        if (payload.type === "enter" || payload.type === "over") {
          if (!isBusyRef.current) setIsDragging(true);
          return;
        }
        setIsDragging(false);
        if (payload.type === "drop" && !isBusyRef.current) {
          void ingestFiles(payload.paths);
        }
      })
      .then((fn) => {
        if (disposed) {
          fn();
          return;
        }
        unlisten = fn;
      })
      .catch((error) => {
        console.error("Failed to subscribe to file drops:", error);
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [ingestFiles]);

  const deleteMeeting = useCallback(
    async (id: number) => {
      setMeetings((prev) => prev.filter((m) => m.id !== id));
      const r = await commands.deleteMeeting(id);
      if (r.status !== "ok") {
        toast.error(t("meeting.errors.deleteFailed"));
        commands.getMeetings().then((res) => {
          if (res.status === "ok") setMeetings(res.data);
        });
      }
    },
    [t],
  );

  /** Resolve a meeting recording to something an `<audio>` element accepts. */
  const getAudioUrl = useCallback(
    async (fileName: string): Promise<string | null> => {
      try {
        const result = await commands.getMeetingAudioPath(fileName);
        if (result.status !== "ok") return null;
        return convertFileSrc(result.data, "asset");
      } catch (error) {
        console.error("Failed to get meeting audio path:", error);
        return null;
      }
    },
    [],
  );

  const downloadAudio = useCallback(
    async (meeting: Meeting) => {
      const extension = fileExtension(meeting.audio_file) || "wav";
      try {
        const source = await commands.getMeetingAudioPath(meeting.audio_file);
        if (source.status !== "ok") throw new Error(String(source.error));

        const target = await saveFileDialog({
          defaultPath: `${sanitizeFilename(meeting.title, "møteopptak")}.${extension}`,
          filters: [{ name: t("meeting.audioFiles"), extensions: [extension] }],
        });
        // A dismissed dialog is not a failure.
        if (target === null) return;

        await writeFile(target, await readFile(source.data));
        toast.success(t("meeting.audioSaved"), { description: target });
      } catch (error) {
        console.error("Failed to save meeting audio:", error);
        toast.error(t("meeting.errors.audioSaveFailed"), {
          description: String(error),
        });
      }
    },
    [t],
  );

  // Rename/save do not touch local state: the backend emits an "updated"
  // MeetingUpdatePayload which the listener applies.
  const renameMeeting = useCallback(async (id: number, title: string) => {
    const r = await commands.renameMeeting(id, title);
    if (r.status !== "ok") throw new Error(String(r.error));
  }, []);

  const saveSummary = useCallback(async (id: number, summary: string) => {
    const r = await commands.updateMeetingSummary(id, summary);
    if (r.status !== "ok") throw new Error(String(r.error));
  }, []);

  const saveTranscript = useCallback(async (id: number, transcript: string) => {
    const r = await commands.updateMeetingTranscript(id, transcript);
    if (r.status !== "ok") throw new Error(String(r.error));
  }, []);

  return {
    meetings,
    phase,
    elapsed,
    summarizingId,
    isDragging,
    startRecording,
    stopRecording,
    uploadAudio,
    summarize,
    deleteMeeting,
    renameMeeting,
    saveSummary,
    saveTranscript,
    downloadAudio,
    getAudioUrl,
  };
}
