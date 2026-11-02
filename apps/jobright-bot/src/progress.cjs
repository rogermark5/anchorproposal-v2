const fs = require('node:fs/promises');

// Write receipts immediately; advance the cursor only after the server accepts a complete scan.
class ProgressStore {
  constructor(file) { this.file = file; this.runId = null; this.ids = new Set(); this.checkpoint = null; this.writes = Promise.resolve(); }
  async load(runId, checkpoint = null) {
    if (this.runId === runId) {
      if (checkpoint && (!this.checkpoint || Date.parse(checkpoint.publishedAt) > Date.parse(this.checkpoint.publishedAt))) this.checkpoint = checkpoint;
      return;
    }
    await this.writes;
    this.runId = runId; this.ids = new Set(); this.checkpoint = checkpoint;
    try {
      const saved = JSON.parse(await fs.readFile(this.file, 'utf8'));
      if (saved.runId === runId) {
        this.ids = new Set(Array.isArray(saved.ids) ? saved.ids.filter(id => typeof id === 'string').slice(-20000) : []);
        // The server is authoritative after a crash or a change of watch.
      }
    } catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
  }
  async record(id, runId = this.runId) {
    if (runId !== this.runId) return;
    this.ids.add(id); while (this.ids.size > 20000) this.ids.delete(this.ids.values().next().value);
    await this.save();
  }
  async advance(checkpoint, runId = this.runId) {
    if (runId !== this.runId || !checkpoint) return;
    this.checkpoint = checkpoint; await this.save();
  }
  async save() {
    const text = JSON.stringify({ runId: this.runId, ids: [...this.ids], checkpoint: this.checkpoint });
    const write = this.writes.then(async () => {
      await fs.writeFile(this.file + '.new', text, { mode: 0o600 }); await fs.rename(this.file + '.new', this.file);
    });
    this.writes = write.catch(() => {}); await write;
  }
}
module.exports = { ProgressStore };
