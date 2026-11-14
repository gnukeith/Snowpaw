import { invoke } from "@tauri-apps/api/core";
import { useEffect, useId, useRef, useState } from "react";
import styles from "./App.module.css";
import { Button } from "./components/Button";
import { Empty } from "./components/Empty";
import { PanelResizer } from "./components/PanelResizer";
import { Sidebar } from "./components/Sidebar";
import { useWindowDrag, WindowButtons, WindowFrame } from "./components/WindowButtons";
import {
  canPin,
  cleanName,
  loadAgents,
  parseAgents,
  saveAgents,
  type Agent,
} from "./data/agents";
import { ask, connectionFor, describeReplyFailure, turnsOf, whyNoConnection, type Reply } from "./data/chat";
import {
  acceptProposal,
  endReply,
  pendingReply,
  userMessage,
  workOf,
  writeReply,
  type AllWork,
  type Message,
  type TaskDraft,
  type Work,
} from "./data/conversation";
import { PluginsOff } from "./components/Markdown";
import { loadConnections, saveConnections } from "./data/connections";
import { parseButtonLayout, type ButtonLayout } from "./data/frame";
import {
  loadName,
  loadPanelWidth,
  loadPicture,
  loadSetupDone,
  saveName,
  savePanelWidth,
  savePicture,
  saveSetupDone,
} from "./data/profile";
import { loadOff, saveOff } from "./plugins/index";
import { applyTheme, loadTheme, saveTheme, tintWindow } from "./theme/theme";
import { AgentEditor } from "./views/AgentEditor";
import { AgentPanel } from "./views/AgentPanel";
import { Conversation } from "./views/Conversation";
import { Settings } from "./views/Settings";
import { Setup } from "./views/Setup";
import { TaskEditor } from "./views/TaskEditor";

