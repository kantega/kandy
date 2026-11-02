import React from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { Chapter, TranscriptParagraph } from "@/bindings";
import { EditableText } from "../../ui/EditableText";

/** `mm:ss`, or `h:mm:ss` from one hour. Matches the backend's stamps. */
const formatTime = (ms: number): string => {
  const total = Math.max(0, Math.floor(ms / 1000));
  const pad = (n: number) => n.toString().padStart(2, "0");
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${pad(minutes)}:${pad(seconds)}`;
};

/** Width of the time margin plus the gap after it, for indenting under it. */
const UNDER_MARGIN = "pl-[4.25rem]";

interface TimeButtonProps {
  ms: number;
  onSeek: (ms: number) => void;
}

/** A time in the left margin. Clicking it plays the recording from there. */
const TimeButton: React.FC<TimeButtonProps> = ({ ms, onSeek }) => {
  const { t } = useTranslation();
  const time = formatTime(ms);
  return (
    <button
      type="button"
      onClick={() => onSeek(ms)}
      title={t("meeting.playFrom", { time })}
      aria-label={t("meeting.playFrom", { time })}
      className="w-14 shrink-0 rounded pt-0.5 text-start font-mono text-xs text-mid-gray cursor-pointer transition-colors hover:text-logo-primary focus:outline-none focus-visible:ring-1 focus-visible:ring-logo-primary"
    >
      {time}
    </button>
  );
};

interface ParagraphRowProps {
  paragraph: TranscriptParagraph;
  onSeek: (ms: number) => void;
  onSave: (text: string) => Promise<void>;
  onTextClick?: () => void;
}

const ParagraphRow: React.FC<ParagraphRowProps> = ({
  paragraph,
  onSeek,
  onSave,
  onTextClick,
}) => {
  const { t } = useTranslation();
  return (
    <div className="flex items-start gap-3">
      <TimeButton ms={paragraph.start_ms} onSeek={onSeek} />
      <EditableText
        className="min-w-0 max-w-[70ch] flex-1"
        value={paragraph.text}
        format="text"
        rows={4}
        editLabel={t("meeting.editParagraph")}
        onSave={onSave}
        onTextClick={onTextClick}
      />
    </div>
  );
};

interface MeetingTranscriptProps {
  paragraphs: TranscriptParagraph[];
  chapters: Chapter[];
  /** Indexes of the chapters shown open. */
  openChapters: ReadonlySet<number>;
  /** The chapter the recording is playing in, or null. */
  activeChapter: number | null;
  onToggleChapter: (index: number) => void;
  /** Play the recording from a time, in milliseconds. */
  onSeek: (ms: number) => void;
  onSaveParagraph: (index: number, text: string) => Promise<void>;
}

/**
 * The transcript as chapters. Folded, the chapters read as a table of
 * contents: time and title. Open, a chapter shows its summary and its
 * paragraphs, each with its start time in the left margin. Clicking a time
 * plays from there, a single click on the text folds the chapter again, and a
 * double click edits that paragraph.
 *
 * A bar on the left runs the length of each chapter, like a timeline, and
 * turns pink for the chapter the recording is playing in.
 *
 * Without chapters the paragraphs are listed on their own. Without
 * paragraphs an open chapter shows only its summary.
 */
export const MeetingTranscript: React.FC<MeetingTranscriptProps> = ({
  paragraphs,
  chapters,
  openChapters,
  activeChapter,
  onToggleChapter,
  onSeek,
  onSaveParagraph,
}) => {
  const { t } = useTranslation();
  const indexed = paragraphs.map((paragraph, index) => ({ paragraph, index }));

  if (chapters.length === 0) {
    return (
      <div className="space-y-2">
        {indexed.map(({ paragraph, index }) => (
          <ParagraphRow
            key={`${paragraph.start_ms}-${index}`}
            paragraph={paragraph}
            onSeek={onSeek}
            onSave={(text) => onSaveParagraph(index, text)}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {chapters.map((chapter, chapterIndex) => {
        const end = chapters[chapterIndex + 1]?.start_ms ?? Infinity;
        const inChapter = indexed.filter(
          ({ paragraph }) =>
            paragraph.start_ms >= chapter.start_ms && paragraph.start_ms < end,
        );
        const open = openChapters.has(chapterIndex);
        const active = activeChapter === chapterIndex;

        return (
          <div
            key={`${chapter.start_ms}-${chapterIndex}`}
            className={`border-l-2 py-1 pl-3 transition-colors ${
              active ? "border-logo-primary" : "border-mid-gray/25"
            }`}
          >
            <div className="flex items-start gap-3">
              <TimeButton ms={chapter.start_ms} onSeek={onSeek} />
              <button
                type="button"
                onClick={() => onToggleChapter(chapterIndex)}
                aria-expanded={open}
                className={`flex min-w-0 flex-1 items-start gap-1 rounded text-start text-sm font-semibold cursor-pointer transition-colors hover:text-logo-primary ${
                  active ? "text-logo-primary" : "text-text"
                } focus:outline-none focus-visible:ring-1 focus-visible:ring-logo-primary`}
              >
                {open ? (
                  <ChevronDown className="mt-0.5 w-3.5 h-3.5 shrink-0" />
                ) : (
                  <ChevronRight className="mt-0.5 w-3.5 h-3.5 shrink-0" />
                )}
                {chapter.title}
              </button>
            </div>

            {open && (
              <div className="space-y-2 pt-1 pb-3">
                {chapter.summary && (
                  <p
                    className={`${UNDER_MARGIN} max-w-[calc(70ch+4.25rem)] text-sm italic leading-relaxed text-text/70`}
                  >
                    {chapter.summary}
                  </p>
                )}
                {inChapter.map(({ paragraph, index }) => (
                  <ParagraphRow
                    key={`${paragraph.start_ms}-${index}`}
                    paragraph={paragraph}
                    onSeek={onSeek}
                    onSave={(text) => onSaveParagraph(index, text)}
                    onTextClick={() => onToggleChapter(chapterIndex)}
                  />
                ))}
                {inChapter.length === 0 && !chapter.summary && (
                  <p className={`${UNDER_MARGIN} text-sm text-mid-gray`}>
                    {t("meeting.chapters.empty")}
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
