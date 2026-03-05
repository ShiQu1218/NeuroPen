//! Screenshot module — capture screen region for multimodal LLM queries.
//!
//! Uses Win32 API to capture the screen, encode to PNG, then pass to
//! LLM providers that support image input (OpenAI, Gemini, Claude).
//!
//! Emits:
//!   `screenshot://captured(base64)` — screenshot taken
//!   `screenshot://error(msg)`       — capture failed

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct ScreenshotResult {
    /// Base64-encoded PNG
    pub base64_png: String,
    pub width: u32,
    pub height: u32,
}

/// Capture the entire primary screen.
#[cfg(target_os = "windows")]
pub fn capture_full_screen() -> Result<ScreenshotResult, String> {
    use windows::Win32::UI::WindowsAndMessaging::{GetSystemMetrics, SM_CXSCREEN, SM_CYSCREEN};
    use windows::Win32::Graphics::Gdi::{
        CreateCompatibleBitmap, CreateCompatibleDC, SelectObject, BitBlt,
        GetDIBits, DeleteDC, DeleteObject, BITMAPINFO, BITMAPINFOHEADER,
        BI_RGB, DIB_RGB_COLORS, SRCCOPY,
    };
    use windows::Win32::UI::WindowsAndMessaging::GetDesktopWindow;
    use windows::Win32::Graphics::Gdi::GetDC;
    use windows::Win32::Graphics::Gdi::ReleaseDC;

    unsafe {
        let width = GetSystemMetrics(SM_CXSCREEN) as u32;
        let height = GetSystemMetrics(SM_CYSCREEN) as u32;

        let hwnd = GetDesktopWindow();
        let hdc_screen = GetDC(hwnd);
        let hdc_mem = CreateCompatibleDC(hdc_screen);
        let hbm = CreateCompatibleBitmap(hdc_screen, width as i32, height as i32);
        let old = SelectObject(hdc_mem, hbm);

        let _ = BitBlt(hdc_mem, 0, 0, width as i32, height as i32, hdc_screen, 0, 0, SRCCOPY);

        // Read pixel data
        let mut bmi = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: width as i32,
                biHeight: -(height as i32), // top-down
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };

        let row_bytes = (width * 4) as usize;
        let mut pixels = vec![0u8; row_bytes * height as usize];

        GetDIBits(
            hdc_mem,
            hbm,
            0,
            height,
            Some(pixels.as_mut_ptr() as *mut _),
            &mut bmi,
            DIB_RGB_COLORS,
        );

        SelectObject(hdc_mem, old);
        let _ = DeleteObject(hbm);
        let _ = DeleteDC(hdc_mem);
        ReleaseDC(hwnd, hdc_screen);

        // Convert BGRA → RGBA
        for chunk in pixels.chunks_exact_mut(4) {
            chunk.swap(0, 2); // B <-> R
        }

        // Encode as PNG
        let mut png_buf = Vec::new();
        {
            let mut encoder = png::Encoder::new(std::io::Cursor::new(&mut png_buf), width, height);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            let mut writer = encoder
                .write_header()
                .map_err(|e| format!("PNG header error: {e}"))?;
            writer
                .write_image_data(&pixels)
                .map_err(|e| format!("PNG write error: {e}"))?;
        }

        use base64::Engine;
        let b64 = base64::engine::general_purpose::STANDARD.encode(&png_buf);

        Ok(ScreenshotResult {
            base64_png: b64,
            width,
            height,
        })
    }
}

#[cfg(not(target_os = "windows"))]
pub fn capture_full_screen() -> Result<ScreenshotResult, String> {
    Err("Screenshot capture is only supported on Windows".to_string())
}

/// Capture a specific screen region.
#[cfg(target_os = "windows")]
pub fn capture_region(x: i32, y: i32, w: u32, h: u32) -> Result<ScreenshotResult, String> {
    use windows::Win32::Graphics::Gdi::{
        CreateCompatibleBitmap, CreateCompatibleDC, SelectObject, BitBlt,
        GetDIBits, DeleteDC, DeleteObject, BITMAPINFO, BITMAPINFOHEADER,
        BI_RGB, DIB_RGB_COLORS, SRCCOPY,
    };
    use windows::Win32::UI::WindowsAndMessaging::GetDesktopWindow;
    use windows::Win32::Graphics::Gdi::GetDC;
    use windows::Win32::Graphics::Gdi::ReleaseDC;

    unsafe {
        let hwnd = GetDesktopWindow();
        let hdc_screen = GetDC(hwnd);
        let hdc_mem = CreateCompatibleDC(hdc_screen);
        let hbm = CreateCompatibleBitmap(hdc_screen, w as i32, h as i32);
        let old = SelectObject(hdc_mem, hbm);

        let _ = BitBlt(hdc_mem, 0, 0, w as i32, h as i32, hdc_screen, x, y, SRCCOPY);

        let mut bmi = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: w as i32,
                biHeight: -(h as i32),
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };

        let mut pixels = vec![0u8; (w * 4) as usize * h as usize];
        GetDIBits(
            hdc_mem,
            hbm,
            0,
            h,
            Some(pixels.as_mut_ptr() as *mut _),
            &mut bmi,
            DIB_RGB_COLORS,
        );

        SelectObject(hdc_mem, old);
        let _ = DeleteObject(hbm);
        let _ = DeleteDC(hdc_mem);
        ReleaseDC(hwnd, hdc_screen);

        for chunk in pixels.chunks_exact_mut(4) {
            chunk.swap(0, 2);
        }

        let mut png_buf = Vec::new();
        {
            let mut encoder = png::Encoder::new(std::io::Cursor::new(&mut png_buf), w, h);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            let mut writer = encoder
                .write_header()
                .map_err(|e| format!("PNG header error: {e}"))?;
            writer
                .write_image_data(&pixels)
                .map_err(|e| format!("PNG write error: {e}"))?;
        }

        use base64::Engine;
        let b64 = base64::engine::general_purpose::STANDARD.encode(&png_buf);

        Ok(ScreenshotResult {
            base64_png: b64,
            width: w,
            height: h,
        })
    }
}

#[cfg(not(target_os = "windows"))]
pub fn capture_region(_x: i32, _y: i32, _w: u32, _h: u32) -> Result<ScreenshotResult, String> {
    Err("Screenshot capture is only supported on Windows".to_string())
}
