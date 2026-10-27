// HTML for the career screens: hub, calendar, event bracket, training, development and result panels.
// Everything shown here is read from the save and the real tournament state: no placeholder numbers.
import {
  EVENTS, EVENT_BY_ID, ATTRS, ATTR_LABELS, ATTR_MAX, attrCost, calendar, rankOf, levelFor, DRILLS, OBJECTIVES,
  RESULT_LABELS, nextPlayerMatch, describeOpponents, standings, finishRewards,
} from '/shared/career2.js';
import { ROSTER_BY_ID } from '/shared/roster.js';
import { sceneFor } from '/shared/story.js';
import { BOT_LABELS } from '/shared/ai.js';
import { COURTS } from '/shared/looks.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const STYLE_NAMES = { net: 'Net player', retriever: 'Retriever', power: 'Power', allround: 'All-rounder', wild: 'Streaky attacker', counter: 'Counter-puncher' };
const stars = (n) => `<span class="stars">${'★'.repeat(n)}<i>${'★'.repeat(3 - n)}</i></span>`;
const nameOf = (id) => (id === 'you' ? 'You' : ROSTER_BY_ID[id]?.name || id);
const teamName = (ids) => ids.map(nameOf).join(' &amp; ');
const formatLabel = (e) => `${e.format === 'group' ? 'Group + final' : e.size + '-draw knockout'} · ${e.mode === 'doubles' ? 'doubles' : 'singles'}`;

const speaker = (who) => (who === 'narrator' ? 'Narrator' : ROSTER_BY_ID[who]?.name || who);
const sceneHtml = (s) => (s ? `<div class="scene"><b>${esc(speaker(s.who))}</b><p>${esc(s.text)}</p></div>` : '');

const TABS = [['hub', 'Hub'], ['calendar', 'Calendar'], ['training', 'Training'], ['development', 'Development']];

function header(save, tab) {
  return `<div class="row" style="flex-wrap:wrap;gap:10px"><h2 style="margin:0">Career</h2><span class="grow"></span>
    <button class="btn small" data-act="equipment">Equipment</button><button class="btn small ghost" data-act="careerBack">Back</button></div>
    <div class="statrow">
      <div><span class="label">Season</span><b>${save.season}</b></div>
      <div><span class="label">World rank</span><b>#${rankOf(save.points)}</b></div>
      <div><span class="label">Ranking points</span><b>${save.points}</b></div>
      <div><span class="label">Level</span><b>${levelFor(save.xp)}</b></div>
      <div><span class="label">Coins</span><b>${save.coins}</b></div>
      <div><span class="label">Dev. points</span><b>${save.devPoints}</b></div>
    </div>
    <div class="seg" style="margin:10px 0">${TABS.map(([k, l]) => `<button data-act="careerTab" data-val="${k}" class="${tab === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;
}

const wrap = (inner) => `<div class="screen"><div class="panel career">${inner}</div></div>`;

function eventCard(c, save) {
  const e = c.event;
  const status = c.done ? `<span class="tag ready">${esc(RESULT_LABELS[c.done.result] || c.done.result)}</span>` : c.active ? '<span class="tag host">In progress</span>' : c.locked ? '<span class="tag off">Locked</span>' : '<span class="tag">Open</span>';
  const btn = c.locked ? `<button class="btn" disabled>${esc(c.locked)}</button>`
    : c.active ? `<button class="btn primary" data-act="eventEnter" data-event="${e.id}">Continue</button>`
      : `<button class="btn ${c.done ? '' : 'primary'}" data-act="eventEnter" data-event="${e.id}">${c.done ? 'Play again' : 'Enter'}</button>`;
  return `<div class="stage ${c.locked ? 'locked' : ''}">
    <div class="row"><span class="label">${esc(e.tier)}</span><span class="grow"></span>${status}</div>
    <h3>${esc(e.name)}</h3><p class="mute">${esc(e.blurb)}</p>
    <div class="row" style="flex-wrap:wrap;gap:6px"><span class="tag">${esc(formatLabel(e))}</span><span class="tag">${esc(COURTS[e.court].name.split(' ').slice(0, 2).join(' '))}</span><span class="tag">${e.sets === 1 ? '1 set' : 'best of ' + e.sets} · ${e.gamesPerSet} games${e.golden ? ' · golden' : ''}</span></div>
    <p style="font-size:12px" class="mute">Up to +${e.points} ranking points · ${e.coins} coins</p>${btn}</div>`;
}