export function App() {
  const [theme, setTheme] = useState(loadTheme);
  // What the user typed for their own name, and what stands in while that is empty.
  const [name, setName] = useState(loadName);
  const [picture, setPicture] = useState(loadPicture);
  const [deviceName, setDeviceName] = useState("");
  const [agents, setAgents] = useState(loadAgents);
  // What could not be written to storage, by what it is. Each is written
  // only when it changes, and each keeps its own failure, so one writing
  // well does not hide another that did not.
  const [unsaved, setUnsaved] = useState<Record<string, boolean>>({});
  const [selectedId, setSelectedId] = useState<string>();
  // Kept in memory only: where an agent's work is stored is not decided yet.
  const [work, setWork] = useState<AllWork>({});
  // The reply each agent's model is writing, by agent: one at a time each.
  const replies = useRef(new Map<string, Reply>());
  // The agent being edited, "new" for one being made, or null.
  const [editing, setEditing] = useState<Agent | "new" | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [connections, setConnections] = useState(loadConnections);
  // The plugins that are switched off, by id.
  const [pluginsOff, setPluginsOff] = useState(loadOff);
  // The first-run steps: open until they are finished or skipped, once.
  const [setupOpen, setSetupOpen] = useState(() => !loadSetupDone());
  // The proposed task being changed before it is agreed to, and whose it is.
  const [proposing, setProposing] = useState<{ agentId: string; message: Message }>();
  const [panelOpen, setPanelOpen] = useState(false);
  // How wide the user dragged the agent's panel. Undefined: as it comes.
  const [panelWidth, setPanelWidth] = useState(loadPanelWidth);
  const side = useRef<HTMLElement>(null);
  const panelId = useId();
  // The window buttons to draw. None until the Rust side says the window has
  // no title bar, and none ever where it kept one.
  const [buttons, setButtons] = useState<ButtonLayout>();

  useEffect(() => {
    applyTheme(theme);
    saveTheme(theme);
    tintWindow();
    // "System" changes colour when the desktop does, with nothing set here.
    const desktop = matchMedia("(prefers-color-scheme: dark)");
    desktop.addEventListener("change", tintWindow);
    return () => desktop.removeEventListener("change", tintWindow);
  }, [theme]);

  /** Records whether a part could be written, changing nothing if that is
      what was already recorded. */
  function wrote(part: string, ok: boolean) {
    setUnsaved((now) => (Boolean(now[part]) === !ok ? now : { ...now, [part]: !ok }));
  }

  useEffect(() => wrote("agents", saveAgents(agents)), [agents]);
  useEffect(() => wrote("picture", savePicture(picture)), [picture]);
  useEffect(() => wrote("connections", saveConnections(connections)), [connections]);

  useEffect(() => saveName(name), [name]);

  useEffect(() => saveOff(pluginsOff), [pluginsOff]);

  useEffect(() => {
    // On the root element, where the tokens that follow from it are worked out.
    const root = document.documentElement.style;
    if (panelWidth === undefined) root.removeProperty("--panel-width");
    else root.setProperty("--panel-width", `${panelWidth}px`);
    savePanelWidth(panelWidth);
  }, [panelWidth]);

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

  function togglePin(agent: Agent) {
    if (!agent.pinned && !canPin(agents)) return;
    setAgents(agents.map((other) => (other.id === agent.id ? { ...agent, pinned: !agent.pinned } : other)));
  }

  function schedule(agentId: string, message: Message, task: TaskDraft) {
    setWork((all) => ({ ...all, [agentId]: acceptProposal(workOf(all, agentId), message.id, task) }));
    setProposing(undefined);
  }

  /** Changes one agent's work, if the agent still has any: what arrives for
      an agent that has been deleted is dropped. */
  function change(agentId: string, to: (work: Work) => Work) {
    setWork((all) => (Object.hasOwn(all, agentId) ? { ...all, [agentId]: to(all[agentId]) } : all));
  }

  /** Adds what the user wrote to an agent's conversation and asks the
      agent's model to answer it. */
  function send(agent: Agent, text: string) {
    if (replies.current.has(agent.id)) return;
    const said = userMessage(text);
    const reply = pendingReply(agent.id);
    const messages = [...workOf(work, agent.id).messages, said];
    setWork((all) => {
      const mine = workOf(all, agent.id);
      return { ...all, [agent.id]: { ...mine, messages: [...mine.messages, said, reply] } };
    });
    const connection = connectionFor(agent, connections);
    if (!connection) {
      change(agent.id, (mine) => endReply(mine, reply.id, whyNoConnection(agent, connections)));
      return;
    }
    // From here on this agent is this connection's: were it the only one and
    // later replaced by another, the conversation would not follow unasked.
    if (!agent.connection) {
      setAgents((all) =>
        all.map((other) => (other.id === agent.id ? { ...other, connection: connection.id } : other)),
      );
    }
    const writing = ask(connection, turnsOf(messages, agent.id), (answer, thinking) =>
      change(agent.id, (mine) => writeReply(mine, reply.id, answer, thinking)),
    );
    replies.current.set(agent.id, writing);
    writing.done
      .then(() => undefined, describeReplyFailure)
      .then((failure) => {
        replies.current.delete(agent.id);
        change(agent.id, (mine) => endReply(mine, reply.id, failure));
      });
  }

  function remove(agent: Agent) {
    replies.current.get(agent.id)?.stop();
    setAgents(agents.filter((other) => other.id !== agent.id));
    setWork(({ [agent.id]: _gone, ...rest }) => rest);
    setEditing(null);
  }

  const user = { name: cleanName(name) || defaultName, picture };

  // The buttons on the far side belong in the window's far corner, which is
  // the agent's panel while that is open and the conversation otherwise.
  const farButtons = <WindowButtons buttons={buttons?.end ?? []} />;

  return (
    <PluginsOff value={pluginsOff}>
      <div className={styles.frame}>
        <Sidebar
          agents={agents}
          work={work}
          selected={selected}
          user={user}
          unsaved={Object.values(unsaved).some(Boolean)}
          windowButtons={buttons?.start.length ? <WindowButtons buttons={buttons.start} /> : null}
          canPin={canPin(agents)}
          onTogglePin={togglePin}
          onEdit={setEditing}
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
                user={user}
                messages={workOf(work, selected.id).messages}
                canPin={selected.pinned || canPin(agents)}
                panelOpen={panelOpen}
                windowButtons={!panelOpen && farButtons}
                onTogglePanel={() => setPanelOpen(!panelOpen)}
                onSend={(text) => send(selected, text)}
                onStop={() => replies.current.get(selected.id)?.stop()}
                onSchedule={(message) =>
                  message.proposal && schedule(selected.id, message, message.proposal.task)
                }
                onEditProposal={(message) => setProposing({ agentId: selected.id, message })}
                onTogglePin={() => togglePin(selected)}
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
          {selected && panelOpen && (
            <PanelResizer
              panel={side}
              controls={panelId}
              label={`Width of what ${selected.name} is doing`}
              onResize={(width) => setPanelWidth(width === undefined ? undefined : Math.max(0, width))}
            />
          )}
        </main>
        {selected && panelOpen && (
          <AgentPanel
            ref={side}
            id={panelId}
            agent={selected}
            work={workOf(work, selected.id)}
            windowButtons={farButtons}
            onClose={() => setPanelOpen(false)}
          />
        )}
        {/* Dialogs cover the window's buttons, so they draw their own. */}
        <WindowFrame value={buttons}>
          {editing && (
            <AgentEditor
              agent={editing === "new" ? undefined : editing}
              connections={connections}
              onSave={save}
              onDelete={remove}
              onClose={() => setEditing(null)}
            />
          )}
          {proposing?.message.proposal && (
            <TaskEditor
              task={proposing.message.proposal.task}
              onSchedule={(task) => schedule(proposing.agentId, proposing.message, task)}
              onClose={() => setProposing(undefined)}
            />
          )}
          {settingsOpen && (
            <Settings
              name={name}
              defaultName={defaultName}
              onNameChange={setName}
              picture={picture}
              onPictureChange={setPicture}
              theme={theme}
              onThemeChange={setTheme}
              connections={connections}
              onConnectionsChange={setConnections}
              pluginsOff={pluginsOff}
              onPluginsOffChange={setPluginsOff}
              onSetup={() => {
                setSettingsOpen(false);
                setSetupOpen(true);
              }}
              developer={developer}
              onClose={() => setSettingsOpen(false)}
            />
          )}
          {setupOpen && (
            <Setup
              name={name}
              defaultName={defaultName}
              onNameChange={setName}
              picture={picture}
              onPictureChange={setPicture}
              theme={theme}
              onThemeChange={setTheme}
              connections={connections}
              onConnectionsChange={setConnections}
              onDone={(makeAgent) => {
                wrote("setup", saveSetupDone());
                setSetupOpen(false);
                if (makeAgent) setEditing("new");
              }}
            />
          )}
        </WindowFrame>
      </div>
    </PluginsOff>
  );
}
