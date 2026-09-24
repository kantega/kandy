use anyhow::{anyhow, Result};
use chrono::{DateTime, Local, Utc};
use log::{debug, error, info};
use rusqlite::{params, params_from_iter, Connection, OptionalExtension};
use rusqlite_migration::{Migrations, M};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::fs;
use std::path::PathBuf;
use std::time::Duration;
use tauri::AppHandle;
use tauri_specta::Event;

/// Database migrations for transcription history.
/// Each migration is applied in order. The library tracks which migrations
/// have been applied using SQLite's user_version pragma.
static MIGRATIONS: &[M] = &[
    M::up(
        "CREATE TABLE IF NOT EXISTS transcription_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            file_name TEXT NOT NULL,
            timestamp INTEGER NOT NULL,
            saved BOOLEAN NOT NULL DEFAULT 0,
            title TEXT NOT NULL,
            transcription_text TEXT NOT NULL
        );",
    ),
    M::up("ALTER TABLE transcription_history ADD COLUMN post_processed_text TEXT;"),
    M::up("ALTER TABLE transcription_history ADD COLUMN post_process_prompt TEXT;"),
    M::up("ALTER TABLE transcription_history ADD COLUMN post_process_requested BOOLEAN NOT NULL DEFAULT 0;"),
    // Marks entries whose transcript the user has corrected by hand, so the UI
    // can show that the text no longer matches what the model produced.
    M::up("ALTER TABLE transcription_history ADD COLUMN edited BOOLEAN NOT NULL DEFAULT 0;"),
];

/// Every column of `transcription_history`, in the order [`HistoryManager::map_history_entry`]
/// expects. Kept in one place so adding a column does not mean editing seven
/// hand-written SELECT lists.
const ENTRY_COLUMNS: &str = "id, file_name, timestamp, saved, title, transcription_text, \
     post_processed_text, post_process_prompt, post_process_requested, edited";

/// SQLite's default limit on host parameters in a single statement is 999.
/// Bulk deletes are chunked below that; the chunks still run inside one
/// transaction, so the operation stays all-or-nothing.
const MAX_DELETE_CHUNK: usize = 500;

/// Unsaved recordings older than this are pruned after every save.
const RECORDING_RETENTION: Duration = Duration::from_secs(14 * 24 * 60 * 60);

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct PaginatedHistory {
    pub entries: Vec<HistoryEntry>,
    pub has_more: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type, tauri_specta::Event)]
#[serde(tag = "action")]
pub enum HistoryUpdatePayload {
    #[serde(rename = "added")]
    Added { entry: HistoryEntry },
    #[serde(rename = "updated")]
    Updated { entry: HistoryEntry },
    #[serde(rename = "deleted")]
    Deleted { id: i64 },
    #[serde(rename = "toggled")]
    Toggled { id: i64 },
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct HistoryEntry {
    pub id: i64,
    pub file_name: String,
    pub timestamp: i64,
    pub saved: bool,
    pub title: String,
    pub transcription_text: String,
    pub post_processed_text: Option<String>,
    pub post_process_prompt: Option<String>,
    pub post_process_requested: bool,
    /// True once the transcript has been corrected by hand. Reset when the
    /// entry is re-transcribed, since that replaces the manual text.
    pub edited: bool,
}

/// Totals for the whole history table, used by the "delete all" confirmation
/// so it can state exactly how much is about to disappear.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct HistoryStats {
    pub total: i64,
    pub saved: i64,
}

pub struct HistoryManager {
    app_handle: AppHandle,
    recordings_dir: PathBuf,
    db_path: PathBuf,
}

