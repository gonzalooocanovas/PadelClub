// Quick match: players queue up and are put in a doubles match as soon as four are waiting. Nobody waits long: after
// WAIT_MS the people in the queue play together with bots filling the empty seats.

export const WAIT_MS = 10_000;

export class QuickQueue {
  /** @param rooms RoomManager  @param now () => ms (injectable for tests) */
  constructor(rooms, now = Date.now) {
    this.rooms = rooms;
    this.now = now;
    this.list = []; // {token, name, ws, look, at}
  }

  has(token) { return this.list.some((e) => e.token === token); }
  size() { return this.list.length; }

  add(client) {
    if (this.has(client.token)) return this.list.findIndex((e) => e.token === client.token) + 1;
    this.rooms.leave(client.token); // a quick match replaces whatever lobby you were in
    this.list.push({ ...client, at: this.now() });
    return this.list.length;
  }

  remove(token) {
    const n = this.list.length;
    this.list = this.list.filter((e) => e.token !== token);
    return this.list.length !== n;
  }

  /** Seconds the player has waited and seconds until bots fill the match. */
  status(token) {
    const e = this.list.find((x) => x.token === token);
    if (!e) return null;
    const waited = (this.now() - e.at) / 1000;
    return { waited: Math.floor(waited), botsIn: Math.max(0, Math.ceil(WAIT_MS / 1000 - waited)), waiting: this.list.length };
  }

  /** Form matches. Returns the rooms created. */
  tick() {
    this.list = this.list.filter((e) => e.ws && e.ws.readyState === 1);
    const made = [];
    while (this.list.length >= 4) made.push(this.make(this.list.splice(0, 4)));
    if (this.list.length && this.now() - this.list[0].at >= WAIT_MS) made.push(this.make(this.list.splice(0, this.list.length)));
    return made;
  }

  make(players) {
    const [first, ...rest] = players;
    const { room } = this.rooms.create(first);
    room.settings = { ...room.settings, mode: 'doubles', fillBots: true, public: false, difficulty: 'normal' };
    for (const p of rest) {
      const m = room.addMember(p);
      this.rooms.byToken.set(p.token, { room, id: m.id });
    }
    room.beginMatch();
    return room;
  }
}
