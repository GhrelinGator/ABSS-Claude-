// The seam between agents' minds and the way signals carry content
// (docs/DESIGN.md §0.4 and §6.6). Everything above this interface has to work
// unchanged when the Floor 1 implementation is replaced by a learned one.
//
// Phase 0 fixes only the shape of the seam. The placeholder types below get
// their fields in Phase 5.1, after the encode and decode design has been
// written into docs/DESIGN.md §6.

/** Most tokens one message can hold (K in docs/DESIGN.md §0.4). Provisional. */
export const MESSAGE_CAPACITY = 4;

/** An unordered bag of token ids. Only the first `count` entries are meaningful. */
export interface Message {
  readonly tokens: Uint32Array;
  readonly count: number;
}

/** The agent at one end of an exchange. */
export interface AgentView {
  readonly slot: number;
  readonly id: number;
}

/** What the speaker is trying to get across. Fields arrive in Phase 5.1. */
export interface SignalIntent {
  readonly kind: number;
}

/** What the listener can perceive while the message arrives. Fields arrive in Phase 5.1. */
export interface PerceptualContext {
  readonly tick: number;
}

/** One change to the listener's model of its surroundings. Fields arrive in Phase 5.1. */
export interface BeliefUpdate {
  readonly kind: number;
}

export interface SignalLayer {
  encode(speaker: AgentView, intent: SignalIntent): Message;
  decode(listener: AgentView, message: Message, context: PerceptualContext): BeliefUpdate[];
}
