//! Outbound HTTP that isn't the webview's.
//!
//! Ledgeur is a webview app, so `fetch` from the frontend obeys the browser's
//! same-origin rules: a cross-origin POST carrying custom headers triggers a
//! CORS preflight, and the request only proceeds if the far end answers it with
//! `Access-Control-Allow-Origin`. That is correct for a web page and wrong for a
//! desktop app talking to a webhook endpoint the user configured themselves —
//! Zapier catch hooks, n8n, an internal CRM: almost none of them implement CORS,
//! because almost nothing that calls them is a browser. Every delivery would
//! have failed with a bare "Failed to fetch" and no way for the user to tell a
//! wrong URL from a receiver that simply doesn't speak CORS.
//!
//! So webhook deliveries go through the native side instead, where there is no
//! origin and no preflight. This is deliberately a narrow primitive — POST a
//! string body with string headers, return status and text — rather than a
//! general proxy: it exists for one caller, and the smaller it is the less there
//! is to reason about.

use std::collections::HashMap;
use std::time::Duration;

/// What the frontend gets back. Non-2xx is a value, not an error: a 422 from a
/// receiver is information the user needs to see, and mapping it onto `Err`
/// would flatten it into the same shape as "the network is down".
#[derive(serde::Serialize)]
pub struct HttpReply {
    pub status: u16,
    pub body: String,
}

/// Cap on how much of a receiver's reply is kept. A response body is only ever
/// shown to the user as an explanation of a failure; there is no reason to move
/// megabytes of someone's error page across the IPC boundary.
const MAX_BODY: usize = 8 * 1024;

#[tauri::command]
pub async fn http_post(
    url: String,
    headers: HashMap<String, String>,
    body: String,
    timeout_ms: Option<u64>,
) -> Result<HttpReply, String> {
    // Parsed rather than string-matched so a scheme cannot be smuggled past the
    // check (`HTTPS:`, `https:/\`, a userinfo section, …).
    let parsed = reqwest::Url::parse(&url).map_err(|e| format!("That isn't a valid URL: {e}"))?;
    let is_local = matches!(parsed.host_str(), Some("localhost" | "127.0.0.1" | "::1"));
    match parsed.scheme() {
        "https" => {}
        // Mirrors webhookUrlError in @ledgeur/core: plain http is refused
        // except on the loopback interface, where there is no network to
        // intercept and where every webhook gets tested before it is pointed at
        // anything real.
        "http" if is_local => {}
        "http" => return Err("Use an https:// URL — meeting notes shouldn't travel in clear text.".into()),
        other => return Err(format!("Webhooks have to be http(s), not {other}:")),
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(timeout_ms.unwrap_or(15_000)))
        .build()
        .map_err(|e| e.to_string())?;

    let mut request = client.post(parsed).body(body);
    for (name, value) in headers {
        request = request.header(name, value);
    }

    let response = request.send().await.map_err(|e| {
        if e.is_timeout() {
            "Timed out.".to_string()
        } else if e.is_connect() {
            format!("Could not reach that endpoint: {e}")
        } else {
            e.to_string()
        }
    })?;

    let status = response.status().as_u16();
    let mut text = response.text().await.unwrap_or_default();
    text.truncate(MAX_BODY);
    Ok(HttpReply { status, body: text })
}
