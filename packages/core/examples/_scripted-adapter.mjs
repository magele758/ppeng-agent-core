/** Minimal ModelAdapter for examples. Prefer `createMockLlm` from `@ppeng/agent-core` in tests. */
export class ScriptedAdapter {
  /** @param {(input: unknown) => unknown} handler */
  constructor(handler) {
    this.name = 'scripted';
    this.handler = handler;
  }

  async runTurn(input) {
    return this.handler(input);
  }

  async summarizeMessages() {
    return 'summary';
  }
}
