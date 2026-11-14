import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import styles from "./App.module.css";
import { Button } from "./components/Button";
import { Empty } from "./components/Empty";
import { Sidebar } from "./components/Sidebar";
import { useWindowDrag, WindowButtons } from "./components/WindowButtons";
import {
  canPin,
  cleanName,
  loadAgents,
  parseAgents,
  saveAgents,
  type Agent,
} from "./data/agents";
import { userMessage, workOf, type AllWork } from "./data/conversation";
import { parseButtonLayout, type ButtonLayout } from "./data/frame";
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
  // Kept in memory only: nothing answers yet, and where an agent's work is
  // stored is a decision for when something does.
  const [work, setWork] = useState<AllWork>({});
  // The agent being edited, "new" for one being made, or null.
  const [editing, setEditing] = useState<Agent | "new" | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  // The window buttons to draw. None until the Rust side says the window has
  // no title bar, and none ever where it kept one.
  const [buttons, setButtons] = useState<ButtonLayout>();

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

  useEffect(() => {
    invoke<string | null>("window_buttons").then(
      (layout) => layout !== null && setButtons(parseButtonLayout(layout)),
      () => {},
    );
  }, []);

  useWindowDrag(buttons !== undefined);

  const defaultName = cleanName(deviceName) || "This computer";

  // Sample agents with work to show, for looking at the app while it is being
  // built. Development builds only: a release build drops this and the sample.
  const developer = import.meta.env.DEV
    ? {
        async load() {
          const { isSample, sample } = await import("./dev/sample");
          const { agents: sampleAgents, work: sampleWork } = sample();
          // Read as if from storage, which releases any pins beyond the limit:
          // the user's own pins come first, so it is the sample's that go.
          setAgents((all) =>
            parseAgents([...all.filter((agent) => !isSample(agent)), ...sampleAgents]),
          );
          setWork((all) => ({ ...all, ...sampleWork }));
          setSelectedId(sampleAgents[0].id);
        },
        async remove() {
          const { isSample } = await import("./dev/sample");
          setAgents((all) => all.filter((agent) => !isSample(agent)));
        },
      }
    : undefined;

  const selected = agents.find((agent) => agent.id === selectedId) ?? agents[0];

  function save(agent: Agent) {
    const known = agents.some((other) => other.id === agent.id);
    setAgents(known ? agents.map((other) => (other.id === agent.id ? agent : other)) : [...agents, agent]);
    setSelectedId(agent.id);
    setEditing(null);
  }

  function remove(agent: Agent) {
    setAgents(agents.filter((other) => other.id !== agent.id));
    setWork(({ [agent.id]: _gone, ...rest }) => rest);
    setEditing(null);
  }

  // The buttons on the far side belong in the window's far corner, which is
  // the agent's panel while that is open and the conversation otherwise.
  const farButtons = <WindowButtons buttons={buttons?.end ?? []} />;

  return (
    <div className={styles.frame}>
      <Sidebar
        agents={agents}
        work={work}
        selected={selected}
        userName={cleanName(name) || defaultName}
        unsaved={unsaved}
        windowButtons={<WindowButtons buttons={buttons?.start ?? []} />}
        onSelect={(agent) => setSelectedId(agent.id)}
        onCreate={() => setEditing("new")}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <main className={styles.main}>
        <div className={styles.panel}>
          {selected ? (
            <Conversation
              // A new conversation for each agent, so a message half written
              // to one is never sent to another.
              key={selected.id}
              agent={selected}
              agents={agents}
              messages={workOf(work, selected.id).messages}
              canPin={selected.pinned || canPin(agents)}
              panelOpen={panelOpen}
              windowButtons={!panelOpen && farButtons}
              onTogglePanel={() => setPanelOpen(!panelOpen)}
              onSend={(text) =>
                setWork((all) => {
                  const mine = workOf(all, selected.id);
                  return { ...all, [selected.id]: { ...mine, messages: [...mine.messages, userMessage(text)] } };
                })
              }
              onTogglePin={() => save({ ...selected, pinned: !selected.pinned })}
              onEdit={() => setEditing(selected)}
            />
          ) : (
            <div className={styles.blank}>
              <header className={styles.bar} data-window-drag>
                {farButtons}
              </header>
              <Empty title="No agents yet" hint="Make one, give it a name and a picture, and it lives here.">
                <Button primary onClick={() => setEditing("new")}>
                  New agent
                </Button>
              </Empty>
            </div>
          )}
        </div>
      </main>
      {selected && panelOpen && (
        <AgentPanel
          agent={selected}
          work={workOf(work, selected.id)}
          windowButtons={farButtons}
          onClose={() => setPanelOpen(false)}
        />
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
          developer={developer}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}
