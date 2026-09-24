import React, { useMemo, useState } from "react";
import { useSettings } from "@/hooks/useSettings";
import { useHasLlmKey } from "../LlmApiKeyField";
import { MeetingList } from "./MeetingList";
import { MeetingRecorder } from "./MeetingRecorder";
import {
  MeetingSearch,
  meetingMatches,
  parseSearchTerms,
} from "./MeetingSearch";
import { MeetingSummarySettings } from "./MeetingSummarySettings";
import { useMeetings, type MeetingActions } from "./useMeetings";

export const MeetingSettings: React.FC = () => {
  const { settings, updateSetting, isUpdating } = useSettings();
  const hasKey = useHasLlmKey();
  const model = settings?.llm_model ?? "";
  const defaultPrompt = settings?.meeting_summary_prompt ?? "";
  const autoSummarize = (settings?.meeting_auto_summarize ?? true) && hasKey;

  const {
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
  } = useMeetings(autoSummarize);
  const actions = useMemo<MeetingActions>(
    () => ({
      summarize,
      deleteMeeting,
      renameMeeting,
      saveSummary,
      saveTranscript,
      downloadAudio,
      getAudioUrl,
    }),
    [
      summarize,
      deleteMeeting,
      renameMeeting,
      saveSummary,
      saveTranscript,
      downloadAudio,
      getAudioUrl,
    ],
  );

  const [query, setQuery] = useState("");
  const terms = useMemo(() => parseSearchTerms(query), [query]);
  const visibleMeetings = useMemo(
    () => meetings.filter((m) => meetingMatches(m, terms)),
    [meetings, terms],
  );

  return (
    <div className="max-w-3xl w-full mx-auto space-y-6">
      <MeetingRecorder
        phase={phase}
        elapsed={elapsed}
        isDragging={isDragging}
        hasKey={hasKey}
        onStart={() => void startRecording()}
        onStop={() => void stopRecording()}
        onUpload={() => void uploadAudio()}
      />

      {meetings.length > 0 && (
        <MeetingSearch
          value={query}
          onChange={setQuery}
          shown={visibleMeetings.length}
          total={meetings.length}
        />
      )}

      <MeetingList
        meetings={visibleMeetings}
        total={meetings.length}
        query={query}
        terms={terms}
        model={model}
        hasKey={hasKey}
        summarizingId={summarizingId}
        defaultPrompt={defaultPrompt}
        actions={actions}
      />

      <MeetingSummarySettings
        prompt={defaultPrompt}
        autoSummarize={settings?.meeting_auto_summarize ?? true}
        autoSummarizeUpdating={isUpdating("meeting_auto_summarize")}
        autoTitle={settings?.meeting_auto_title ?? true}
        autoTitleUpdating={isUpdating("meeting_auto_title")}
        onToggleAutoSummarize={(v) =>
          updateSetting("meeting_auto_summarize", v)
        }
        onToggleAutoTitle={(v) => updateSetting("meeting_auto_title", v)}
        onSavePrompt={(p) => updateSetting("meeting_summary_prompt", p)}
      />
    </div>
  );
};
