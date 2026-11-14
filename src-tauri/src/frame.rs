//! The window's frame. The desktop's title bar is taken away, so that the
//! app's own surface reaches the top edge of the window. What the title bar
//! did (move the window, maximise, minimise, close it) is asked for by the
//! page instead, through the commands at the bottom.

use gtk::prelude::*;
use tauri::{State, WebviewWindow, Window};

/// Marks the app's own window, so that what is done to its frame is not also
/// done to a file chooser or any other window the toolkit opens for the app.
const BARE_CLASS: &str = "snowpaw-bare";

/// What the page draws when the desktop has no button layout to offer.
const FALLBACK_BUTTONS: &str = ":close";

/// How the window ended up.
pub struct Frame {
    /// False if the title bar could not be taken away. The desktop then still
    /// draws its own, and the page must not draw a second set of buttons.
    bare: bool,
}

/// Takes the title bar away and shows the window. The window has to be hidden
/// until now (`visible: false` in tauri.conf.json): GTK accepts a different
/// title bar only on a window that has never been shown.
pub fn open(window: &WebviewWindow) -> Frame {
    let bare = remove_title_bar(window)
        .inspect_err(|error| eprintln!("frame: the title bar stays: {error}"))
        .is_ok();
    if let Err(error) = window.show() {
        eprintln!("frame: the window could not be shown: {error}");
    }
    Frame { bare }
}

fn remove_title_bar(window: &WebviewWindow) -> Result<(), String> {
    let window = window.gtk_window().map_err(|error| error.to_string())?;
    if window.is_realized() {
        return Err("the window has already been shown".into());
    }
    // Giving GTK a title bar of our own tells it to draw the window's frame
    // itself, with its shadow and the edges that resize. One that is never
    // shown takes up no room, which leaves that frame and nothing else.
    let nothing = gtk::Box::new(gtk::Orientation::Horizontal, 0);
    nothing.set_no_show_all(true);
    window.set_titlebar(Some(&nothing));
    square_the_frame(&window);
    Ok(())
}

/// Themes round the top corners of the frame to fit the title bar that used to
/// sit there. The page under it is a plain rectangle, so the frame's outline
/// curved away behind the page's top corners and showed as a line with notched
/// ends, on top only. The frame is made a rectangle too: all four corners then
/// look alike. If this fails the window still works, with the notches.
fn square_the_frame(window: &gtk::ApplicationWindow) {
    window.style_context().add_class(BARE_CLASS);
    let style = gtk::CssProvider::new();
    let rule = format!(".{BARE_CLASS} decoration {{ border-radius: 0; }}");
    let loaded = style.load_from_data(rule.as_bytes());
    match (loaded, gtk::prelude::GtkWindowExt::screen(window)) {
        (Ok(()), Some(screen)) => gtk::StyleContext::add_provider_for_screen(
            &screen,
            &style,
            gtk::STYLE_PROVIDER_PRIORITY_APPLICATION,
        ),
        (Err(error), _) => eprintln!("frame: the frame keeps its round corners: {error}"),
        (_, None) => eprintln!("frame: the frame keeps its round corners: no screen"),
    }
}

// Like every command the webview gets, these take no argument. Each acts on
// the window that asked and on no other.

/// The buttons the desktop puts on a window and the side each goes on, as GTK
/// writes it: `icon:minimize,maximize,close`. `None` while the desktop still
/// draws the title bar itself.
#[tauri::command]
pub fn window_buttons(frame: State<Frame>) -> Option<String> {
    frame.bare.then(|| {
        gtk::Settings::default()
            .and_then(|settings| settings.gtk_decoration_layout())
            .map_or_else(|| FALLBACK_BUTTONS.to_owned(), String::from)
    })
}

/// Starts moving the window with the pointer, as pressing on a title bar does.
#[tauri::command]
pub fn window_drag(window: Window) {
    report("window_drag", window.start_dragging());
}

#[tauri::command]
pub fn window_minimize(window: Window) {
    report("window_minimize", window.minimize());
}

/// Maximises the window, or puts it back if it is maximised.
#[tauri::command]
pub fn window_toggle_maximize(window: Window) {
    let done = window.is_maximized().and_then(|maximized| {
        if maximized {
            window.unmaximize()
        } else {
            window.maximize()
        }
    });
    report("window_toggle_maximize", done);
}

#[tauri::command]
pub fn window_close(window: Window) {
    report("window_close", window.close());
}

fn report(command: &str, done: tauri::Result<()>) {
    if let Err(error) = done {
        eprintln!("{command}: {error}");
    }
}
