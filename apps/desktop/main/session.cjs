const fs = require('node:fs/promises');
const path = require('node:path');
const { serverUrl } = require('./security.cjs');
let http;
try { http = require('./http.cjs'); } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; http = require('../../../packages/shared/dist/http.js'); }

class DesktopSession {
  constructor({ directory, secureStorage, fetcher = fetch }) {
    this.directory = directory; this.secureStorage = secureStorage; this.fetcher = fetcher;
    this.server = ''; this.access = null; this.refresh = null; this.refreshing = null;
    this.epoch = 0; this.writes = Promise.resolve();
  }
  async load(server) {
    this.server = serverUrl(server);
    try {
      const saved = JSON.parse(await fs.readFile(path.join(this.directory, 'session.json'), 'utf8'));
      if (saved.server !== this.server || !this.secureStorage.isEncryptionAvailable()) return;
      this.refresh = this.secureStorage.decryptString(Buffer.from(saved.encrypted, 'base64'));
    } catch { /* First launch, another Windows account, or an invalidated credential. */ }
  }
  async saveTokens(tokens, epoch = this.epoch) {
    if (!tokens?.accessToken || !tokens?.refreshToken) throw new Error('The server returned an invalid session.');
    if (!this.secureStorage.isEncryptionAvailable()) throw new Error('Windows credential encryption is unavailable. Sign-in cannot be stored securely.');
    const encrypted = this.secureStorage.encryptString(tokens.refreshToken).toString('base64');
    const write = this.writes.catch(() => {}).then(async () => {
      if (epoch !== this.epoch) throw new Error('Your session changed. Please sign in again.');
      await fs.mkdir(this.directory, { recursive: true });
      const temp = path.join(this.directory, 'session.json.tmp');
      await fs.writeFile(temp, JSON.stringify({ server: this.server, encrypted }), { mode: 0o600 });
      await fs.rename(temp, path.join(this.directory, 'session.json'));
      if (epoch !== this.epoch) throw new Error('Your session changed. Please sign in again.');
      this.access = tokens.accessToken; this.refresh = tokens.refreshToken;
    });
    this.writes = write; return write;
  }
  async clear() {
    this.epoch++; this.access = null; this.refresh = null;
    const clear = this.writes.catch(() => {}).then(() => fs.rm(path.join(this.directory, 'session.json'), { force: true }));
    this.writes = clear; await clear;
  }
  async raw(route, options = {}) {
    if (!this.server) throw new Error('Enter your hosted API server URL in Server connection first.');
    let body; try { body = JSON.parse(options.body); } catch {}
    return http.fetchWithRecovery(this.server + route, { ...options, redirect: 'error', headers: { ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), 'ngrok-skip-browser-warning': 'true', ...options.headers } }, { fetcher: this.fetcher, timeoutMs: /\/export$|\/edits$|\/draft-preview$|\/answers(?:\/prompt)?$/.test(route) ? 240000 : 30000, idempotent: options.method === 'POST' && (!!body?.idempotencyKey || /\/cancel$/.test(route)) });
  }
  async parse(response) {
    return http.responseJson(response);
  }
  async authenticate(route, data) {
    const epoch = this.epoch;
    const body = await this.parse(await this.raw(route, { method: 'POST', body: JSON.stringify(data) }));
    if (epoch !== this.epoch) throw new Error('Your session changed. Please sign in again.');
    if (body.accessToken) await this.saveTokens(body, epoch);
    return body.accessToken ? body.user : body;
  }
  async renew() {
    if (this.refreshing) return this.refreshing;
    const token = this.refresh;
    const epoch = this.epoch;
    if (!token) throw new Error('Please sign in to continue.');
    this.refreshing = (async () => {
      const response = await this.raw('/auth/refresh', { method: 'POST', body: JSON.stringify({ refreshToken: token }) });
      if (this.refresh !== token) throw new Error('Your session changed. Please try again.');
      if (response.status === 401 || response.status === 403) { await this.clear(); throw new Error('Your session expired. Please sign in again.'); }
      const tokens = await this.parse(response);
      if (this.refresh === token) await this.saveTokens(tokens, epoch);
    })().finally(() => { this.refreshing = null; });
    return this.refreshing;
  }
  async request(route, options = {}) {
    if (!this.access) await this.renew();
    const usedAccess = this.access;
    let response = await this.raw(route, { ...options, headers: { ...options.headers, Authorization: `Bearer ${this.access}` } });
    if (response.status === 401) {
      if (usedAccess === this.access) await this.renew();
      if (!this.access) throw new Error('Please sign in to continue.');
      response = await this.raw(route, { ...options, headers: { ...options.headers, Authorization: `Bearer ${this.access}` } });
    }
    return options.binary ? response : this.parse(response);
  }
}
module.exports = { DesktopSession };
