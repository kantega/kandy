//! Kantega LLM proxy client.
//!
//! All LLM traffic from Kandy goes through the Kantega LLM proxy, never
//! `api.anthropic.com` directly. The wire format is the standard Anthropic
//! Messages API; only the host and the `x-api-key` auth header differ.
//!
//! Used for dictation post-processing and meeting summaries. Callers own the
//! no-key fallback: without a key the raw transcript is the deliverable and
//! this client is not called.

use log::{error, info, warn};
use serde::Deserialize;
use serde_json::json;

/// `SecretMap` key under which the LLM proxy API key is stored.
pub const LLM_KEY_ID: &str = "kantega_llmproxy";

/// Kantega LLM proxy Messages endpoint.
const KANTEGA_LLMPROXY_URL: &str = "https://llmproxy.kantega.no/v1/messages";

/// Anthropic Messages API version pin required by the proxy.
const ANTHROPIC_VERSION: &str = "2023-06-01";

/// Upper bound on response length. Meeting summaries are the longest output
/// and a structured recap fits comfortably.
const MAX_TOKENS: u32 = 4000;

#[derive(Deserialize)]
struct MessagesResponse {
    content: Vec<ContentBlock>,
}

#[derive(Deserialize)]
struct ContentBlock {
    #[serde(default)]
    text: String,
    #[serde(rename = "type", default)]
    block_type: String,
}

/// One plain-text completion: `system_prompt` as the system message,
/// `user_content` as the single user message. Returns the assistant's text or
/// an error string suitable for the UI. Never logs the key or the content.
/// System prompt for the automatic meeting title. Norwegian output, 3 to 10
/// words, no quotes or trailing punctuation.
pub const TITLE_PROMPT: &str =
    "Du får et møtereferat. Svar kun med en kort, beskrivende tittel på \
møtet på norsk, 3 til 10 ord. Ingen anførselstegn, ingen punktum, ingen forklaring.";

/// Ask the proxy for a short meeting title based on `summary`. Returns a
/// cleaned single line, or `None` if the model produced nothing usable.
pub async fn suggest_title(api_key: &str, model: &str, summary: &str) -> Option<String> {
    let raw = match complete(api_key, model, TITLE_PROMPT, summary).await {
        Ok(text) => text,
        Err(e) => {
            warn!("Automatic meeting title failed: {}", e);
            return None;
        }
    };
    let title = raw
        .lines()
        .map(str::trim)
        .find(|l| !l.is_empty())?
        .trim_matches(|c: char| {
            c == '"' || c == '«' || c == '»' || c == '\'' || c == '.' || c == '#'
        })
        .trim()
        .to_string();
    let words = title.split_whitespace().count();
    if title.is_empty() || words > 14 || title.chars().count() > 120 {
        warn!("Automatic meeting title rejected ({} words)", words);
        return None;
    }
    Some(title)
}

pub async fn complete(
    api_key: &str,
    model: &str,
    system_prompt: &str,
    user_content: &str,
) -> Result<String, String> {
    if api_key.trim().is_empty() {
        return Err("No Kantega LLM proxy API key configured".to_string());
    }
    if user_content.trim().is_empty() {
        return Err("Nothing to send to the LLM".to_string());
    }

    let body = json!({
        "model": model,
        "max_tokens": MAX_TOKENS,
        "system": system_prompt,
        "messages": [{ "role": "user", "content": user_content }],
    });

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(180))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))?;
    info!(
        "Requesting completion from Kantega LLM proxy (model: {})",
        model
    );

    let response = client
        .post(KANTEGA_LLMPROXY_URL)
        .header("content-type", "application/json")
        .header("x-api-key", api_key)
        .header("anthropic-version", ANTHROPIC_VERSION)
        .json(&body)
        .send()
        .await
        .map_err(|e| {
            error!("Kantega LLM proxy request failed: {}", e);
            format!("Could not reach the LLM proxy: {}", e)
        })?;

    let status = response.status();
    if !status.is_success() {
        let detail = response.text().await.unwrap_or_default();
        error!("Kantega LLM proxy returned {}: {}", status, detail);
        let hint = if status.as_u16() == 401 || status.as_u16() == 403 {
            " (check your API key)"
        } else {
            ""
        };
        return Err(format!("LLM proxy error {}{}", status.as_u16(), hint));
    }

    let parsed: MessagesResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse LLM proxy response: {}", e))?;

    let text = parsed
        .content
        .into_iter()
        .filter(|b| b.block_type == "text" || b.block_type.is_empty())
        .map(|b| b.text)
        .collect::<Vec<_>>()
        .join("")
        .trim()
        .to_string();

    if text.is_empty() {
        return Err("LLM proxy returned an empty response".to_string());
    }

    info!("LLM proxy response received ({} chars)", text.len());
    Ok(text)
}

/// Summarise `transcript` with `system_prompt` as the summary instruction.
pub async fn summarize(
    api_key: &str,
    model: &str,
    system_prompt: &str,
    transcript: &str,
) -> Result<String, String> {
    if transcript.trim().is_empty() {
        return Err("Transcript is empty".to_string());
    }
    complete(api_key, model, system_prompt, transcript).await
}
