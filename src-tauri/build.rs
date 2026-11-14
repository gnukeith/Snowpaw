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
    ]);
    tauri_build::try_build(Attributes::new().app_manifest(commands)).expect("failed to run tauri-build");
}
