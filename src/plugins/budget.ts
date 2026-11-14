import { createContext } from "react";

/**
 * How much the blocks in one message may build between them. Each block
 * claims what it built under its own name, so drawing it again replaces its
 * claim instead of adding to it, and gives its claim back when it goes. A
 * claim that would take the message past its limit is refused, and that
 * block is shown as written.
 */
export class Budget {
  private claims = new Map<object, number>();
  private total = 0;

  constructor(readonly limit: number) {}

  claim(owner: object, amount: number): boolean {
    const others = this.total - (this.claims.get(owner) ?? 0);
    if (others + amount > this.limit) return false;
    this.claims.set(owner, amount);
    this.total = others + amount;
    return true;
  }

  release(owner: object) {
    this.total -= this.claims.get(owner) ?? 0;
    this.claims.delete(owner);
  }
}

/** The budget of the message being drawn, if it has one. */
export const MessageBudget = createContext<Budget | null>(null);
