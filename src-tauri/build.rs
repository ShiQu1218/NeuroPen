use std::path::{Path, PathBuf};

/// Runtime DLLs that the sherpa-onnx `shared` build needs next to the executable.
const SHERPA_RUNTIME_DLLS: [&str; 3] = [
    "sherpa-onnx-c-api.dll",
    "onnxruntime.dll",
    "onnxruntime_providers_shared.dll",
];

fn main() {
    println!("cargo:rerun-if-changed=icons");
    println!("cargo:rerun-if-changed=tauri.conf.json");
    println!("cargo:rerun-if-changed=sherpa-runtime");
    stage_sherpa_runtime_dlls();
    tauri_build::build()
}

/// sherpa-onnx-sys copies its DLLs into the Cargo profile directory, whose location depends on
/// CARGO_TARGET_DIR. Stage them at a fixed path so tauri.conf.json can bundle them.
fn stage_sherpa_runtime_dlls() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("windows") {
        return;
    }
    let out_dir = PathBuf::from(std::env::var("OUT_DIR").expect("OUT_DIR"));
    // OUT_DIR = <profile dir>/build/<pkg>-<hash>/out
    let profile_dir = out_dir.ancestors().nth(3).expect("Cargo profile directory");
    let staging_dir = Path::new("sherpa-runtime");
    // Test binaries run from deps/. Without local copies, Windows loads the older
    // System32\onnxruntime.dll (1.17) and sherpa-onnx crashes.
    let deps_dir = profile_dir.join("deps");
    for target_dir in [staging_dir, deps_dir.as_path()] {
        std::fs::create_dir_all(target_dir).expect("create DLL target directory");
        for dll in SHERPA_RUNTIME_DLLS {
            let source = profile_dir.join(dll);
            std::fs::copy(&source, target_dir.join(dll)).unwrap_or_else(|e| {
                panic!("Failed to copy {} to {}: {e}", source.display(), target_dir.display());
            });
        }
    }
}
