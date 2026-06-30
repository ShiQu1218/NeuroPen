use base64::Engine;
use once_cell::sync::Lazy;
use rfd::AsyncFileDialog;
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

const MAX_ATTACHMENT_COUNT: usize = 8;
const MAX_TEXT_ATTACHMENT_BYTES: u64 = 2 * 1024 * 1024;
const MAX_IMAGE_ATTACHMENT_BYTES: u64 = 10 * 1024 * 1024;
const MAX_PDF_ATTACHMENT_BYTES: u64 = 15 * 1024 * 1024;
const DROP_AUTH_TTL: Duration = Duration::from_secs(30);

#[derive(Debug, Clone)]
struct AuthorizedDropPath {
    path: PathBuf,
    expires_at: Instant,
}

static AUTHORIZED_DROPS: Lazy<Mutex<HashMap<String, Vec<AuthorizedDropPath>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

#[derive(Debug, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum LoadedAttachment {
    Image {
        name: String,
        mime_type: String,
        base64_data: String,
    },
    Text {
        name: String,
        mime_type: String,
        text_content: String,
        truncated: bool,
    },
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PickAttachmentsResult {
    attachments: Vec<LoadedAttachment>,
    skipped_count: usize,
}

#[tauri::command]
pub fn load_attachment(file_name: String, bytes: Vec<u8>) -> Result<LoadedAttachment, String> {
    parse_attachment(file_name, bytes)
}

#[tauri::command]
pub async fn pick_attachments() -> Result<PickAttachmentsResult, String> {
    let files = AsyncFileDialog::new()
        .add_filter(
            "Supported files",
            &[
                "png", "jpg", "jpeg", "webp", "gif", "bmp", "pdf", "txt", "md", "markdown", "json",
                "csv", "ts", "tsx", "js", "jsx", "rs", "py", "html", "htm", "css", "yaml", "yml",
                "xml", "log", "ini", "toml",
            ],
        )
        .pick_files()
        .await
        .ok_or_else(|| "No file selected.".to_string())?;

    if files.len() > MAX_ATTACHMENT_COUNT {
        return Err(format!(
            "Please select at most {MAX_ATTACHMENT_COUNT} files at a time."
        ));
    }

    let mut loaded_files = Vec::with_capacity(files.len());
    for file in files {
        let file_name = file.file_name();
        match validate_attachment_path(file.path()) {
            Ok(()) => loaded_files.push((file_name, file.read().await)),
            Err(_) => loaded_files.push((file_name, Vec::new())),
        }
    }
    Ok(parse_attachment_batch(loaded_files))
}

#[tauri::command]
pub fn load_attachments_from_paths(
    window: tauri::Window,
    paths: Vec<String>,
) -> Result<PickAttachmentsResult, String> {
    if paths.is_empty() {
        return Err("No file selected.".to_string());
    }
    if paths.len() > MAX_ATTACHMENT_COUNT {
        return Err(format!(
            "Please drop at most {MAX_ATTACHMENT_COUNT} files at a time."
        ));
    }

    let mut loaded_files = Vec::with_capacity(paths.len());
    for path in paths {
        let normalized_path = path.trim();
        if normalized_path.is_empty() {
            continue;
        }
        let path = Path::new(normalized_path);
        let Some(canonical_path) = authorized_canonical_path(window.label(), path) else {
            return Err(
                "Dropped file paths are no longer authorized. Drop the files again.".to_string(),
            );
        };
        match read_attachment_from_path(&canonical_path) {
            Ok(file) => loaded_files.push(file),
            Err(_) => {
                let file_name = safe_file_name(path);
                loaded_files.push((file_name, Vec::new()));
            }
        }
    }

    Ok(parse_attachment_batch(loaded_files))
}

pub(crate) fn record_native_drop_paths(window_label: &str, paths: &[PathBuf]) {
    let now = Instant::now();
    let expires_at = now + DROP_AUTH_TTL;
    let mut canonical_paths = Vec::new();

    for path in paths.iter().take(MAX_ATTACHMENT_COUNT) {
        if let Ok(canonical_path) = canonical_file_path(path) {
            canonical_paths.push(AuthorizedDropPath {
                path: canonical_path,
                expires_at,
            });
        }
    }

    if canonical_paths.is_empty() {
        return;
    }

    let Ok(mut drops_by_window) = AUTHORIZED_DROPS.lock() else {
        return;
    };
    let window_paths = drops_by_window
        .entry(window_label.to_string())
        .or_insert_with(Vec::new);
    window_paths.retain(|entry| entry.expires_at > now);
    window_paths.extend(canonical_paths);
    if window_paths.len() > MAX_ATTACHMENT_COUNT {
        let excess = window_paths.len() - MAX_ATTACHMENT_COUNT;
        window_paths.drain(0..excess);
    }
}

