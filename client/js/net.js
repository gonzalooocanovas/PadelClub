// WebSocket client with automatic reconnect. Guest identity = a random token kept in localStorage;
// presenting it again after a drop returns the player to their seat.

const store = {
  get(k, d = null) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
};
export { store };

export class Net {
  constructor() {
    this.handlers = new Map();
    this.status = 'connecting';
    this.rtt = 0;
    this.attempt = 0;
    this.token = store.get('padel.token');
    this.name = store.get('padel.name', '');
    try { this.look = JSON.parse(store.get('padel.look', 'null')); } catch { this.look = null; }
    this.ws = null;
    this.closedByUs = false;
  }

  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, []);
    this.handlers.get(type).push(fn);
  }

  emit(type, data) { for (const fn of this.handlers.get(type) || []) fn(data); }

  setStatus(s) { if (this.status !== s) { this.status = s; this.emit('status', s); } }

  connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.setStatus(this.attempt > 0 ? 'reconnecting' : 'connecting');
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      this.attempt = 0;
      this.send({ t: 'hello', token: this.token, name: this.name || undefined, look: this.look || undefined });
    };
    ws.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.t === 'welcome') {
        this.token = m.token;
        this.name = m.name;
        store.set('padel.token', m.token);
        store.set('padel.name', m.name);
        this.setStatus('online');
        this.startPing();
      } else if (m.t === 'pong') {
        this.rtt = Math.round(performance.now() - m.ts);
      }
      this.emit(m.t, m);
    };
    ws.onclose = () => {
      this.stopPing();
      if (this.ws !== ws) return;
      this.setStatus('reconnecting');
      const delay = Math.min(5000, 400 * 2 ** this.attempt++);
      setTimeout(() => this.connect(), delay);
      this.emit('disconnected');
    };
    ws.onerror = () => {};
  }

  startPing() {
    this.stopPing();
    const ping = () => this.send({ t: 'ping', ts: performance.now(), rtt: this.rtt });
    ping();
    this.pingTimer = setInterval(ping, 2000);
  }

  stopPing() { clearInterval(this.pingTimer); }

  get online() { return this.ws && this.ws.readyState === 1; }

  send(o) { if (this.online) this.ws.send(JSON.stringify(o)); }
}