/** The upgrade list: used by the Career > Development tab and by the Upgrades button on the home screen. */
export function upgradesHtml(save) {
  return `<div class="upg"><p class="mute" style="margin-bottom:10px">You have <b style="color:var(--accent)">${save.devPoints}</b> upgrade points. Win matches against Club, Pro or Legend bots, finish career events, earn drill stars and complete objectives to get more. Upgrades work in every solo match (practice, 1v1, career, training) and never online, where everybody is equal.</p>
    ${ATTRS.map((a) => { const lv = save.attrs[a]; const cost = attrCost(lv); const can = lv < ATTR_MAX && save.devPoints >= cost; return `<div class="attr"><span class="attrname">${esc(ATTR_LABELS[a])}</span><span class="pips">${Array.from({ length: ATTR_MAX }, (_, i) => `<i class="${i < lv ? 'on' : ''}"></i>`).join('')}</span><button class="btn small" data-act="attrBuy" data-attr="${a}" ${can ? '' : 'disabled'}>${lv >= ATTR_MAX ? 'Max' : '+1 (' + cost + ')'}</button></div>`; }).join('')}</div>`;
}

export function hubHtml(save, tab) {
  const cal = calendar(save);
  let body = '';
  if (tab === 'hub') {
    const next = cal.find((c) => c.active) || cal.find((c) => !c.done && !c.locked);
    const nextCard = next
      ? `<div class="label">${next.active ? 'Event in progress' : 'Next event'}</div><div class="stagegrid">${eventCard(next, save)}</div>`
      : '<p class="mute">You have played every event on the calendar. Replay any of them from the Calendar tab to climb the ranking.</p>';
    const hist = save.history.length
      ? `<table class="table"><tr><th>Event</th><th>Round</th><th>Opponent</th><th>Score</th></tr>${save.history.slice(0, 6).map((h) => `<tr><td>${esc(EVENT_BY_ID[h.event]?.name || h.event)}</td><td>${esc(h.round)}</td><td>${esc(h.opp)}</td><td style="color:${h.won ? 'var(--accent)' : 'var(--bad)'}">${h.won ? 'W' : 'L'} ${esc(h.score)}</td></tr>`).join('')}</table>`
      : '<p class="mute">No matches yet. Enter the Club Open to begin.</p>';
    const obj = OBJECTIVES.map((o) => `<div class="obj ${save.objectives[o.id] ? 'done' : ''}"><span>${save.objectives[o.id] ? '✓' : '○'}</span><span class="grow">${esc(o.text)}</span><span class="mute">${esc(o.rewardText || [o.reward.coins && o.reward.coins + ' coins', o.reward.devPoints && o.reward.devPoints + ' dev. pts'].filter(Boolean).join(' · '))}</span></div>`).join('');
    body = `${nextCard}<div class="label" style="margin:14px 0 6px">Recent results</div>${hist}<div class="label" style="margin:14px 0 6px">Objectives</div>${obj}`;
  } else if (tab === 'calendar') {
    body = [1, 2, 3].map((s) => `<div class="label" style="margin:12px 0 8px">Season ${s}</div><div class="stagegrid">${cal.filter((c) => c.event.season === s).map((c) => eventCard(c, save)).join('')}</div>`).join('');
  } else if (tab === 'training') {
    body = `<p class="mute" style="margin-bottom:10px">Drills use the same ball physics and shot mechanics as a match. Earn stars to gain development points; only improvements pay.</p><div class="stagegrid">${DRILLS.map((d) => `<div class="stage"><h3>${esc(d.name)}</h3><p class="mute">${esc(d.blurb)}</p><div class="row">${stars(save.drills[d.id] || 0)}<span class="grow"></span><span class="mute" style="font-size:12px">${d.stars.join(' / ')} for 1-3★</span></div><button class="btn primary" data-act="drillStart" data-drill="${d.id}">Start drill</button></div>`).join('')}</div>`;
  } else if (tab === 'development') {
    body = upgradesHtml(save);
  }
  return wrap(header(save, tab) + body);
}