fn parse_attachment_batch(files: Vec<(String, Vec<u8>)>) -> PickAttachmentsResult {
    let mut attachments = Vec::with_capacity(files.len());
    let mut skipped_count = 0;
    // Batch loading is best-effort so one unreadable file does not block the rest.
    for (file_name, bytes) in files {
        match parse_attachment(file_name, bytes) {
            Ok(attachment) => attachments.push(attachment),
            Err(_) => skipped_count += 1,
        }
    }

    PickAttachmentsResult {
        attachments,
        skipped_count,
    }
}

fn parse_attachment(file_name: String, bytes: Vec<u8>) -> Result<LoadedAttachment, String> {
    if file_name.trim().is_empty() {
        return Err("No file selected.".to_string());
    }
    if bytes.is_empty() {
        return Err("The selected file is empty.".to_string());
    }

    // Normalize the visible name first so the frontend never receives path segments
    // from drag/drop sources or native file pickers.
    let safe_file_name = Path::new(file_name.trim())
        .file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.to_string())
        .unwrap_or_else(|| "attachment".to_string());
    let extension = normalized_extension(&safe_file_name);
    let mime_type = detect_mime_type(&extension);
    validate_attachment_bytes(&extension, bytes.len() as u64)?;

    if is_supported_image_extension(&extension) {
        return Ok(LoadedAttachment::Image {
            name: safe_file_name,
            mime_type: mime_type.to_string(),
            base64_data: base64::engine::general_purpose::STANDARD.encode(bytes),
        });
    }

    if extension == "pdf" {
        // PDFs are converted to plain text up front so the frontend can treat them
        // the same as other text attachments when building LLM context.
        let extracted = pdf_extract::extract_text_from_mem(&bytes)
            .map_err(|err| format!("Failed to read PDF text: {err}"))?;
        let normalized = normalize_attachment_text(&extracted);
        if normalized.trim().is_empty() {
            return Err("The PDF did not contain readable text.".to_string());
        }
        return Ok(LoadedAttachment::Text {
            name: safe_file_name,
            mime_type: mime_type.to_string(),
            text_content: normalized,
            truncated: false,
        });
    }

    if is_supported_text_extension(&extension) {
        let text = String::from_utf8_lossy(&bytes).into_owned();
        let normalized = normalize_attachment_text(&text);
        if normalized.trim().is_empty() {
            return Err("The selected file is empty.".to_string());
        }
        return Ok(LoadedAttachment::Text {
            name: safe_file_name,
            mime_type: mime_type.to_string(),
            text_content: normalized,
            truncated: false,
        });
    }

    Err("Unsupported file type. Use an image, PDF, or text-based file.".to_string())
}

fn normalized_extension(file_name: &str) -> String {
    Path::new(file_name)
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.trim().to_ascii_lowercase())
        .unwrap_or_default()
}

fn read_attachment_from_path(path: &Path) -> Result<(String, Vec<u8>), String> {
    validate_attachment_path(path)?;
    let file_name = safe_file_name(path);
    let bytes = std::fs::read(path).map_err(|err| format!("Failed to read file: {err}"))?;
    Ok((file_name, bytes))
}

fn validate_attachment_path(path: &Path) -> Result<(), String> {
    let metadata =
        std::fs::metadata(path).map_err(|err| format!("Failed to inspect file: {err}"))?;
    if !metadata.is_file() {
        return Err("The selected path is not a file.".to_string());
    }
    let file_name = safe_file_name(path);
    let extension = normalized_extension(&file_name);
    validate_attachment_bytes(&extension, metadata.len())
}

fn validate_attachment_bytes(extension: &str, byte_len: u64) -> Result<(), String> {
    if is_supported_image_extension(extension) {
        if byte_len > MAX_IMAGE_ATTACHMENT_BYTES {
            return Err("The selected image is too large. Please keep it under 10 MB.".to_string());
        }
        return Ok(());
    }
    if extension == "pdf" {
        if byte_len > MAX_PDF_ATTACHMENT_BYTES {
            return Err("The selected PDF is too large. Please keep it under 15 MB.".to_string());
        }
        return Ok(());
    }
    if is_supported_text_extension(extension) {
        if byte_len > MAX_TEXT_ATTACHMENT_BYTES {
            return Err(
                "The selected text file is too large. Please keep it under 2 MB.".to_string(),
            );
        }
        return Ok(());
    }
    Err("Unsupported file type. Use an image, PDF, or text-based file.".to_string())
}

