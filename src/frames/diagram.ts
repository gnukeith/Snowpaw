import mermaid from "mermaid";
import { firstFrameInput, frameFailure, maxFrameHeight, maxFrameText } from "../components/frameMessages";
import "./diagram.css";

window.addEventListener("message", firstFrameInput(window.parent, async ({ source, theme }) => {
  try {
    const root = document.getElementById("diagram")!;
    for (const [name, value] of Object.entries(theme)) document.documentElement.style.setProperty(`--${name}`, value);
    mermaid.initialize({
      securityLevel: "strict",
      startOnLoad: false,
      maxTextSize: maxFrameText,
      maxEdges: 100,
      suppressErrorRendering: true,
      htmlLabels: false,
      theme: "base",
      fontFamily: theme.font,
      // Diagram frontmatter and init directives cannot relax the policy or
      // replace the app's theme. Mermaid applies secure keys recursively.
      secure: ["secure", "securityLevel", "startOnLoad", "maxTextSize", "maxEdges", "suppressErrorRendering", "htmlLabels", "theme", "themeVariables", "themeCSS", "fontFamily", "altFontFamily", "dompurifyConfig"],
      themeVariables: {
        background: theme.background,
        fontFamily: theme.font, fontSize: theme.fontSize,
        primaryColor: theme.surface, primaryTextColor: theme.text, primaryBorderColor: theme.accent,
        secondaryColor: theme.background, secondaryTextColor: theme.text, secondaryBorderColor: theme.border,
        tertiaryColor: theme.surface, tertiaryTextColor: theme.text, tertiaryBorderColor: theme.border,
        lineColor: theme.muted, textColor: theme.text,
        mainBkg: theme.surface, nodeBorder: theme.accent, edgeLabelBackground: theme.background,
        clusterBkg: theme.background, clusterBorder: theme.border,
        titleColor: theme.text, actorBkg: theme.surface, actorTextColor: theme.text,
        actorBorder: theme.accent, actorLineColor: theme.muted, signalColor: theme.text, signalTextColor: theme.text,
        labelBoxBkgColor: theme.surface, labelBoxBorderColor: theme.border, labelTextColor: theme.text,
        loopTextColor: theme.text, noteBkgColor: theme.surface, noteTextColor: theme.text, noteBorderColor: theme.border,
      },
    });
    const { svg } = await mermaid.render("drawing", source);
    // This is the only document that receives renderer HTML. Nothing leaves
    // it except its size; bindFunctions is deliberately never called.
    root.innerHTML = svg;
    const measure = () => window.parent.postMessage({ type: "height", height: Math.min(maxFrameHeight, Math.max(1, Math.ceil(root.getBoundingClientRect().height))) }, "*");
    new ResizeObserver(measure).observe(root);
    measure();
  } catch {
    document.getElementById("diagram")?.replaceChildren();
    window.parent.postMessage({ type: "error", message: frameFailure }, "*");
  }
}));
