/** Minimal ModelAdapter for examples (mirrors test/runtime.test.js). */
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
