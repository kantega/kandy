//! Meeting store.
//!
//! Persists recorded meetings — transcript, summary, and metadata — in a
//! dedicated SQLite table, kept separate from `HistoryManager` so meetings are
//! long-lived and never pruned by the dictation-history retention limits.
//! Modeled on `history.rs`.

use anyhow::{anyhow, Result};
use chrono::{DateTime, Local, Utc};
use log::{debug, error, info, warn};
use rusqlite::{params, Connection, OptionalExtension};
use rusqlite_migration::{Migrations, M};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::fs;
use std::path::PathBuf;
use tauri::AppHandle;
use tauri_specta::Event;

use crate::managers::transcription::TimedSegment;

static MIGRATIONS: &[M] = &[
    M::up(
        "CREATE TABLE IF NOT EXISTS meetings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        audio_file TEXT NOT NULL DEFAULT '',
        transcript TEXT NOT NULL DEFAULT '',
        summary TEXT,
        summary_prompt TEXT,
        model TEXT,
        duration_secs INTEGER NOT NULL DEFAULT 0
    );",
    ),
    // Segment timings from the speech model (JSON array of `TimedSegment`) and
    // the chapters made from them (JSON array of `Chapter`). NULL segments
    // means the timings were never stored, so chapters need a new transcription.
    M::up(
        "ALTER TABLE meetings ADD COLUMN segments TEXT;
         ALTER TABLE meetings ADD COLUMN chapters TEXT;",
    ),
    // The improved transcript as timestamped paragraphs (JSON array of
    // `TranscriptParagraph`). While set, `transcript` holds the same text
    // joined, so search, copy and export keep working on plain text.
    M::up("ALTER TABLE meetings ADD COLUMN paragraphs TEXT;"),
];

/// Every column `map_row` reads, in one place for the SELECTs below.
const MEETING_COLUMNS: &str = "id, title, timestamp, audio_file, transcript, summary, \
     summary_prompt, model, duration_secs, chapters, paragraphs";

/// One topic section of a meeting: where it starts in the recording, a short
/// title and a few sentences on what was said. It runs until the next
/// chapter starts, or to the end of the meeting.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type)]
pub struct Chapter {
    pub start_ms: i64,
    pub title: String,
    pub summary: String,
}

/// One paragraph of the improved transcript and where it starts in the
/// recording.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type)]
pub struct TranscriptParagraph {
    pub start_ms: i64,
    pub text: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct Meeting {
    pub id: i64,
    pub title: String,
    pub timestamp: i64,
    pub audio_file: String,
    pub transcript: String,
    pub summary: Option<String>,
    pub summary_prompt: Option<String>,
    pub model: Option<String>,
    pub duration_secs: i64,
    /// Empty until chapters have been generated.
    pub chapters: Vec<Chapter>,
    /// The improved transcript. Empty until it has been generated; the plain
    /// `transcript` is then all there is.
    pub paragraphs: Vec<TranscriptParagraph>,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type, tauri_specta::Event)]
#[serde(tag = "action")]
pub enum MeetingUpdatePayload {
    #[serde(rename = "added")]
    Added { meeting: Meeting },
    #[serde(rename = "updated")]
    Updated { meeting: Meeting },
    #[serde(rename = "deleted")]
    Deleted { id: i64 },
}

pub struct MeetingManager {
    app_handle: AppHandle,
    recordings_dir: PathBuf,
    db_path: PathBuf,
}

impl MeetingManager {
    pub fn new(app_handle: &AppHandle) -> Result<Self> {
        let app_data_dir = crate::portable::app_data_dir(app_handle)?;
        let recordings_dir = app_data_dir.join("meetings");
        let db_path = app_data_dir.join("meetings.db");

        if !recordings_dir.exists() {
            fs::create_dir_all(&recordings_dir)?;
            debug!("Created meetings directory: {:?}", recordings_dir);
        }

        let manager = Self {
            app_handle: app_handle.clone(),
            recordings_dir,
            db_path,
        };
        manager.init_database()?;
        Ok(manager)
    }

