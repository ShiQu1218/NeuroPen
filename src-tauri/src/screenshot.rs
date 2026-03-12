//! Screenshot module — capture screen region for multimodal LLM queries.
//!
//! Uses Windows Graphics Capture on Windows so hardware-accelerated video
//! surfaces (for example YouTube / Bilibili playback) are captured correctly.
//! Falls back to an explicit error on unsupported platforms.

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct ScreenshotResult {
    /// Base64-encoded PNG
    pub base64_png: String,
    pub width: u32,
    pub height: u32,
}

#[cfg(target_os = "windows")]
mod windows_capture {
    use super::ScreenshotResult;
    use std::sync::mpsc::channel;
    use std::time::Duration;

    use windows::{
        Foundation::TypedEventHandler,
        Graphics::{
            Capture::{Direct3D11CaptureFramePool, GraphicsCaptureItem},
            DirectX::{Direct3D11::IDirect3DDevice, DirectXPixelFormat},
        },
        Win32::{
            Foundation::{BOOL, LPARAM, POINT, RECT},
            Graphics::{
                Direct3D::D3D_DRIVER_TYPE_HARDWARE,
                Direct3D11::{
                    D3D11_BOX, D3D11_CPU_ACCESS_READ, D3D11_CREATE_DEVICE_BGRA_SUPPORT,
                    D3D11_MAP_READ, D3D11_MAPPED_SUBRESOURCE, D3D11_SDK_VERSION,
                    D3D11_TEXTURE2D_DESC, D3D11_USAGE_STAGING, D3D11CreateDevice, ID3D11Device,
                    ID3D11DeviceContext, ID3D11Resource, ID3D11Texture2D,
                },
                Dxgi::IDXGIDevice,
                Gdi::{
                    EnumDisplayMonitors, GetMonitorInfoW, HDC, HMONITOR, MONITORINFO,
                    MONITOR_DEFAULTTOPRIMARY, MonitorFromPoint,
                },
            },
            System::WinRT::{
                Direct3D11::{CreateDirect3D11DeviceFromDXGIDevice, IDirect3DDxgiInterfaceAccess},
                Graphics::Capture::IGraphicsCaptureItemInterop,
            },
        },
        core::{IInspectable, Interface, factory},
    };

    pub fn capture_full_screen() -> Result<ScreenshotResult, String> {
        let hmonitor = unsafe { MonitorFromPoint(POINT { x: 0, y: 0 }, MONITOR_DEFAULTTOPRIMARY) };
        if hmonitor.0.is_null() {
            return Err("Unable to locate the primary monitor for screenshot capture.".to_string());
        }

        let monitor_rect = get_monitor_rect(hmonitor)?;
        let width = rect_width(&monitor_rect)?;
        let height = rect_height(&monitor_rect)?;

        capture_monitor_region(hmonitor, 0, 0, width, height)
    }

