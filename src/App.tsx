import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import styles from "./App.module.css";
import { Button } from "./components/Button";
import { Sidebar } from "./components/Sidebar";
import { canPin, cleanName, loadAgents, saveAgents, type Agent } from "./data/agents";
import { userMessage, type Conversations } from "./data/conversation";
import { loadName, saveName } from "./data/profile";
import { applyTheme, loadTheme, saveTheme } from "./theme/theme";
import { AgentEditor } from "./views/AgentEditor";
import { AgentPanel } from "./views/AgentPanel";
import { Conversation } from "./views/Conversation";
import { Settings } from "./views/Settings";

export function App() {
  const [theme, setTheme] = useState(loadTheme);
  // What the user typed for their own name, and what stands in while that is empty.
  const [name, setName] = useState(loadName);
  const [deviceName, setDeviceName] = useState("");
  const [agents, setAgents] = useState(loadAgents);
  const [unsaved, setUnsaved] = useState(false);
  const [selectedId, setSelectedId] = useState<string>();
  // Kept in memory only: nothing answers yet, and where conversations are
  // stored is a decision for when something does.
  const [conversations, setConversations] = useState<Conversations>({});
  // The agent being edited, "new" for one being made, or null.
  const [editing, setEditing] = useState<Agent | "new" | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);

  useEffect(() => {
    applyTheme(theme);
    saveTheme(theme);
  }, [theme]);

  useEffect(() => {
    setUnsaved(!saveAgents(agents));
  }, [agents]);

  useEffect(() => saveName(name), [name]);

  useEffect(() => {
    // Without an answer the fallback below stays, so a failure needs no handling.
    invoke<string>("device_name").then(setDeviceName, () => {});
  }, []);

  const defaultName = cleanName(deviceName) || "This computer";

  const selected = agents.find((agent) => agent.id === selectedId) ?? agents[0];

  function save(agent: Agent) {
    const known = agents.some((other) => other.id === agent.id);
    setAgents(known ? agents.map((other) => (other.id === agent.id ? agent : other)) : [...agents, agent]);
    setSelectedId(agent.id);
    setEditing(null);
  }

  function remove(agent: Agent) {
    setAgents(agents.filter((other) => other.id !== agent.id));
    setConversations(({ [agent.id]: _gone, ...rest }) => rest);
    setEditing(null);
  }

  return (
    <div className={styles.frame}>
      <Sidebar
        agents={agents}
        conversations={conversations}
        selected={selected}
        userName={cleanName(name) || defaultName}
        unsaved={unsaved}
        onSelect={(agent) => setSelectedId(agent.id)}
        onCreate={() => setEditing("new")}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <main className={styles.main}>
        <div className={styles.panel}>
          {selected ? (
            <Conversation
              agent={selected}
              agents={agents}
              messages={conversations[selected.id] ?? []}
              canPin={selected.pinned || canPin(agents)}
              panelOpen={panelOpen}
              onTogglePanel={() => setPanelOpen(!panelOpen)}
              onSend={(text) =>
                setConversations((all) => ({
                  ...all,
                  [selected.id]: [...(all[selected.id] ?? []), userMessage(text)],
                }))
              }
              onTogglePin={() => save({ ...selected, pinned: !selected.pinned })}
              onEdit={() => setEditing(selected)}
            />
          ) : (
            <div className={styles.empty}>
              <h1 className={styles.title}>No agents yet</h1>
              <p className={styles.hint}>Make one, give it a name and a picture, and it lives here.</p>
              <Button primary onClick={() => setEditing("new")}>
                New agent
              </Button>
            </div>
          )}
        </div>
      </main>
      {selected && panelOpen && (
        <AgentPanel agent={selected} onClose={() => setPanelOpen(false)} />
      )}
      {editing && (
        <AgentEditor
          agent={editing === "new" ? undefined : editing}
          onSave={save}
          onDelete={remove}
          onClose={() => setEditing(null)}
        />
      )}
      {settingsOpen && (
        <Settings
          name={name}
          defaultName={defaultName}
          onNameChange={setName}
          theme={theme}
          onThemeChange={setTheme}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}
