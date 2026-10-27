import test from 'node:test';
import assert from 'node:assert/strict';
import { STORY, sceneFor } from '../shared/story.js';
import { EVENTS } from '../shared/career2.js';
import { ROSTER_BY_ID } from '../shared/roster.js';

test('every career event has an intro and an ending, spoken by a real character', () => {
  for (const e of EVENTS) {
    for (const k of ['intro', 'champion', 'other']) {
      const s = sceneFor(e.id, k);
      assert.ok(s && s.text.length > 20, `${e.id} ${k}`);
      assert.ok(s.who === 'narrator' || ROSTER_BY_ID[s.who], `${e.id} speaker ${s.who}`);
    }
  }
  assert.equal(Object.keys(STORY).length, EVENTS.length);
});
