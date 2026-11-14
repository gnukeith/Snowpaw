import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { applyTheme, loadTheme } from "./theme/theme";
import "./theme/tokens.css";
import "./theme/base.css";

// Before the first render, so the window never flashes the wrong colours.
applyTheme(loadTheme());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