    pub fn capture_region(x: i32, y: i32, w: u32, h: u32) -> Result<ScreenshotResult, String> {
        if w == 0 || h == 0 {
            return Err("Screenshot region must have a non-zero width and height.".to_string());
        }

        let right = x
            .checked_add(i32::try_from(w).map_err(|_| "Screenshot width exceeds the supported range.")?)
            .ok_or_else(|| "Screenshot region exceeds the supported coordinate range.".to_string())?;
        let bottom = y
            .checked_add(i32::try_from(h).map_err(|_| "Screenshot height exceeds the supported range.")?)
            .ok_or_else(|| "Screenshot region exceeds the supported coordinate range.".to_string())?;

        let region_rect = RECT {
            left: x,
            top: y,
            right,
            bottom,
        };

        // Stitch together every monitor that intersects the requested virtual-desktop rectangle so
        // drag selections can span multiple displays instead of being truncated to one monitor.
        let monitor_regions = enumerate_intersecting_monitors(&region_rect)?;
        if monitor_regions.is_empty() {
            return Err("Unable to locate the target monitor for screenshot capture.".to_string());
        }
        let mut composited_rgba = vec![0u8; (w as usize) * (h as usize) * 4];

        for (hmonitor, monitor_rect, intersection_rect) in monitor_regions {
            let crop_x = u32::try_from(intersection_rect.left - monitor_rect.left)
                .map_err(|_| "Screenshot crop origin is outside the supported range.".to_string())?;
            let crop_y = u32::try_from(intersection_rect.top - monitor_rect.top)
                .map_err(|_| "Screenshot crop origin is outside the supported range.".to_string())?;
            let crop_w = rect_width(&intersection_rect)?;
            let crop_h = rect_height(&intersection_rect)?;
            let (rgba_pixels, _, _) =
                capture_monitor_region_rgba(hmonitor, crop_x, crop_y, crop_w, crop_h)?;
            let destination_x = u32::try_from(intersection_rect.left - x)
                .map_err(|_| "Screenshot destination origin is outside the supported range.".to_string())?;
            let destination_y = u32::try_from(intersection_rect.top - y)
                .map_err(|_| "Screenshot destination origin is outside the supported range.".to_string())?;

            blit_rgba_region(
                &mut composited_rgba,
                w,
                &rgba_pixels,
                crop_w,
                crop_h,
                destination_x,
                destination_y,
            );
        }

        encode_png(composited_rgba, w, h)
    }

    fn capture_monitor_region(
        hmonitor: HMONITOR,
        crop_x: u32,
        crop_y: u32,
        crop_w: u32,
        crop_h: u32,
    ) -> Result<ScreenshotResult, String> {
        let (rgba_pixels, width, height) =
            capture_monitor_region_rgba(hmonitor, crop_x, crop_y, crop_w, crop_h)?;
        encode_png(rgba_pixels, width, height)
    }

    fn capture_monitor_region_rgba(
        hmonitor: HMONITOR,
        crop_x: u32,
        crop_y: u32,
        crop_w: u32,
        crop_h: u32,
    ) -> Result<(Vec<u8>, u32, u32), String> {
        let d3d_device = create_d3d_device()?;
        let d3d_context = unsafe {
            d3d_device
                .GetImmediateContext()
                .map_err(|e| format!("Failed to acquire the D3D11 device context: {e}"))?
        };
        let dxgi_device = d3d_device
            .cast::<IDXGIDevice>()
            .map_err(|e| format!("Failed to cast the D3D11 device to DXGI: {e}"))?;
        let inspectable = unsafe {
            CreateDirect3D11DeviceFromDXGIDevice(&dxgi_device)
                .map_err(|e| format!("Failed to create the WinRT Direct3D device: {e}"))?
        };
        let capture_device = inspectable
            .cast::<IDirect3DDevice>()
            .map_err(|e| format!("Failed to cast the WinRT Direct3D device: {e}"))?;
        let capture_item = create_monitor_capture_item(hmonitor)?;
        let capture_size = capture_item
            .Size()
            .map_err(|e| format!("Failed to query the monitor capture size: {e}"))?;
        let frame_pool = Direct3D11CaptureFramePool::CreateFreeThreaded(
            &capture_device,
            DirectXPixelFormat::B8G8R8A8UIntNormalized,
            1,
            capture_size,
        )
        .map_err(|e| format!("Failed to create the capture frame pool: {e}"))?;

        let (sender, receiver) = channel::<Result<(Vec<u8>, u32, u32), String>>();
        let d3d_device_for_frame = d3d_device.clone();
        let d3d_context_for_frame = d3d_context.clone();

        frame_pool
            .FrameArrived(&TypedEventHandler::<Direct3D11CaptureFramePool, IInspectable>::new(
                move |pool, _| {
                    let Some(pool) = pool else {
                        let _ = sender.send(Err("Capture frame pool was unexpectedly unavailable.".to_string()));
                        return Ok(());
                    };

                    let frame_result = extract_cropped_frame(
                        &d3d_device_for_frame,
                        &d3d_context_for_frame,
                        &pool,
                        crop_x,
                        crop_y,
                        crop_w,
                        crop_h,
                    );
                    let _ = sender.send(frame_result);
                    Ok(())
                },
            ))
            .map_err(|e| format!("Failed to subscribe to capture frames: {e}"))?;

        let session = frame_pool
            .CreateCaptureSession(&capture_item)
            .map_err(|e| format!("Failed to create the monitor capture session: {e}"))?;
        let _ = session.SetIsBorderRequired(false);
        let _ = session.SetIsCursorCaptureEnabled(false);
        session
            .StartCapture()
            .map_err(|e| format!("Failed to start monitor capture: {e}"))?;

        let (rgba_pixels, width, height) = receiver
            .recv_timeout(Duration::from_millis(750))
            .map_err(|_| "Timed out while waiting for the monitor frame.".to_string())??;

        session.Close().ok();
        frame_pool.Close().ok();
        Ok((rgba_pixels, width, height))
    }

