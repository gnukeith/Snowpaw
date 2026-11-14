import { useEffect, useState } from "react";
import styles from "./App.module.css";
import { Sidebar } from "./components/Sidebar";
import { applyTheme, loadTheme, saveTheme } from "./theme/theme";
import { Computer } from "./views/Computer";
import { Conversations } from "./views/Conversations";
import { Settings } from "./views/Settings";

export type View = "conversations" | "computer" | "settings";

export function App() {
  const [view, setView] = useState<View>("conversations");
  const [theme, setTheme] = useState(loadTheme);

  useEffect(() => {
    applyTheme(theme);
    saveTheme(theme);
  }, [theme]);

  return (
    <div className={styles.frame}>
      <Sidebar view={view} onNavigate={setView} />
      <main className={styles.panel}>
        {view === "conversations" && <Conversations />}
        {view === "computer" && <Computer />}
        {view === "settings" && <Settings theme={theme} onThemeChange={setTheme} />}
      </main>
    </div>
  );
}
