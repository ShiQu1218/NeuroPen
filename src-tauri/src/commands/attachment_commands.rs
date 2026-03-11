use base64::Engine;
use rfd::AsyncFileDialog;
use serde::Serialize;
use std::path::Path;

const MAX_TEXT_ATTACHMENT_CHARS: usize = 18_000;
const MAX_IMAGE_ATTACHMENT_BYTES: usize = 10 * 1024 * 1024;

#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
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

#[tauri::command]
pub fn load_attachment(file_name: String, bytes: Vec<u8>) -> Result<LoadedAttachment, String> {
    parse_attachment(file_name, bytes)
}

#[tauri::command]
pub async fn pick_attachment() -> Result<LoadedAttachment, String> {
    let file = AsyncFileDialog::new()
        .add_filter(
            "Supported files",
            &[
                "png", "jpg", "jpeg", "webp", "gif", "bmp", "pdf", "txt", "md", "markdown",
                "json", "csv", "ts", "tsx", "js", "jsx", "rs", "py", "html", "htm", "css",
                "yaml", "yml", "xml", "log", "ini", "toml",
            ],
        )
        .pick_file()
        .await
        .ok_or_else(|| "No file selected.".to_string())?;

    let file_name = file.file_name();
    let bytes = file
        .read()
        .await;
    parse_attachment(file_name, bytes)
}

fn parse_attachment(file_name: String, bytes: Vec<u8>) -> Result<LoadedAttachment, String> {
    if file_name.trim().is_empty() {
        return Err("No file selected.".to_string());
    }
    if bytes.is_empty() {
        return Err("The selected file is empty.".to_string());
    }

    let safe_file_name = Path::new(file_name.trim())
        .file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.to_string())
        .unwrap_or_else(|| "attachment".to_string());
    let extension = normalized_extension(&safe_file_name);
    let mime_type = detect_mime_type(&extension);

    if is_supported_image_extension(&extension) {
        if bytes.len() > MAX_IMAGE_ATTACHMENT_BYTES {
            return Err("The selected image is too large. Please keep it under 10 MB.".to_string());
        }
        return Ok(LoadedAttachment::Image {
            name: safe_file_name,
            mime_type: mime_type.to_string(),
            base64_data: base64::engine::general_purpose::STANDARD.encode(bytes),
        });
    }

    if extension == "pdf" {
        let extracted = pdf_extract::extract_text_from_mem(&bytes)
            .map_err(|err| format!("Failed to read PDF text: {err}"))?;
        let normalized = normalize_attachment_text(&extracted);
        if normalized.trim().is_empty() {
            return Err("The PDF did not contain readable text.".to_string());
        }
        let (text_content, truncated) = truncate_text(normalized, MAX_TEXT_ATTACHMENT_CHARS);
        return Ok(LoadedAttachment::Text {
            name: safe_file_name,
            mime_type: mime_type.to_string(),
            text_content,
            truncated,
        });
    }

    if is_supported_text_extension(&extension) {
        let text = String::from_utf8_lossy(&bytes).into_owned();
        let normalized = normalize_attachment_text(&text);
        if normalized.trim().is_empty() {
            return Err("The selected file is empty.".to_string());
        }
        let (text_content, truncated) = truncate_text(normalized, MAX_TEXT_ATTACHMENT_CHARS);
        return Ok(LoadedAttachment::Text {
            name: safe_file_name,
            mime_type: mime_type.to_string(),
            text_content,
            truncated,
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

fn truncate_text(text: String, max_chars: usize) -> (String, bool) {
    let char_count = text.chars().count();
    if char_count <= max_chars {
        return (text, false);
    }
    let truncated = text.chars().take(max_chars).collect::<String>();
    (truncated, true)
}