    fn create_d3d_device() -> Result<ID3D11Device, String> {
        unsafe {
            let mut d3d_device = None;
            D3D11CreateDevice(
                None,
                D3D_DRIVER_TYPE_HARDWARE,
                None,
                D3D11_CREATE_DEVICE_BGRA_SUPPORT,
                None,
                D3D11_SDK_VERSION,
                Some(&mut d3d_device),
                None,
                None,
            )
            .map_err(|e| format!("Failed to create the D3D11 device: {e}"))?;

            d3d_device.ok_or_else(|| "D3D11 device creation returned no device.".to_string())
        }
    }

    fn create_monitor_capture_item(hmonitor: HMONITOR) -> Result<GraphicsCaptureItem, String> {
        let interop = factory::<GraphicsCaptureItem, IGraphicsCaptureItemInterop>()
            .map_err(|e| format!("Failed to access GraphicsCaptureItem interop: {e}"))?;
        unsafe {
            interop
                .CreateForMonitor::<HMONITOR, GraphicsCaptureItem>(hmonitor)
                .map_err(|e| format!("Failed to create the monitor capture item: {e}"))
        }
    }

    fn get_monitor_rect(hmonitor: HMONITOR) -> Result<RECT, String> {
        let mut monitor_info = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        unsafe {
            GetMonitorInfoW(hmonitor, &mut monitor_info as *mut MONITORINFO as *mut _)
                .ok()
                .map_err(|e| format!("Failed to query monitor bounds: {e}"))?;
        }
        Ok(monitor_info.rcMonitor)
    }

    fn enumerate_intersecting_monitors(region_rect: &RECT) -> Result<Vec<(HMONITOR, RECT, RECT)>, String> {
        let monitors = enumerate_monitors()?;
        Ok(monitors
            .into_iter()
            .filter_map(|(hmonitor, monitor_rect)| {
                intersect_rect(region_rect, &monitor_rect)
                    .map(|intersection_rect| (hmonitor, monitor_rect, intersection_rect))
            })
            .collect())
    }

    fn enumerate_monitors() -> Result<Vec<(HMONITOR, RECT)>, String> {
        unsafe extern "system" fn enum_monitor_proc(
            hmonitor: HMONITOR,
            _hdc: HDC,
            _clip_rect: *mut RECT,
            lparam: LPARAM,
        ) -> BOOL {
            let monitors = &mut *(lparam.0 as *mut Vec<(HMONITOR, RECT)>);
            let mut monitor_info = MONITORINFO {
                cbSize: std::mem::size_of::<MONITORINFO>() as u32,
                ..Default::default()
            };

            if unsafe {
                GetMonitorInfoW(hmonitor, &mut monitor_info as *mut MONITORINFO as *mut _)
            }
            .as_bool()
            {
                monitors.push((hmonitor, monitor_info.rcMonitor));
            }

            true.into()
        }

        let mut monitors = Vec::<(HMONITOR, RECT)>::new();
        let success = unsafe {
            EnumDisplayMonitors(
                None,
                None,
                Some(enum_monitor_proc),
                LPARAM((&mut monitors as *mut Vec<(HMONITOR, RECT)>) as isize),
            )
        };

        if success.as_bool() {
          Ok(monitors)
        } else {
          Err("Failed to enumerate display monitors for screenshot capture.".to_string())
        }
    }

