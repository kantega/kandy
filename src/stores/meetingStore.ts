import { create } from "zustand";
import { commands } from "@/bindings";

// Meeting recording state lives here (not in MeetingSettings) so the Sidebar
// can render a "recording in progress" dot even when the user is on another
// tab and the MeetingSettings component is unmounted. Backend truth is the
// `is_meeting_recording` command; this store mirrors it and is kept in sync by
// a lightweight poll from App.tsx plus explicit set calls when the user hits
// start/stop.

type RecordPhase = "idle" | "recording" | "transcribing";

interface MeetingStore {
  phase: RecordPhase;
  // Wall-clock start time of the current recording, so the elapsed timer keeps
  // counting accurately across tab changes (which unmount MeetingSettings and
  // therefore any local timer state).
  recordingStartedAt: number | null;
  setPhase: (phase: RecordPhase) => void;
  syncFromBackend: () => Promise<void>;
}

export const useMeetingStore = create<MeetingStore>((set, get) => ({
  phase: "idle",
  recordingStartedAt: null,
  setPhase: (phase) =>
    set((state) => ({
      phase,
      recordingStartedAt:
        phase === "recording"
          ? (state.recordingStartedAt ?? Date.now())
          : phase === "idle"
            ? null
            : state.recordingStartedAt,
    })),
  syncFromBackend: async () => {
    try {
      const recording = await commands.isMeetingRecording();
      // Preserve `transcribing` while the backend still says recording=false
      // between stop and the actual transcription finishing.
      const current = get().phase;
      if (recording) {
        set((state) => ({
          phase: "recording",
          recordingStartedAt: state.recordingStartedAt ?? Date.now(),
        }));
      } else if (current === "recording") {
        set({ phase: "idle", recordingStartedAt: null });
      }
    } catch (e) {
      console.warn("Failed to sync meeting recording state:", e);
    }
  },
}));
