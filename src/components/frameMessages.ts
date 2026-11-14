/** This channel carries data only. Never add commands, URLs, HTML, or SVG. */
export const frameFailure = "This diagram could not be drawn. Check its Mermaid syntax and size.";
export const maxFrameText = 10_000;
export const maxFrameHeight = 4096;
export interface FrameTheme {
  background: string;
  surface: string;
  text: string;
  muted: string;
  accent: string;
  border: string;
  font: string;
  fontSize: string;
}
export interface FrameInput { type: "render"; source: string; theme: FrameTheme }
export type FrameOutput = { type: "height"; height: number } | { type: "error"; message: typeof frameFailure };

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function keys(value: Record<string, unknown>, names: string[]) {
  return Object.keys(value).length === names.length && names.every((name) => Object.hasOwn(value, name));
}
export function frameInput(value: unknown): value is FrameInput {
  if (!record(value) || !keys(value, ["type", "source", "theme"]) || value.type !== "render" ||
      typeof value.source !== "string" || value.source.length > maxFrameText || !record(value.theme)) return false;
  const theme = value.theme;
  const colors = ["background", "surface", "text", "muted", "accent", "border"];
  return keys(theme, [...colors, "font", "fontSize"]) && colors.every((name) => typeof theme[name] === "string" && /^#[0-9a-f]{6}$/i.test(theme[name])) &&
    typeof theme.font === "string" && theme.font.length > 0 && theme.font.length <= 200 && /^[a-z0-9 ,.'"_-]+$/i.test(theme.font) &&
    typeof theme.fontSize === "string" && /^(?:[1-9]|[1-9][0-9])(?:\.[0-9]+)?px$/.test(theme.fontSize);
}
export function frameOutput(value: unknown): value is FrameOutput {
  if (!record(value)) return false;
  return (keys(value, ["type", "height"]) && value.type === "height" && typeof value.height === "number" &&
    Number.isFinite(value.height) && value.height >= 1 && value.height <= maxFrameHeight) ||
    (keys(value, ["type", "message"]) && value.type === "error" && value.message === frameFailure);
}
/** Opaque origin strings all say `null`; identity, not origin, is the gate. */
export function fromFrame(event: { source: unknown; data: unknown }, child: unknown): FrameOutput | undefined {
  return child != null && event.source === child && frameOutput(event.data) ? event.data : undefined;
}
/** Invalid or unrelated messages do not consume the one permitted input. */
export function firstFrameInput(parent: unknown, draw: (input: FrameInput) => void) {
  let received = false;
  return (event: { source: unknown; data: unknown }) => {
    if (received || parent == null || event.source !== parent || !frameInput(event.data)) return;
    received = true;
    draw(event.data);
  };
}