    fn init_database(&self) -> Result<()> {
        info!("Initializing meetings database at {:?}", self.db_path);
        let mut conn = Connection::open(&self.db_path)?;
        let migrations = Migrations::new(MIGRATIONS.to_vec());
        #[cfg(debug_assertions)]
        migrations.validate().expect("Invalid meeting migrations");
        migrations
            .to_latest(&mut conn)
            .map_err(|e| anyhow!("Meeting DB migration failed: {}", e))?;
        Ok(())
    }

    fn get_connection(&self) -> Result<Connection> {
        Ok(Connection::open(&self.db_path)?)
    }

    /// Absolute path for a meeting WAV file name inside the meetings directory.
    pub fn audio_file_path(&self, file_name: &str) -> PathBuf {
        self.recordings_dir.join(file_name)
    }

    /// True when `title` is still the automatic timestamp from `format_title`
    /// (or the fallback), i.e. the user has not named the meeting.
    pub fn is_automatic_title(title: &str, timestamp: i64) -> bool {
        title.trim() == Self::format_title(timestamp) || title.trim().starts_with("Meeting ")
    }

    fn format_title(timestamp: i64) -> String {
        if let Some(utc) = DateTime::from_timestamp(timestamp, 0) {
            utc.with_timezone(&Local)
                .format("%d.%m.%Y %H:%M")
                .to_string()
        } else {
            format!("Meeting {}", timestamp)
        }
    }

    fn map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Meeting> {
        Ok(Meeting {
            id: row.get("id")?,
            title: row.get("title")?,
            timestamp: row.get("timestamp")?,
            audio_file: row.get("audio_file")?,
            transcript: row.get("transcript")?,
            summary: row.get("summary")?,
            summary_prompt: row.get("summary_prompt")?,
            model: row.get("model")?,
            duration_secs: row.get("duration_secs")?,
            chapters: Self::parse_list(row.get("chapters")?, "chapters"),
            paragraphs: Self::parse_list(row.get("paragraphs")?, "paragraphs"),
        })
    }

    /// A JSON list column. A value that no longer parses is logged and read as
    /// empty, so one bad row cannot hide the meeting.
    fn parse_list<T: DeserializeOwned>(raw: Option<String>, what: &str) -> Vec<T> {
        let Some(raw) = raw else {
            return Vec::new();
        };
        serde_json::from_str(&raw).unwrap_or_else(|e| {
            warn!("Ignoring unreadable meeting {}: {}", what, e);
            Vec::new()
        })
    }

    /// Persist a freshly recorded + transcribed meeting (no summary yet).
    pub fn save_meeting(
        &self,
        audio_file: String,
        transcript: String,
        segments: &[TimedSegment],
        duration_secs: i64,
    ) -> Result<Meeting> {
        let timestamp = Utc::now().timestamp();
        let title = Self::format_title(timestamp);
        let segments_json = serde_json::to_string(segments)?;

        let conn = self.get_connection()?;
        conn.execute(
            "INSERT INTO meetings (title, timestamp, audio_file, transcript, duration_secs, segments)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                &title,
                timestamp,
                &audio_file,
                &transcript,
                duration_secs,
                segments_json
            ],
        )?;

        let meeting = Meeting {
            id: conn.last_insert_rowid(),
            title,
            timestamp,
            audio_file,
            transcript,
            summary: None,
            summary_prompt: None,
            model: None,
            duration_secs,
            chapters: Vec::new(),
            paragraphs: Vec::new(),
        };

