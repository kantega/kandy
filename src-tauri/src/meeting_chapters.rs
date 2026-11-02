//! Automatic chapters and the improved, timestamped transcript for meetings.
//!
//! The transcript goes to the LLM in blocks of about half a minute, each
//! prefixed with its start time. For chapters the model names the block where
//! each chapter starts. For the improved transcript it returns corrected text
//! as paragraphs, each starting at one of the blocks. This module builds those
//! inputs and turns the JSON answers back into [`Chapter`]s and
//! [`TranscriptParagraph`]s with millisecond start times. No HTTP here; the
//! caller owns the requests through `kantega_llm`.

use serde::de::DeserializeOwned;
use serde::Deserialize;

use crate::managers::meeting::{Chapter, TranscriptParagraph};
use crate::managers::transcription::TimedSegment;

/// System prompt for chapter generation. Norwegian output, JSON only.
pub const CHAPTER_PROMPT: &str = "Du får transkripsjonen av et møte. Hver blokk \
starter med et tidsstempel i hakeparentes, [mm:ss] eller [t:mm:ss].

Del møtet inn i kapitler etter tema, i rekkefølge. Et kapittel dekker som regel \
flere minutter. Lag 3 til 12 kapitler, færre for korte møter.

Svar kun med en JSON-liste, uten annen tekst:
[{\"start\": \"00:00\", \"title\": \"...\", \"summary\": \"...\"}]

- start: tidsstempelet til blokken der kapittelet begynner, kopiert fra transkripsjonen.
- title: kort tittel på norsk, 2 til 6 ord.
- summary: to til tre setninger på norsk om hva som ble sagt og bestemt.";

/// System prompt for improving the transcript. Norwegian output, JSON only.
/// The user message carries the summary as reference and one excerpt.
pub const IMPROVE_PROMPT: &str = "Du får et utdrag av en møtetranskripsjon fra \
talegjenkjenning. Hver blokk starter med et tidsstempel i hakeparentes, [mm:ss] \
eller [t:mm:ss]. Når møtereferatet er med, bruker du det som fasit for navn og fagord.

Rett transkripsjonen:
- Rett feilstavede navn, begreper og åpenbare feilhøringer.
- Rett tegnsetting og store bokstaver.
- Fjern fyllord og gjentakelser som ikke bærer mening.
- Behold talerens ordlyd. Du skal verken legge til, oppsummere eller kutte innhold.

Slå sammen blokker til avsnitt der det passer. Alle blokker skal være med, i \
rekkefølge. Svar kun med en JSON-liste, uten annen tekst:
[{\"start\": \"00:00\", \"text\": \"...\"}]

- start: tidsstempelet til den første blokken i avsnittet, kopiert fra utdraget.
- text: den rettede teksten i avsnittet.";

/// Segments are merged into blocks at least this long, so a long meeting is
/// not sent as thousands of one-line stamps.
const BLOCK_MS: i64 = 30_000;

/// Blocks per request when improving the transcript, about five minutes of
/// speech. Keeps each answer well inside the response token limit.
const BLOCKS_PER_CHUNK: usize = 10;

/// An answer shorter than this share of the excerpt has dropped content, and
/// the excerpt keeps its original text instead.
const MIN_KEPT_SHARE: f64 = 0.5;

/// One block of the timed transcript.
struct Block {
    start_ms: i64,
    text: String,
}

/// `mm:ss`, or `h:mm:ss` from one hour.
pub fn format_timestamp(ms: i64) -> String {
    let total = ms.max(0) / 1000;
    let (hours, minutes, seconds) = (total / 3600, (total % 3600) / 60, total % 60);
    if hours > 0 {
        format!("{hours}:{minutes:02}:{seconds:02}")
    } else {
        format!("{minutes:02}:{seconds:02}")
    }
}

/// Inverse of [`format_timestamp`]. Tolerates surrounding brackets and
/// whitespace, since the model copies the stamp from the transcript.
fn parse_timestamp(stamp: &str) -> Option<i64> {
    let stamp = stamp.trim().trim_start_matches('[').trim_end_matches(']');
    let parts = stamp
        .split(':')
        .map(|part| part.trim().parse::<i64>().ok())
        .collect::<Option<Vec<_>>>()?;
    let seconds = match parts.as_slice() {
        [m, s] => m * 60 + s,
        [h, m, s] => h * 3600 + m * 60 + s,
        _ => return None,
    };
    Some(seconds * 1000)
}

/// Merge segments into blocks of at least [`BLOCK_MS`].
fn blocks(segments: &[TimedSegment]) -> Vec<Block> {
    let mut blocks: Vec<Block> = Vec::new();
    for segment in segments {
        match blocks.last_mut() {
            Some(block) if segment.start_ms - block.start_ms < BLOCK_MS => {
                block.text.push(' ');
                block.text.push_str(&segment.text);
            }
            _ => blocks.push(Block {
                start_ms: segment.start_ms,
                text: segment.text.clone(),
            }),
        }
    }
    blocks
}

fn format_blocks(blocks: &[Block]) -> String {
    blocks
        .iter()
        .map(|block| format!("[{}] {}", format_timestamp(block.start_ms), block.text))
        .collect::<Vec<_>>()
        .join("\n")
}

/// The transcript as `[mm:ss] text` lines, one per block of [`BLOCK_MS`].
pub fn timed_transcript(segments: &[TimedSegment]) -> String {
    format_blocks(&blocks(segments))
}

/// About five minutes of transcript, sent in one improvement request.
pub struct TranscriptChunk {
    /// The excerpt as `[mm:ss] text` lines.
    pub excerpt: String,
    /// The excerpt's own blocks as paragraphs, used when the answer is unusable.
    pub original: Vec<TranscriptParagraph>,
}

/// Split the transcript into the excerpts sent for improvement.
pub fn transcript_chunks(segments: &[TimedSegment]) -> Vec<TranscriptChunk> {
    blocks(segments)
        .chunks(BLOCKS_PER_CHUNK)
        .map(|chunk| TranscriptChunk {
            excerpt: format_blocks(chunk),
            original: chunk
                .iter()
                .map(|block| TranscriptParagraph {
                    start_ms: block.start_ms,
                    text: block.text.clone(),
                })
                .collect(),
        })
        .collect()
}

/// The user message for one improvement request.
pub fn improve_input(summary: Option<&str>, excerpt: &str) -> String {
    match summary.map(str::trim).filter(|s| !s.is_empty()) {
        Some(summary) => format!("Møtereferat:\n{summary}\n\nUtdrag:\n{excerpt}"),
        None => format!("Utdrag:\n{excerpt}"),
    }
}

/// The JSON list in a model answer, with or without a code fence around it.
fn json_list<T: DeserializeOwned>(answer: &str) -> Result<Vec<T>, String> {
    let start = answer.find('[');
    let end = answer.rfind(']');
    let json = match (start, end) {
        (Some(start), Some(end)) if start < end => &answer[start..=end],
        _ => return Err("The model did not answer with a JSON list".to_string()),
    };
    serde_json::from_str(json).map_err(|e| format!("Unreadable JSON list: {e}"))
}

#[derive(Deserialize)]
struct RawParagraph {
    start: String,
    text: String,
}

/// Turn the model's answer for one excerpt into paragraphs.
///
/// Paragraphs with an unreadable time or no text are dropped, and times are
/// kept inside the excerpt. The first paragraph starts where the excerpt
/// does. An answer that has lost much of the excerpt's text is rejected, so
/// the caller can fall back to the original.
pub fn parse_paragraphs(
    answer: &str,
    chunk: &TranscriptChunk,
) -> Result<Vec<TranscriptParagraph>, String> {
    let (Some(first), Some(last)) = (chunk.original.first(), chunk.original.last()) else {
        return Ok(Vec::new());
    };
    let raw: Vec<RawParagraph> = json_list(answer)?;

    let mut paragraphs: Vec<TranscriptParagraph> = raw
        .into_iter()
        .filter_map(|paragraph| {
            let text = paragraph.text.trim().to_string();
            if text.is_empty() {
                return None;
            }
            let start_ms = parse_timestamp(&paragraph.start)?.clamp(first.start_ms, last.start_ms);
            Some(TranscriptParagraph { start_ms, text })
        })
        .collect();
    paragraphs.sort_by_key(|paragraph| paragraph.start_ms);

    let kept: usize = paragraphs.iter().map(|p| p.text.chars().count()).sum();
    let original: usize = chunk.original.iter().map(|p| p.text.chars().count()).sum();
    if (kept as f64) < original as f64 * MIN_KEPT_SHARE {
        return Err(format!(
            "The improved excerpt kept {kept} of {original} characters"
        ));
    }

    match paragraphs.first_mut() {
        Some(paragraph) => paragraph.start_ms = first.start_ms,
        None => return Err("The model returned no usable paragraphs".to_string()),
    }
    Ok(paragraphs)
}

#[derive(Deserialize)]
struct RawChapter {
    start: String,
    title: String,
    #[serde(default)]
    summary: String,
}

/// Turn the model's answer into chapters.
///
/// Accepts the JSON list with or without a code fence around it. Chapters
/// with an unreadable time or an empty title are dropped, times are clamped
/// to the meeting, and the list is sorted with duplicates removed. The first
/// chapter is moved to 0:00 so the chapters cover the whole recording.
pub fn parse_chapters(answer: &str, duration_ms: i64) -> Result<Vec<Chapter>, String> {
    let raw: Vec<RawChapter> = json_list(answer)?;

    let mut chapters: Vec<Chapter> = raw
        .into_iter()
        .filter_map(|chapter| {
            let title = chapter.title.trim().to_string();
            if title.is_empty() {
                return None;
            }
            let start_ms = parse_timestamp(&chapter.start)?.clamp(0, duration_ms.max(0));
            Some(Chapter {
                start_ms,
                title,
                summary: chapter.summary.trim().to_string(),
            })
        })
        .collect();

    chapters.sort_by_key(|chapter| chapter.start_ms);
    chapters.dedup_by_key(|chapter| chapter.start_ms);

    match chapters.first_mut() {
        Some(first) => first.start_ms = 0,
        None => return Err("The model returned no usable chapters".to_string()),
    }
    Ok(chapters)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn segment(start_ms: i64, text: &str) -> TimedSegment {
        TimedSegment {
            start_ms,
            end_ms: start_ms + 5_000,
            text: text.to_string(),
        }
    }

    #[test]
    fn timestamps_round_trip() {
        assert_eq!(format_timestamp(0), "00:00");
        assert_eq!(format_timestamp(754_000), "12:34");
        assert_eq!(format_timestamp(3_723_000), "1:02:03");
        assert_eq!(parse_timestamp("12:34"), Some(754_000));
        assert_eq!(parse_timestamp(" [1:02:03] "), Some(3_723_000));
        assert_eq!(parse_timestamp("soon"), None);
    }

    #[test]
    fn segments_are_grouped_into_blocks() {
        let segments = [
            segment(0, "Hei."),
            segment(10_000, "Vi starter."),
            segment(31_000, "Neste sak."),
        ];

        assert_eq!(
            timed_transcript(&segments),
            "[00:00] Hei. Vi starter.\n[00:31] Neste sak."
        );
    }

    #[test]
    fn chapters_are_parsed_sorted_and_start_at_zero() {
        let answer = "```json\n[\
            {\"start\": \"04:12\", \"title\": \"Økonomi\", \"summary\": \"Tall for Q3.\"},\
            {\"start\": \"00:30\", \"title\": \"Innkalling\"},\
            {\"start\": \"99:00\", \"title\": \"Eventuelt\", \"summary\": \"\"}\
        ]\n```";

        let chapters = parse_chapters(answer, 600_000).expect("parses");

        let starts: Vec<i64> = chapters.iter().map(|c| c.start_ms).collect();
        assert_eq!(starts, vec![0, 252_000, 600_000]);
        assert_eq!(chapters[0].title, "Innkalling");
        assert_eq!(chapters[1].summary, "Tall for Q3.");
    }

    fn chunk_of(segments: &[TimedSegment]) -> TranscriptChunk {
        transcript_chunks(segments).remove(0)
    }

    #[test]
    fn long_transcripts_are_split_into_chunks() {
        let segments: Vec<TimedSegment> = (0..25).map(|i| segment(i * 30_000, "Tekst.")).collect();

        let chunks = transcript_chunks(&segments);

        assert_eq!(chunks.len(), 3);
        assert_eq!(chunks[1].original[0].start_ms, 300_000);
        assert!(chunks[2].excerpt.starts_with("[10:00] Tekst."));
    }

    #[test]
    fn improved_paragraphs_are_parsed_and_start_with_the_excerpt() {
        let chunk = chunk_of(&[
            segment(0, "hei alle"),
            segment(31_000, "neste sak er budsjett"),
        ]);
        let answer = r#"[{"start": "00:05", "text": "Hei, alle."},
                         {"start": "00:31", "text": "Neste sak er budsjettet."}]"#;

        let paragraphs = parse_paragraphs(answer, &chunk).expect("parses");

        assert_eq!(paragraphs.len(), 2);
        assert_eq!(paragraphs[0].start_ms, 0);
        assert_eq!(paragraphs[1].start_ms, 31_000);
        assert_eq!(paragraphs[1].text, "Neste sak er budsjettet.");
    }

    #[test]
    fn an_answer_that_drops_text_is_rejected() {
        let chunk = chunk_of(&[segment(
            0,
            "Her kommer en lang setning om budsjettet for neste år.",
        )]);

        assert!(parse_paragraphs(r#"[{"start": "00:00", "text": "Budsjett."}]"#, &chunk).is_err());
    }

    #[test]
    fn improve_input_includes_the_summary_when_there_is_one() {
        assert_eq!(improve_input(None, "[00:00] Hei."), "Utdrag:\n[00:00] Hei.");
        assert!(improve_input(Some("Referat"), "[00:00] Hei.").starts_with("Møtereferat:\nReferat"));
    }

    #[test]
    fn unusable_chapters_are_dropped() {
        let answer = r#"[{"start": "x", "title": "A"}, {"start": "01:00", "title": " "}]"#;

        assert!(parse_chapters(answer, 600_000).is_err());
        assert!(parse_chapters("Beklager, jeg kan ikke.", 600_000).is_err());
    }
}
