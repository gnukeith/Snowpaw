use std::env;
use std::path::Path;
use std::process::Command;
use tauri_build::{AppManifest, Attributes};

fn main() {
    // Naming the commands here switches on Tauri's access control for them: a
    // window can call one only if a file in capabilities/ grants it. Without
    // this list, every window and webview could call every command.
    let commands = AppManifest::new().commands(&[
        "vm_start",
        "vm_stop",
        "vm_status",
        "vm_frame",
        "device_name",
        "window_buttons",
        "window_drag",
        "window_minimize",
        "window_toggle_maximize",
        "window_close",
        "window_tint",
        "key_save",
        "key_exists",
        "key_forget",
        "models_list",
        "search_test",
        "chat_send",
        "chat_stop",
    ]);
    tauri_build::try_build(Attributes::new().app_manifest(commands)).expect("failed to run tauri-build");

    // The keeper is a separate program that runs inside the machine's
    // sandbox (see keeper/main.rs). It is compiled here and carried inside
    // the app, so there is still one file to build, test and ship.
    println!("cargo:rerun-if-changed=keeper/main.rs");
    let variable = |name| env::var(name).expect("cargo sets this for build scripts");
    let built = Command::new(variable("RUSTC"))
        .args(["--edition", "2024", "--crate-name", "keeper", "--target", &variable("TARGET")])
        .args(["-C", "opt-level=s", "-C", "panic=abort", "-C", "strip=symbols", "-o"])
        .arg(Path::new(&variable("OUT_DIR")).join("keeper"))
        .arg("keeper/main.rs")
        .status()
        .expect("failed to run the compiler on the keeper");
    assert!(built.success(), "the keeper did not compile");
}