/** The draw / group table for the active tournament plus the next match. */
export function eventHtml(save) {
  const t = save.active;
  const ev = EVENT_BY_ID[t.eventId];
  const n = nextPlayerMatch(t);
  const teamLabel = (i) => `<span class="${i === 0 ? 'you' : ''}">${teamName(t.teams[i].ids)}</span>`;
  const matchBox = (m) => `<div class="bmatch">${[m.a, m.b].map((i) => `<div class="${m.winner === i ? 'win' : m.winner !== undefined ? 'lose' : ''}">${teamLabel(i)}</div>`).join('')}${m.score ? `<div class="mute" style="font-size:11px">${esc(m.score)}</div>` : ''}</div>`;
  let bracket;
  if (t.format === 'knockout') {
    const rounds = [...t.rounds];
    const names = t.koNames;
    bracket = `<div class="bracket">${names.map((nm, i) => `<div class="bround"><div class="label">${esc(nm)}</div>${rounds[i] ? rounds[i].matches.map(matchBox).join('') : '<div class="bmatch tbd">To be decided</div>'}</div>`).join('')}</div>`;
  } else {
    const order = standings(t);
    bracket = `<table class="table"><tr><th>#</th><th>Team</th><th>W</th><th>L</th><th>Games</th></tr>${order.map((i, k) => `<tr><td>${k + 1}</td><td>${teamLabel(i)}</td><td>${t.games[i].w}</td><td>${t.games[i].l}</td><td>${t.games[i].gf}-${t.games[i].ga}</td></tr>`).join('')}</table>
      <div class="label" style="margin:10px 0 6px">Matches</div><div class="bracket">${t.rounds.map((r) => `<div class="bround"><div class="label">${esc(r.name)}</div>${r.matches.map(matchBox).join('')}</div>`).join('')}</div>`;
  }
  const opps = n ? describeOpponents(n.opponents) : [];
  const scout = opps.map((o) => `<div class="scout"><b>${esc(o.name)}</b> <span class="tag">${esc(BOT_LABELS[o.level])}</span> <span class="tag">${esc(STYLE_NAMES[o.style])}</span><br><span class="mute">${esc(o.note)}</span><br><span class="mute" style="font-size:12px">World ranking points: ${o.points}</span></div>`).join('');
  const nextCard = n ? `<div class="panel" style="background:var(--panel-2);margin-top:14px"><div class="label">Your next match · ${esc(n.name)}</div><div style="font-size:18px;font-weight:700;margin:4px 0">${teamName(t.teams[0].ids)} vs ${teamName(n.opponents)}</div>${scout}
      <p class="mute" style="margin:8px 0">${ev.sets === 1 ? '1 set' : 'Best of ' + ev.sets} to ${ev.gamesPerSet} games${ev.golden ? ', golden point' : ''} · ${esc(COURTS[ev.court].name)}. Objective: win it and keep the errors down.</p>
      <button class="btn primary" data-act="eventPlay">Play match</button></div>` : '';
  return wrap(`<div class="row"><h2 style="margin:0">${esc(ev.name)}</h2><span class="tag">${esc(ev.tier)}</span><span class="grow"></span><button class="btn small ghost" data-act="eventAbandon">Withdraw</button><button class="btn small" data-act="careerTab" data-val="calendar">Calendar</button></div>
    <p class="mute" style="margin:6px 0 12px">${esc(ev.blurb)}</p>${t.round === 0 && t.rounds.length === 1 && !t.rounds[0].matches.some((m) => m.winner !== undefined) ? sceneHtml(sceneFor(ev.id, 'intro')) : ''}${bracket}${nextCard}`);
}

/** Panel shown on the results screen after an event match. */
export function eventResultHtml(info) {
  const lines = [];
  if (info.finished) {
    const r = info.finished;
    lines.push(`<div style="font-size:24px;font-weight:800;color:var(--accent)">${esc(RESULT_LABELS[r.result] || r.result)}</div>`);
    lines.push(`<p class="mute">+${r.points} ranking points · +${r.coins} coins · +${r.xp} XP${r.devPoints ? ' · +' + r.devPoints + ' development points' : ''}</p>`);
    if (info.summary) lines.push(`<p>${esc(info.summary)}</p>`);
    lines.push(sceneHtml(sceneFor(info.eventId, r.result === 'champion' ? 'champion' : 'other')));
  } else {
    lines.push(`<p class="mute">Next: ${esc(info.next || '')}</p>`);
  }
  for (const o of info.objectives || []) lines.push(`<div class="obj done"><span>✓</span><span class="grow">Objective complete: ${esc(o.text)}</span><span class="mute">${esc(o.rewardText || '')}</span></div>`);
  return `<div class="panel" style="margin-top:14px;background:var(--panel-2)"><div class="label">${esc(info.event)} · ${esc(info.round)}</div><p style="margin:6px 0">${esc(info.commentary)}</p>${lines.join('')}</div>`;
}

export function drillResultHtml(drill, score, attempts, r) {
  return `<h2>${esc(drill.name)}</h2><div style="font-size:34px;letter-spacing:.2em;color:var(--accent)">${'★'.repeat(r.stars)}<span class="mute">${'★'.repeat(3 - r.stars)}</span></div>
    <p>Score <b>${score}</b> from ${attempts} balls. Stars at ${drill.stars.join(' / ')}.</p>
    <p class="mute">${r.devPoints ? `+${r.devPoints} development points.` : r.stars === 0 ? 'Not enough for a star yet. Try again.' : 'No new points: you already have these stars or better.'}</p>
    <div class="row" style="margin-top:12px"><button class="btn primary" data-act="drillStart" data-drill="${drill.id}">Try again</button><button class="btn" data-act="careerTab" data-val="training">Back to training</button></div>`;
}

export { finishRewards };