impl HistoryManager {
    pub fn new(app_handle: &AppHandle) -> Result<Self> {
        // Create recordings directory in app data dir
        let app_data_dir = crate::portable::app_data_dir(app_handle)?;
        let recordings_dir = app_data_dir.join("recordings");
        let db_path = app_data_dir.join("history.db");

        // Ensure recordings directory exists
        if !recordings_dir.exists() {
            fs::create_dir_all(&recordings_dir)?;
            debug!("Created recordings directory: {:?}", recordings_dir);
        }

        let manager = Self {
            app_handle: app_handle.clone(),
            recordings_dir,
            db_path,
        };

        // Initialize database and run migrations synchronously
        manager.init_database()?;

        Ok(manager)
    }

    fn init_database(&self) -> Result<()> {
        info!("Initializing database at {:?}", self.db_path);

        let mut conn = Connection::open(&self.db_path)?;

        // Create migrations object and run to latest version
        let migrations = Migrations::new(MIGRATIONS.to_vec());

        // Validate migrations in debug builds
        #[cfg(debug_assertions)]
        migrations.validate().expect("Invalid migrations");

        // Get current version before migration
        let version_before: i32 =
            conn.pragma_query_value(None, "user_version", |row| row.get(0))?;
        debug!("Database version before migration: {}", version_before);

        // Apply any pending migrations
        migrations.to_latest(&mut conn)?;

        // Get version after migration
        let version_after: i32 = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;

        if version_after > version_before {
            info!(
                "Database migrated from version {} to {}",
                version_before, version_after
            );
        } else {
            debug!("Database already at latest version {}", version_after);
        }

        Ok(())
    }

    fn get_connection(&self) -> Result<Connection> {
        Ok(Connection::open(&self.db_path)?)
    }

    fn map_history_entry(row: &rusqlite::Row<'_>) -> rusqlite::Result<HistoryEntry> {
        Ok(HistoryEntry {
            id: row.get("id")?,
            file_name: row.get("file_name")?,
            timestamp: row.get("timestamp")?,
            saved: row.get("saved")?,
            title: row.get("title")?,
            transcription_text: row.get("transcription_text")?,
            post_processed_text: row.get("post_processed_text")?,
            post_process_prompt: row.get("post_process_prompt")?,
            post_process_requested: row.get("post_process_requested")?,
            edited: row.get("edited")?,
        })
    }

    /// Save a new history entry to the database.
    /// The WAV file should already have been written to the recordings directory.
    pub fn save_entry(
        &self,
        file_name: String,
        transcription_text: String,
        post_process_requested: bool,
        post_processed_text: Option<String>,
        post_process_prompt: Option<String>,
    ) -> Result<HistoryEntry> {
        let timestamp = Utc::now().timestamp();
        let title = self.format_timestamp_title(timestamp);

        let conn = self.get_connection()?;
        conn.execute(
            "INSERT INTO transcription_history (
                file_name,
                timestamp,
                saved,
                title,
                transcription_text,
                post_processed_text,
                post_process_prompt,
                post_process_requested
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                &file_name,
                timestamp,
                false,
                &title,
                &transcription_text,
                &post_processed_text,
                &post_process_prompt,
                post_process_requested,
            ],
        )?;

        let entry = HistoryEntry {
            id: conn.last_insert_rowid(),
            file_name,
            timestamp,
            saved: false,
            title,
            transcription_text,
            post_processed_text,
            post_process_prompt,
            post_process_requested,
            edited: false,
        };

        debug!("Saved history entry with id {}", entry.id);

        // The row is already committed; a retention failure must not turn the
        // save into an error or skip the Added event.
        if let Err(e) = self.cleanup_old_entries() {
            error!("Retention cleanup after save failed: {}", e);
        }

        // Emit typed event for real-time frontend updates
        if let Err(e) = (HistoryUpdatePayload::Added {
            entry: entry.clone(),
        })
        .emit(&self.app_handle)
        {
            error!("Failed to emit history-updated event: {}", e);
        }