fn authorized_canonical_path(window_label: &str, path: &Path) -> Option<PathBuf> {
    let Ok(canonical_path) = canonical_file_path(path) else {
        return None;
    };
    let now = Instant::now();
    let Ok(mut drops_by_window) = AUTHORIZED_DROPS.lock() else {
        return None;
    };
    let Some(window_paths) = drops_by_window.get_mut(window_label) else {
        return None;
    };
    window_paths.retain(|entry| entry.expires_at > now);
    window_paths
        .iter()
        .any(|entry| entry.path == canonical_path)
        .then_some(canonical_path)
}

#[cfg(test)]
fn is_path_authorized_for_window(window_label: &str, path: &Path) -> bool {
    authorized_canonical_path(window_label, path).is_some()
}

fn canonical_file_path(path: &Path) -> Result<PathBuf, String> {
    let canonical_path = path
        .canonicalize()
        .map_err(|err| format!("Failed to resolve file path: {err}"))?;
    let metadata = std::fs::metadata(&canonical_path)
        .map_err(|err| format!("Failed to inspect file: {err}"))?;
    if !metadata.is_file() {
        return Err("The selected path is not a file.".to_string());
    }
    Ok(canonical_path)
}

fn safe_file_name(path: &Path) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.to_string())
        .unwrap_or_else(|| "attachment".to_string())
}

fn detect_mime_type(extension: &str) -> &'static str {
    match extension {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "bmp" => "image/bmp",
        "txt" | "log" | "ini" => "text/plain",
        "md" | "markdown" => "text/markdown",
        "json" => "application/json",
        "csv" => "text/csv",
        "ts" => "text/x.typescript",
        "tsx" => "text/x.tsx",
        "js" => "text/javascript",
        "jsx" => "text/jsx",
        "rs" => "text/rust",
        "py" => "text/x.python",
        "html" | "htm" => "text/html",
        "css" => "text/css",
        "yaml" | "yml" => "application/yaml",
        "xml" => "application/xml",
        "toml" => "application/toml",
        "pdf" => "application/pdf",
        _ => "application/octet-stream",
    }
}

fn is_supported_image_extension(extension: &str) -> bool {
    matches!(extension, "png" | "jpg" | "jpeg" | "webp" | "gif" | "bmp")
}

fn is_supported_text_extension(extension: &str) -> bool {
    matches!(
        extension,
        "txt"
            | "md"
            | "markdown"
            | "json"
            | "csv"
            | "ts"
            | "tsx"
            | "js"
            | "jsx"
            | "rs"
            | "py"
            | "html"
            | "htm"
            | "css"
            | "yaml"
            | "yml"
            | "xml"
            | "log"
            | "ini"
            | "toml"
    )
}

fn normalize_attachment_text(text: &str) -> String {
    text.replace('\u{0000}', "")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn oversized_text_attachment_is_rejected_before_decoding() {
        let bytes = vec![b'a'; (MAX_TEXT_ATTACHMENT_BYTES + 1) as usize];

        let result = parse_attachment("large.txt".to_string(), bytes);

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("text file is too large"));
    }

    #[test]
    fn text_attachment_preserves_content_within_size_limit() {
        let text = "a".repeat(18_500);

        let result = parse_attachment("long.txt".to_string(), text.clone().into_bytes())
            .expect("long text under byte limit should parse");

        match result {
            LoadedAttachment::Text {
                text_content,
                truncated,
                ..
            } => {
                assert_eq!(text_content, text);
                assert!(!truncated);
            }
            LoadedAttachment::Image { .. } => panic!("expected text attachment"),
        }
    }

    #[test]
    fn unsupported_extension_is_rejected_by_size_validation() {
        let result = validate_attachment_bytes("exe", 128);

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Unsupported file type"));
    }

    #[test]
    fn native_drop_authorization_is_scoped_to_window_label() {
        let path =
            std::env::temp_dir().join(format!("neuropen-drop-auth-{}.txt", std::process::id()));
        std::fs::write(&path, "ok").expect("write temp attachment");

        record_native_drop_paths("preview", &[path.clone()]);

        assert!(is_path_authorized_for_window("preview", &path));
        assert!(!is_path_authorized_for_window("settings", &path));

        let _ = std::fs::remove_file(path);
    }
}
