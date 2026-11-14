import type { ComponentType } from "react";

/** What a block is given to draw. */
export interface BlockProps {
  /** The text between the fences, or between the math marks, as it was written. */
  source: string;
  /** True for math written inside a line of text. False for a block of its own. */
  inline: boolean;
}

/** Draws one block. If the text cannot be drawn it throws an `Error` whose
    message is a plain sentence saying why: the conversation then shows the
    text as it was written, with that sentence under it. */
export type Block = ComponentType<BlockProps>;

/**
 * A part of Snowpaw that can be switched off. The ones Snowpaw ships with are
 * listed in index.ts.
 *
 * A plugin draws nothing by default and costs nothing until it is needed:
 * each block is loaded the first time a message asks for it.
 */
export interface Plugin {
  id: string;
  name: string;
  /** One sentence for the list in Settings. */
  about: string;
  /** The blocks it draws, by the word written after the opening fence. */
  blocks: Record<string, () => Promise<{ default: Block }>>;
}