        Ok(entry)
    }

    /// Update an existing history entry with new transcription results (used by retry).
    pub fn update_transcription(
        &self,
        id: i64,
        transcription_text: String,
        post_processed_text: Option<String>,
        post_process_prompt: Option<String>,
    ) -> Result<HistoryEntry> {
        let conn = self.get_connection()?;
        // A fresh machine transcription replaces whatever the user typed, so the
        // manual-edit marker no longer applies.
        let updated = conn.execute(
            "UPDATE transcription_history
             SET transcription_text = ?1,
                 post_processed_text = ?2,
                 post_process_prompt = ?3,
                 edited = 0
             WHERE id = ?4",
            params![
                transcription_text,
                post_processed_text,
                post_process_prompt,
                id
            ],
        )?;

        if updated == 0 {
            return Err(anyhow!("History entry {} not found", id));
        }

        let entry = Self::fetch_entry(&conn, id)?
            .ok_or_else(|| anyhow!("History entry {} not found", id))?;

        debug!("Updated transcription for history entry {}", id);

        if let Err(e) = (HistoryUpdatePayload::Updated {
            entry: entry.clone(),
        })
        .emit(&self.app_handle)
        {
            error!("Failed to emit history-updated event: {}", e);
        }

        Ok(entry)
    }

    /// Replace the transcript of an entry with text the user typed, and mark it
    /// as hand-edited.
    pub fn update_transcription_text(
        &self,
        id: i64,
        transcription_text: String,
    ) -> Result<HistoryEntry> {
        let conn = self.get_connection()?;
        let updated = conn.execute(
            "UPDATE transcription_history
             SET transcription_text = ?1,
                 edited = 1
             WHERE id = ?2",
            params![transcription_text, id],
        )?;

        if updated == 0 {
            return Err(anyhow!("History entry {} not found", id));
        }

        let entry = Self::fetch_entry(&conn, id)?
            .ok_or_else(|| anyhow!("History entry {} not found", id))?;

        debug!("Manually edited transcript for history entry {}", id);

        if let Err(e) = (HistoryUpdatePayload::Updated {
            entry: entry.clone(),
        })
        .emit(&self.app_handle)
        {
            error!("Failed to emit history-updated event: {}", e);
        }

        Ok(entry)
    }

    fn fetch_entry(conn: &Connection, id: i64) -> Result<Option<HistoryEntry>> {
        let sql = format!("SELECT {ENTRY_COLUMNS} FROM transcription_history WHERE id = ?1");
        let entry = conn
            .query_row(&sql, params![id], Self::map_history_entry)
            .optional()?;
        Ok(entry)
    }

    /// Row counts for the whole table, for the "delete all history" confirmation.
    pub fn get_stats(&self) -> Result<HistoryStats> {
        let conn = self.get_connection()?;
        let (total, saved) = conn.query_row(
            "SELECT COUNT(*), COALESCE(SUM(saved), 0) FROM transcription_history",
            [],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
        )?;
        Ok(HistoryStats { total, saved })
    }

    /// Delete unsaved entries older than [`RECORDING_RETENTION`] in one
    /// transaction, then remove their WAV files and announce each removal.
    pub fn cleanup_old_entries(&self) -> Result<()> {
        let cutoff = Utc::now().timestamp() - RECORDING_RETENTION.as_secs() as i64;
        let mut conn = self.get_connection()?;
        let removed = Self::delete_expired_with_conn(&mut conn, cutoff)?;

        if !removed.is_empty() {
            debug!(
                "Cleaned up {} old history entries based on retention period",
                removed.len()
            );
        }
        self.discard_recordings(&removed);
        Ok(())
    }

    /// The database half of [`Self::cleanup_old_entries`].
    fn delete_expired_with_conn(conn: &mut Connection, cutoff: i64) -> Result<Vec<(i64, String)>> {
        let tx = conn.transaction()?;

        let removed: Vec<(i64, String)> = {
            let mut stmt = tx.prepare(
                "SELECT id, file_name FROM transcription_history WHERE saved = 0 AND timestamp < ?1",
            )?;
            let rows = stmt
                .query_map(params![cutoff], |row| {
                    Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
                })?
                .collect::<std::result::Result<Vec<_>, _>>()?;
            rows
        };

        tx.execute(
            "DELETE FROM transcription_history WHERE saved = 0 AND timestamp < ?1",
            params![cutoff],
        )?;
        tx.commit()?;

        Ok(removed)
    }

    pub async fn get_history_entries(
        &self,
        cursor: Option<i64>,
        limit: Option<usize>,
    ) -> Result<PaginatedHistory> {
        let conn = self.get_connection()?;
        let limit = limit.map(|l| l.min(100));

        let mut entries: Vec<HistoryEntry> = match (cursor, limit) {
            (Some(cursor_id), Some(lim)) => {
                let fetch_count = (lim + 1) as i64;
                let sql = format!(
                    "SELECT {ENTRY_COLUMNS}
                     FROM transcription_history
                     WHERE id < ?1
                     ORDER BY id DESC
                     LIMIT ?2"
                );
                let mut stmt = conn.prepare(&sql)?;
                let result = stmt
                    .query_map(params![cursor_id, fetch_count], Self::map_history_entry)?
                    .collect::<std::result::Result<Vec<_>, _>>()?;
                result
            }
            (None, Some(lim)) => {
                let fetch_count = (lim + 1) as i64;
                let sql = format!(
                    "SELECT {ENTRY_COLUMNS}
                     FROM transcription_history
                     ORDER BY id DESC
                     LIMIT ?1"
                );
                let mut stmt = conn.prepare(&sql)?;
                let result = stmt
                    .query_map(params![fetch_count], Self::map_history_entry)?
                    .collect::<std::result::Result<Vec<_>, _>>()?;
                result
            }
            (_, None) => {
                let sql = format!(
                    "SELECT {ENTRY_COLUMNS}
                     FROM transcription_history
                     ORDER BY id DESC"
                );
                let mut stmt = conn.prepare(&sql)?;
                let result = stmt
                    .query_map([], Self::map_history_entry)?
                    .collect::<std::result::Result<Vec<_>, _>>()?;
                result
            }
        };

        let has_more = limit.is_some_and(|lim| entries.len() > lim);
        if has_more {
            entries.pop();
        }

        Ok(PaginatedHistory { entries, has_more })
    }

    /// Get the latest entry with non-empty transcription text.
    pub fn get_latest_completed_entry(&self) -> Result<Option<HistoryEntry>> {
        let conn = self.get_connection()?;
        Self::get_latest_completed_entry_with_conn(&conn)
    }

    fn get_latest_completed_entry_with_conn(conn: &Connection) -> Result<Option<HistoryEntry>> {
        let sql = format!(
            "SELECT {ENTRY_COLUMNS}
             FROM transcription_history
             WHERE transcription_text != ''
             ORDER BY timestamp DESC
             LIMIT 1"
        );
        let mut stmt = conn.prepare(&sql)?;

        let entry = stmt.query_row([], Self::map_history_entry).optional()?;
        Ok(entry)
    }

    pub async fn toggle_saved_status(&self, id: i64) -> Result<()> {
        let conn = self.get_connection()?;

        let changed = conn.execute(
            "UPDATE transcription_history SET saved = NOT saved WHERE id = ?1",
            params![id],
        )?;
        if changed == 0 {
            return Err(anyhow::anyhow!("History entry {} not found", id));
        }

        debug!("Toggled saved status for entry {}", id);

        // Emit history updated event
        if let Err(e) = (HistoryUpdatePayload::Toggled { id }).emit(&self.app_handle) {
            error!("Failed to emit history-updated event: {}", e);
        }

        Ok(())
    }

    pub fn get_audio_file_path(&self, file_name: &str) -> PathBuf {
        self.recordings_dir.join(file_name)
    }

    pub async fn get_entry_by_id(&self, id: i64) -> Result<Option<HistoryEntry>> {
        let conn = self.get_connection()?;
        Self::fetch_entry(&conn, id)
    }

    pub async fn delete_entry(&self, id: i64) -> Result<()> {
        let conn = self.get_connection()?;

        // Get the entry to find the file name
        if let Some(entry) = self.get_entry_by_id(id).await? {
            // Delete the audio file first
            let file_path = self.get_audio_file_path(&entry.file_name);
            if file_path.exists() {
                if let Err(e) = fs::remove_file(&file_path) {
                    error!("Failed to delete audio file {}: {}", entry.file_name, e);
                    // Continue with database deletion even if file deletion fails
                }
            }
        }

        // Delete from database
        conn.execute(
            "DELETE FROM transcription_history WHERE id = ?1",
            params![id],
        )?;

        debug!("Deleted history entry with id: {}", id);

        // Emit history updated event
        if let Err(e) = (HistoryUpdatePayload::Deleted { id }).emit(&self.app_handle) {
            error!("Failed to emit history-updated event: {}", e);
        }

        Ok(())
    }

    /// Remove the WAV files belonging to rows that have already been deleted,
    /// and announce each removal.
    ///
    /// Only ever called after the deleting transaction has committed, so a
    /// rollback can never leave the database pointing at files that are gone.
    /// A file that refuses to be removed is logged and skipped: the row is
    /// already deleted, and aborting here would only make the state murkier.
    fn discard_recordings(&self, removed: &[(i64, String)]) {
        for (id, file_name) in removed {
            let file_path = self.recordings_dir.join(file_name);
            if file_path.exists() {
                if let Err(e) = fs::remove_file(&file_path) {
                    error!("Failed to delete audio file {}: {}", file_name, e);
                }
            }

            if let Err(e) = (HistoryUpdatePayload::Deleted { id: *id }).emit(&self.app_handle) {
                error!("Failed to emit history-updated event: {}", e);
            }
        }
    }

    /// Delete several entries in one transaction, then remove their WAV files.
    ///
    /// Either every requested row goes or none does, so a failure halfway
    /// through cannot leave the user with a partly-deleted selection. Ids that
    /// no longer exist are skipped. Returns how many rows were removed.
    pub async fn delete_entries(&self, ids: &[i64]) -> Result<usize> {
        let mut conn = self.get_connection()?;
        let removed = Self::delete_ids_with_conn(&mut conn, ids)?;

        debug!("Deleted {} history entries", removed.len());
        self.discard_recordings(&removed);

        Ok(removed.len())
    }

    /// Delete the whole history. Starred entries survive unless `include_saved`
    /// is set. Returns how many rows were removed.
    pub async fn delete_all_entries(&self, include_saved: bool) -> Result<usize> {
        let mut conn = self.get_connection()?;
        let removed = Self::delete_all_with_conn(&mut conn, include_saved)?;

        info!(
            "Cleared history: {} entries removed (starred included: {})",
            removed.len(),
            include_saved
        );
        self.discard_recordings(&removed);

        Ok(removed.len())
    }

    /// The database half of [`Self::delete_entries`]: one transaction covering
    /// every chunk, returning the `(id, file_name)` pairs that were removed.
    fn delete_ids_with_conn(conn: &mut Connection, ids: &[i64]) -> Result<Vec<(i64, String)>> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }

        let tx = conn.transaction()?;
        let mut removed: Vec<(i64, String)> = Vec::new();

        for chunk in ids.chunks(MAX_DELETE_CHUNK) {
            let placeholders = vec!["?"; chunk.len()].join(",");

            {
                let sql = format!(
                    "SELECT id, file_name FROM transcription_history WHERE id IN ({placeholders})"
                );
                let mut stmt = tx.prepare(&sql)?;
                let rows = stmt.query_map(params_from_iter(chunk.iter()), |row| {
                    Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
                })?;
                for row in rows {
                    removed.push(row?);
                }
            }

            let sql = format!("DELETE FROM transcription_history WHERE id IN ({placeholders})");
            tx.execute(&sql, params_from_iter(chunk.iter()))?;
        }

        tx.commit()?;

        Ok(removed)
    }

    /// The database half of [`Self::delete_all_entries`].
    fn delete_all_with_conn(
        conn: &mut Connection,
        include_saved: bool,
    ) -> Result<Vec<(i64, String)>> {
        let (select_sql, delete_sql) = if include_saved {
            (
                "SELECT id, file_name FROM transcription_history",
                "DELETE FROM transcription_history",
            )
        } else {
            (
                "SELECT id, file_name FROM transcription_history WHERE saved = 0",
                "DELETE FROM transcription_history WHERE saved = 0",
            )
        };

        let tx = conn.transaction()?;

        let removed: Vec<(i64, String)> = {
            let mut stmt = tx.prepare(select_sql)?;
            let rows = stmt
                .query_map([], |row| {
                    Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
                })?
                .collect::<std::result::Result<Vec<_>, _>>()?;
            rows
        };

        tx.execute(delete_sql, [])?;
        tx.commit()?;

        Ok(removed)
    }

    fn format_timestamp_title(&self, timestamp: i64) -> String {
        if let Some(utc_datetime) = DateTime::from_timestamp(timestamp, 0) {
            // Convert UTC to local timezone
            let local_datetime = utc_datetime.with_timezone(&Local);
            local_datetime.format("%d.%m.%Y %H:%M").to_string()
        } else {
            format!("Recording {}", timestamp)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::{params, Connection};

    fn setup_conn() -> Connection {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        conn.execute_batch(
            "CREATE TABLE transcription_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                file_name TEXT NOT NULL,
                timestamp INTEGER NOT NULL,
                saved BOOLEAN NOT NULL DEFAULT 0,
                title TEXT NOT NULL,
                transcription_text TEXT NOT NULL,
                post_processed_text TEXT,
                post_process_prompt TEXT,
                post_process_requested BOOLEAN NOT NULL DEFAULT 0,
                edited BOOLEAN NOT NULL DEFAULT 0
            );",
        )
        .expect("create transcription_history table");
        conn
    }

    fn insert_saved_entry(conn: &Connection, timestamp: i64, text: &str, saved: bool) -> i64 {
        conn.execute(
            "INSERT INTO transcription_history (
                file_name,
                timestamp,
                saved,
                title,
                transcription_text,
                post_processed_text,
                post_process_prompt,
                post_process_requested
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                format!("kandy-{}.wav", timestamp),
                timestamp,
                saved,
                format!("Recording {}", timestamp),
                text,
                Option::<String>::None,
                Option::<String>::None,
                false,
            ],
        )
        .expect("insert history entry");
        conn.last_insert_rowid()
    }

    fn remaining_ids(conn: &Connection) -> Vec<i64> {
        let mut stmt = conn
            .prepare("SELECT id FROM transcription_history ORDER BY id")
            .expect("prepare select");
        stmt.query_map([], |row| row.get::<_, i64>(0))
            .expect("query ids")
            .collect::<std::result::Result<Vec<_>, _>>()
            .expect("collect ids")
    }

    fn insert_entry(conn: &Connection, timestamp: i64, text: &str, post_processed: Option<&str>) {
        conn.execute(
            "INSERT INTO transcription_history (
                file_name,
                timestamp,
                saved,
                title,
                transcription_text,
                post_processed_text,
                post_process_prompt,
                post_process_requested
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                format!("kandy-{}.wav", timestamp),
                timestamp,
                false,
                format!("Recording {}", timestamp),
                text,
                post_processed,
                Option::<String>::None,
                false,
            ],
        )
        .expect("insert history entry");
    }

    #[test]
    fn expired_unsaved_entries_are_pruned_and_reported() {
        let mut conn = setup_conn();
        let old = insert_saved_entry(&conn, 100, "old", false);
        let starred = insert_saved_entry(&conn, 100, "starred", true);
        let fresh = insert_saved_entry(&conn, 1_000, "fresh", false);

        let removed = HistoryManager::delete_expired_with_conn(&mut conn, 500).expect("prune");

        assert_eq!(removed, vec![(old, "kandy-100.wav".to_string())]);
        assert_eq!(remaining_ids(&conn), vec![starred, fresh]);
    }

    #[test]
    fn get_latest_completed_entry_skips_empty_entries() {
        let conn = setup_conn();
        insert_entry(&conn, 100, "completed", None);
        insert_entry(&conn, 200, "", None);

        let entry = HistoryManager::get_latest_completed_entry_with_conn(&conn)
            .expect("fetch latest completed entry")
            .expect("completed entry exists");

        assert_eq!(entry.timestamp, 100);
        assert_eq!(entry.transcription_text, "completed");
    }

    #[test]
    fn migrations_produce_every_column_entry_columns_names() {
        let mut conn = Connection::open_in_memory().expect("open in-memory db");
        Migrations::new(MIGRATIONS.to_vec())
            .to_latest(&mut conn)
            .expect("apply migrations");

        // Fails to prepare if the const drifts from the migrated schema.
        let sql = format!("SELECT {ENTRY_COLUMNS} FROM transcription_history");
        conn.prepare(&sql).expect("ENTRY_COLUMNS match the schema");
    }

    #[test]
    fn delete_ids_removes_only_the_requested_entries() {
        let mut conn = setup_conn();
        let first = insert_saved_entry(&conn, 100, "one", false);
        let second = insert_saved_entry(&conn, 200, "two", false);
        let third = insert_saved_entry(&conn, 300, "three", false);

        let removed = HistoryManager::delete_ids_with_conn(&mut conn, &[first, third])
            .expect("bulk delete succeeds");

        assert_eq!(removed.len(), 2);
        assert_eq!(remaining_ids(&conn), vec![second]);
    }

    #[test]
    fn delete_ids_reports_the_file_names_to_clean_up() {
        let mut conn = setup_conn();
        let id = insert_saved_entry(&conn, 100, "one", false);

        // Unknown ids are skipped rather than failing the whole operation.
        let removed = HistoryManager::delete_ids_with_conn(&mut conn, &[id, 9999])
            .expect("bulk delete succeeds");

        assert_eq!(removed, vec![(id, "kandy-100.wav".to_string())]);
    }

    #[test]
    fn delete_ids_on_empty_selection_is_a_no_op() {
        let mut conn = setup_conn();
        let id = insert_saved_entry(&conn, 100, "one", false);

        let removed =
            HistoryManager::delete_ids_with_conn(&mut conn, &[]).expect("empty delete succeeds");

        assert!(removed.is_empty());
        assert_eq!(remaining_ids(&conn), vec![id]);
    }

    #[test]
    fn delete_all_keeps_starred_entries_by_default() {
        let mut conn = setup_conn();
        insert_saved_entry(&conn, 100, "throwaway", false);
        let starred = insert_saved_entry(&conn, 200, "keep me", true);

        let removed =
            HistoryManager::delete_all_with_conn(&mut conn, false).expect("delete all succeeds");

        assert_eq!(removed.len(), 1);
        assert_eq!(remaining_ids(&conn), vec![starred]);
    }

    #[test]
    fn delete_all_including_starred_empties_the_table() {
        let mut conn = setup_conn();
        insert_saved_entry(&conn, 100, "throwaway", false);
        insert_saved_entry(&conn, 200, "keep me", true);

        let removed =
            HistoryManager::delete_all_with_conn(&mut conn, true).expect("delete all succeeds");

        assert_eq!(removed.len(), 2);
        assert!(remaining_ids(&conn).is_empty());
    }
}
