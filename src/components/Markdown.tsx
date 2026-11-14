import { Component, createContext, lazy, Suspense, useContext, useMemo, type ComponentType, type ReactNode } from "react";
import ReactMarkdown, { type Components, type ExtraProps } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import type { PluggableList } from "unified";
import { remarkFormulas } from "../data/formulaSyntax";
import { Budget, MessageBudget } from "../plugins/budget";
import { blockFor } from "../plugins/index";
import type { BlockProps } from "../plugins/types";
import styles from "./Markdown.module.css";

/** The ids of the plugins that are switched off, for everything drawn below. */
export const PluginsOff = createContext<readonly string[]>([]);

/* A block's component is loaded once, the first time any message needs it. */
const loaded = new Map<() => Promise<{ default: ComponentType<BlockProps> }>, ComponentType<BlockProps>>();

/** Longer than this, a message is shown as plain text: reading it as
    Markdown would hold up the window for too long. About fifty pages. */
const longest = 100_000;

/** More quotes or lists inside each other than this, and a message is shown
    as plain text: the reader follows each level by calling itself, and can
    run out of room. */
const deepest = 64;

/** How many elements the formulas of one message may build between them. */
const mostElements = 30_000;

/** Whether some line opens more quotes and list items than `deepest`. */
function tooDeep(text: string): boolean {
  for (const line of text.split("\n")) {
    const opening = /^(?:[ \t]*(?:>|[*+-](?=[ \t])|\d{1,9}[.)](?=[ \t])))+/.exec(line);
    if (opening && (opening[0].match(/>|[*+-]|\d{1,9}[.)]/g)?.length ?? 0) > deepest) return true;
  }
  return false;
}

/** A message's text, read as Markdown. The text may be written by an agent
    that has read anything, so nothing in it can act: raw HTML shows as text,
    a picture is never fetched, and a link shows where it goes instead of
    going there. Fenced blocks and formulas that a plugin draws are handed to
    that plugin; the rest show as they were written. A message that cannot
    be read as Markdown, however it fails, is shown as plain text. */
export function Markdown({ text }: { text: string }) {
  if (text.length > longest || tooDeep(text)) return <p className={styles.plain}>{text}</p>;
  return (
    <Unreadable key={text} text={text}>
      <Read text={text} />
    </Unreadable>
  );
}

function Read({ text }: { text: string }) {
  // Formulas are looked for only while something draws them. Otherwise a
  // dollar sign is a dollar sign.
  const formulas = blockFor("math", useContext(PluginsOff)) !== undefined;
  const budget = useMemo(() => new Budget(mostElements), []);
  return (
    <div className={styles.markdown}>
      <MessageBudget value={budget}>
        <ReactMarkdown remarkPlugins={formulas ? withFormulas : plain} components={components}>
          {text}
        </ReactMarkdown>
      </MessageBudget>
    </div>
  );
}

/** Shows a message as plain text if reading it failed: text nested deeper
    than the reader can follow overflows its stack, for one. */
class Unreadable extends Component<{ text: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? <p className={styles.plain}>{this.props.text}</p> : this.props.children;
  }
}

const plain: PluggableList = [remarkGfm];
// remark-math reads the double dollar forms; remarkFormulas the rest.
const withFormulas: PluggableList = [remarkGfm, [remarkMath, { singleDollarTextMath: false }], remarkFormulas];

type Element = NonNullable<ExtraProps["node"]>;

/** The word after a fence, which Markdown keeps as a class: "language-plot". */
function wordOf(element: Element): string | undefined {
  const names = element.properties.className;
  const name = Array.isArray(names) ? names.find((one) => String(one).startsWith("language-")) : undefined;
  return name === undefined ? undefined : String(name).slice("language-".length);
}

function textOf(element: Element): string {
  return element.children.map((child) => (child.type === "text" ? child.value : "")).join("");
}

const components: Components = {
  // A fenced block. One a plugin draws is drawn; any other is shown as code.
  pre({ node, children }) {
    const code = node?.children[0];
    if (code?.type === "element" && code.tagName === "code") {
      const word = wordOf(code);
      // A fence's text ends with the line break before its closing fence.
      if (word) return <Drawn word={word} source={textOf(code).replace(/\n$/, "")} inline={false} />;
    }
    return <pre className={styles.block}>{children}</pre>;
  },
  // Code inside a line, which is also how a formula inside a line arrives.
  code({ node, children }) {
    if (node && wordOf(node) === "math") return <Drawn word="math" source={textOf(node)} inline />;
    return <code className={styles.code}>{children}</code>;
  },
  // Never a link that goes somewhere: the window has nowhere else to go, and
  // text that hides its address is how a person is sent to the wrong place.
  a({ href, children }) {
    return (
      <span className={styles.link}>
        {children}
        {href && textual(children) !== href && <span className={styles.address}> ({href})</span>}
      </span>
    );
  },
  // Never fetched: a picture's address can carry what an agent was tricked
  // into putting in it.
  img({ alt }) {
    return <span className={styles.address}>[picture{alt ? `: ${alt}` : ""}]</span>;
  },
  // Lists get a class, so that the message's list style does not reach into
  // a list a plugin draws, such as a plot's legend.
  ul({ children }) {
    return <ul className={styles.list}>{children}</ul>;
  },
  ol({ children, start }) {
    return (
      <ol className={styles.list} start={start}>
        {children}
      </ol>
    );
  },
  table({ children }) {
    return (
      <div className={styles.wide}>
        <table>{children}</table>
      </div>
    );
  },
};

function textual(children: ReactNode): string {
  return typeof children === "string" ? children : "";
}

/** A block handed to whichever plugin draws its word. While that plugin is
    loading, when none does, and when it cannot draw the text, the text shows
    as it was written. */
function Drawn({ word, source, inline }: BlockProps & { word: string }) {
  const load = blockFor(word, useContext(PluginsOff));
  const written = <Written source={source} inline={inline} />;
  if (!load) return written;
  let Block = loaded.get(load);
  if (!Block) loaded.set(load, (Block = lazy(load)));
  return (
    // A new boundary for each text, so a block that failed is tried again
    // when its text changes.
    <Failed key={source} source={source} inline={inline}>
      <Suspense fallback={written}>
        <Block source={source} inline={inline} />
      </Suspense>
    </Failed>
  );
}

function Written({ source, inline }: BlockProps) {
  return inline ? <code className={styles.code}>{source}</code> : <pre className={styles.block}>{source}</pre>;
}

/** Catches a block that could not be drawn and shows its text, with the
    reason the plugin gave. */
class Failed extends Component<BlockProps & { children: ReactNode }, { why?: string }> {
  state: { why?: string } = {};

  static getDerivedStateFromError(error: unknown) {
    return { why: error instanceof Error && error.message ? error.message : "This could not be drawn." };
  }

  render() {
    const { why } = this.state;
    if (why === undefined) return this.props.children;
    const { source, inline } = this.props;
    if (inline) return <code className={styles.code} title={why}>{source}</code>;
    return (
      <>
        <pre className={styles.block}>{source}</pre>
        <span className={styles.why}>{why}</span>
      </>
    );
  }
}