        self.emit(MeetingUpdatePayload::Added {
            meeting: meeting.clone(),
        });
        Ok(meeting)
    }

    /// Store (or replace) a generated summary and the prompt/model used.
    pub fn update_summary(
        &self,
        id: i64,
        summary: String,
        summary_prompt: String,
        model: String,
    ) -> Result<Meeting> {
        let conn = self.get_connection()?;
        let updated = conn.execute(
            "UPDATE meetings SET summary = ?1, summary_prompt = ?2, model = ?3 WHERE id = ?4",
            params![summary, summary_prompt, model, id],
        )?;
        if updated == 0 {
            return Err(anyhow!("Meeting {} not found", id));
        }
        let meeting = self.require(id)?;
        self.emit(MeetingUpdatePayload::Updated {
            meeting: meeting.clone(),
        });
        Ok(meeting)
    }

    /// Replace the summary text alone, leaving `summary_prompt` and `model`
    /// untouched — a hand-edited summary is still the output of that prompt and
    /// model, so the provenance shown in the AI badge stays true.
    pub fn set_summary(&self, id: i64, summary: String) -> Result<Meeting> {
        let conn = self.get_connection()?;
        let updated = conn.execute(
            "UPDATE meetings SET summary = ?1 WHERE id = ?2",
            params![summary, id],
        )?;
        if updated == 0 {
            return Err(anyhow!("Meeting {} not found", id));
        }
        let meeting = self.require(id)?;
        self.emit(MeetingUpdatePayload::Updated {
            meeting: meeting.clone(),
        });
        Ok(meeting)
    }

    /// Replace the transcript text, e.g. after the user has corrected names the
    /// speech model got wrong before regenerating the summary.
    pub fn set_transcript(&self, id: i64, transcript: String) -> Result<Meeting> {
        let conn = self.get_connection()?;
        let updated = conn.execute(
            "UPDATE meetings SET transcript = ?1 WHERE id = ?2",
            params![transcript, id],
        )?;
        if updated == 0 {
            return Err(anyhow!("Meeting {} not found", id));
        }
        let meeting = self.require(id)?;
        self.emit(MeetingUpdatePayload::Updated {
            meeting: meeting.clone(),
        });
        Ok(meeting)
    }

    /// The stored segment timings, or `None` when none were stored.
    pub fn get_segments(&self, id: i64) -> Result<Option<Vec<TimedSegment>>> {
        let conn = self.get_connection()?;
        let raw: Option<String> = conn
            .query_row(
                "SELECT segments FROM meetings WHERE id = ?1",
                params![id],
                |row| row.get(0),
            )
            .optional()?
            .ok_or_else(|| anyhow!("Meeting {} not found", id))?;
        raw.map(|json| serde_json::from_str(&json).map_err(anyhow::Error::from))
            .transpose()
    }

    /// Store segment timings recovered by transcribing an older meeting again.
    /// The transcript is left alone, since the user may have corrected it.
    pub fn set_segments(&self, id: i64, segments: &[TimedSegment]) -> Result<()> {
        let conn = self.get_connection()?;
        let updated = conn.execute(
            "UPDATE meetings SET segments = ?1 WHERE id = ?2",
            params![serde_json::to_string(segments)?, id],
        )?;
        if updated == 0 {
            return Err(anyhow!("Meeting {} not found", id));
        }
        Ok(())
    }

    /// Store (or replace) a meeting's chapters.
    pub fn set_chapters(&self, id: i64, chapters: &[Chapter]) -> Result<Meeting> {
        let conn = self.get_connection()?;
        let updated = conn.execute(
            "UPDATE meetings SET chapters = ?1 WHERE id = ?2",
            params![serde_json::to_string(chapters)?, id],
        )?;
        if updated == 0 {
            return Err(anyhow!("Meeting {} not found", id));
        }
        let meeting = self.require(id)?;
        self.emit(MeetingUpdatePayload::Updated {
            meeting: meeting.clone(),
        });
        Ok(meeting)
    }

    /// Delete the recording and keep the transcript, summary and chapters. The
    /// row is cleared before the file goes, so it never points at a missing
    /// file. A meeting without a recording is returned unchanged.
    pub fn delete_audio(&self, id: i64) -> Result<Meeting> {
        let meeting = self.require(id)?;
        if meeting.audio_file.is_empty() {
            return Ok(meeting);
        }

        let conn = self.get_connection()?;
        conn.execute(
            "UPDATE meetings SET audio_file = '' WHERE id = ?1",
            params![id],
        )?;

        let path = self.audio_file_path(&meeting.audio_file);
        if path.exists() {
            if let Err(e) = fs::remove_file(&path) {
                error!(
                    "Failed to delete meeting audio {}: {}",
                    meeting.audio_file, e
                );
            }
        }

        let meeting = self.require(id)?;
        self.emit(MeetingUpdatePayload::Updated {
            meeting: meeting.clone(),
        });
        Ok(meeting)
    }

    /// Store the improved transcript, and its joined text as `transcript`.
    pub fn set_paragraphs(&self, id: i64, paragraphs: &[TranscriptParagraph]) -> Result<Meeting> {
        let conn = self.get_connection()?;
        let updated = conn.execute(
            "UPDATE meetings SET paragraphs = ?1, transcript = ?2 WHERE id = ?3",
            params![
                serde_json::to_string(paragraphs)?,
                Self::join_paragraphs(paragraphs),
                id
            ],
        )?;
        if updated == 0 {
            return Err(anyhow!("Meeting {} not found", id));
        }
        let meeting = self.require(id)?;
        self.emit(MeetingUpdatePayload::Updated {
            meeting: meeting.clone(),
        });
        Ok(meeting)
    }

    /// Replace the text of one paragraph of the improved transcript.
    pub fn set_paragraph_text(&self, id: i64, index: usize, text: String) -> Result<Meeting> {
        let mut paragraphs = self.require(id)?.paragraphs;
        let paragraph = paragraphs
            .get_mut(index)
            .ok_or_else(|| anyhow!("Meeting {} has no paragraph {}", id, index))?;
        paragraph.text = text;
        self.set_paragraphs(id, &paragraphs)
    }

    fn join_paragraphs(paragraphs: &[TranscriptParagraph]) -> String {
        paragraphs
            .iter()
            .map(|paragraph| paragraph.text.trim())
            .collect::<Vec<_>>()
            .join("\n\n")
    }

    /// Rename a meeting.
    pub fn rename(&self, id: i64, title: String) -> Result<Meeting> {
        let conn = self.get_connection()?;
        let updated = conn.execute(
            "UPDATE meetings SET title = ?1 WHERE id = ?2",
            params![title, id],
        )?;
        if updated == 0 {
            return Err(anyhow!("Meeting {} not found", id));
        }
        let meeting = self.require(id)?;
        self.emit(MeetingUpdatePayload::Updated {
            meeting: meeting.clone(),
        });
        Ok(meeting)
    }

    pub fn get_meetings(&self) -> Result<Vec<Meeting>> {
        let conn = self.get_connection()?;
        let sql = format!("SELECT {MEETING_COLUMNS} FROM meetings ORDER BY timestamp DESC");
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map([], Self::map_row)?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }

    pub fn get_by_id(&self, id: i64) -> Result<Option<Meeting>> {
        let conn = self.get_connection()?;
        let sql = format!("SELECT {MEETING_COLUMNS} FROM meetings WHERE id = ?1");
        let meeting = conn
            .query_row(&sql, params![id], Self::map_row)
            .optional()?;
        Ok(meeting)
    }

    fn require(&self, id: i64) -> Result<Meeting> {
        self.get_by_id(id)?
            .ok_or_else(|| anyhow!("Meeting {} not found", id))
    }

    pub fn delete(&self, id: i64) -> Result<()> {
        // Remove the audio file too, if present.
        if let Ok(Some(meeting)) = self.get_by_id(id) {
            if !meeting.audio_file.is_empty() {
                let path = self.audio_file_path(&meeting.audio_file);
                if path.exists() {
                    let _ = fs::remove_file(&path);
                }
            }
        }
        let conn = self.get_connection()?;
        let deleted = conn.execute("DELETE FROM meetings WHERE id = ?1", params![id])?;
        if deleted == 0 {
            return Err(anyhow!("Meeting {} not found", id));
        }
        self.emit(MeetingUpdatePayload::Deleted { id });
        Ok(())
    }

    fn emit(&self, payload: MeetingUpdatePayload) {
        if let Err(e) = payload.emit(&self.app_handle) {
            error!("Failed to emit meeting-updated event: {}", e);
        }
    }
}