    fn intersect_rect(a: &RECT, b: &RECT) -> Option<RECT> {
        let left = a.left.max(b.left);
        let top = a.top.max(b.top);
        let right = a.right.min(b.right);
        let bottom = a.bottom.min(b.bottom);

        if right <= left || bottom <= top {
            return None;
        }

        Some(RECT {
            left,
            top,
            right,
            bottom,
        })
    }

    fn blit_rgba_region(
        destination: &mut [u8],
        destination_width: u32,
        source: &[u8],
        source_width: u32,
        source_height: u32,
        destination_x: u32,
        destination_y: u32,
    ) {
        for row in 0..source_height {
            let source_offset = (row * source_width * 4) as usize;
            let destination_offset =
                (((destination_y + row) * destination_width + destination_x) * 4) as usize;
            let copy_len = (source_width * 4) as usize;
            destination[destination_offset..destination_offset + copy_len]
                .copy_from_slice(&source[source_offset..source_offset + copy_len]);
        }
    }

    fn extract_cropped_frame(
        d3d_device: &ID3D11Device,
        d3d_context: &ID3D11DeviceContext,
        frame_pool: &Direct3D11CaptureFramePool,
        crop_x: u32,
        crop_y: u32,
        crop_w: u32,
        crop_h: u32,
    ) -> Result<(Vec<u8>, u32, u32), String> {
        let frame = frame_pool
            .TryGetNextFrame()
            .map_err(|e| format!("Failed to retrieve the next capture frame: {e}"))?;
        let surface = frame
            .Surface()
            .map_err(|e| format!("Failed to access the Direct3D frame surface: {e}"))?;
        let dxgi_access = surface
            .cast::<IDirect3DDxgiInterfaceAccess>()
            .map_err(|e| format!("Failed to access the DXGI frame texture: {e}"))?;
        let source_texture = unsafe {
            dxgi_access
                .GetInterface::<ID3D11Texture2D>()
                .map_err(|e| format!("Failed to access the D3D11 frame texture: {e}"))?
        };
        let rgba_pixels = crop_texture_to_rgba(
            d3d_device,
            d3d_context,
            &source_texture,
            crop_x,
            crop_y,
            crop_w,
            crop_h,
        )?;
        frame.Close().ok();
        Ok((rgba_pixels, crop_w, crop_h))
    }

    fn crop_texture_to_rgba(
        d3d_device: &ID3D11Device,
        d3d_context: &ID3D11DeviceContext,
        source_texture: &ID3D11Texture2D,
        crop_x: u32,
        crop_y: u32,
        crop_w: u32,
        crop_h: u32,
    ) -> Result<Vec<u8>, String> {
        unsafe {
            let mut source_desc = D3D11_TEXTURE2D_DESC::default();
            source_texture.GetDesc(&mut source_desc);

            if crop_x.checked_add(crop_w).is_none()
                || crop_y.checked_add(crop_h).is_none()
                || crop_x + crop_w > source_desc.Width
                || crop_y + crop_h > source_desc.Height
            {
                return Err("Requested screenshot crop falls outside the captured frame.".to_string());
            }

            let mut staging_desc = source_desc;
            staging_desc.Width = crop_w;
            staging_desc.Height = crop_h;
            staging_desc.BindFlags = 0;
            staging_desc.MiscFlags = 0;
            staging_desc.Usage = D3D11_USAGE_STAGING;
            staging_desc.CPUAccessFlags = D3D11_CPU_ACCESS_READ.0 as u32;

            let mut staging_texture = None;
            d3d_device
                .CreateTexture2D(&staging_desc, None, Some(&mut staging_texture))
                .map_err(|e| format!("Failed to create the staging screenshot texture: {e}"))?;
            let staging_texture = staging_texture
                .ok_or_else(|| "The staging screenshot texture was not created.".to_string())?;

            let source_resource = source_texture
                .cast::<ID3D11Resource>()
                .map_err(|e| format!("Failed to cast the source screenshot texture: {e}"))?;
            let staging_resource = staging_texture
                .cast::<ID3D11Resource>()
                .map_err(|e| format!("Failed to cast the staging screenshot texture: {e}"))?;
            let crop_box = D3D11_BOX {
                left: crop_x,
                top: crop_y,
                right: crop_x + crop_w,
                bottom: crop_y + crop_h,
                front: 0,
                back: 1,
            };

            d3d_context.CopySubresourceRegion(
                Some(&staging_resource),
                0,
                0,
                0,
                0,
                Some(&source_resource),
                0,
                Some(&crop_box),
            );

            let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
            d3d_context
                .Map(
                    Some(&staging_resource),
                    0,
                    D3D11_MAP_READ,
                    0,
                    Some(&mut mapped),
                )
                .map_err(|e| format!("Failed to map the screenshot texture for reading: {e}"))?;

            let mut rgba_pixels = vec![0u8; (crop_w * crop_h * 4) as usize];
            let source_ptr = mapped.pData as *const u8;
            for row in 0..crop_h {
                let source_offset = (row * mapped.RowPitch) as usize;
                let destination_offset = (row * crop_w * 4) as usize;
                let source_row =
                    std::slice::from_raw_parts(source_ptr.add(source_offset), (crop_w * 4) as usize);
                let destination_row =
                    &mut rgba_pixels[destination_offset..destination_offset + (crop_w * 4) as usize];
                destination_row.copy_from_slice(source_row);
                for pixel in destination_row.chunks_exact_mut(4) {
                    pixel.swap(0, 2);
                }
            }

            d3d_context.Unmap(Some(&staging_resource), 0);
            Ok(rgba_pixels)
        }
    }

    fn encode_png(rgba_pixels: Vec<u8>, width: u32, height: u32) -> Result<ScreenshotResult, String> {
        let mut png_buf = Vec::new();
        {
            let mut encoder = png::Encoder::new(std::io::Cursor::new(&mut png_buf), width, height);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            let mut writer = encoder
                .write_header()
                .map_err(|e| format!("PNG header error: {e}"))?;
            writer
                .write_image_data(&rgba_pixels)
                .map_err(|e| format!("PNG write error: {e}"))?;
        }

        use base64::Engine;
        Ok(ScreenshotResult {
            base64_png: base64::engine::general_purpose::STANDARD.encode(&png_buf),
            width,
            height,
        })
    }

    fn rect_width(rect: &RECT) -> Result<u32, String> {
        u32::try_from(rect.right - rect.left)
            .map_err(|_| "Monitor width is outside the supported range.".to_string())
    }

    fn rect_height(rect: &RECT) -> Result<u32, String> {
        u32::try_from(rect.bottom - rect.top)
            .map_err(|_| "Monitor height is outside the supported range.".to_string())
    }
}

/// Capture the entire primary screen.
#[cfg(target_os = "windows")]
pub fn capture_full_screen() -> Result<ScreenshotResult, String> {
    windows_capture::capture_full_screen()
}

#[cfg(not(target_os = "windows"))]
pub fn capture_full_screen() -> Result<ScreenshotResult, String> {
    Err("Screenshot capture is only supported on Windows".to_string())
}

/// Capture a specific screen region.
#[cfg(target_os = "windows")]
pub fn capture_region(x: i32, y: i32, w: u32, h: u32) -> Result<ScreenshotResult, String> {
    windows_capture::capture_region(x, y, w, h)
}

#[cfg(not(target_os = "windows"))]
pub fn capture_region(_x: i32, _y: i32, _w: u32, _h: u32) -> Result<ScreenshotResult, String> {
    Err("Screenshot capture is only supported on Windows".to_string())
}
