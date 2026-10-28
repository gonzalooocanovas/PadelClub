// Builds single-file bundles of the whole project for an AI that cannot read the repository.
const fs = require('fs');
const path = require('path');

const root = __dirname;
const ignoreDirs = new Set(['node_modules', 'data', 'scratch', '.git', 'bundles']);
const ignoreFiles = new Set(['package-lock.json', '_p32.cjs', 'bundle.cjs']);
const textExt = new Set(['.js', '.cjs', '.json', '.md', '.css', '.html', '.yaml', '.yml', '.txt', '']);

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir).sort()) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) { if (!ignoreDirs.has(name)) walk(p, out); continue; }
    if (ignoreFiles.has(name) || name.endsWith('.zip')) continue;
    if (!textExt.has(path.extname(name))) continue;
    if (st.size > 400_000) continue;
    out.push(path.relative(root, p).split(path.sep).join('/'));
  }
  return out;
}

const all = walk(root);
const rank = (f) => {
  if (f === 'CHATGPT_BRIEFING.md') return 0;
  if (f === 'DEV_CHECKLIST.md') return 1;
  if (f === 'README.md') return 2;
  if (f.startsWith('shared/')) return 3;
  if (f.startsWith('server/')) return 4;
  if (f.startsWith('client/')) return 5;
  if (f.startsWith('test/')) return 6;
  return 7;
};
all.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));

function bundle(files, title, note) {
  const lines = [];
  lines.push(`#################### ${title} ####################`);
  lines.push(note);
  lines.push('');
  lines.push('HOW THIS FILE IS ORGANISED: first the briefing and status documents, then the source code. Every file starts with a line');
  lines.push('"===== FILE: path =====" and ends with "===== END FILE: path =====". Use the table of contents to find things.');
  lines.push('');
  lines.push('TABLE OF CONTENTS');
  let total = 0;
  const bodies = files.map((f) => { const t = fs.readFileSync(path.join(root, f), 'utf8'); total += t.length; return [f, t]; });
  for (const [f, t] of bodies) lines.push(`  ${f}  (${t.split('\n').length} lines)`);
  lines.push('');
  for (const [f, t] of bodies) {
    lines.push(`===== FILE: ${f} =====`);
    lines.push(t.replace(/\s+$/, ''));
    lines.push(`===== END FILE: ${f} =====`);
    lines.push('');
  }
  return { text: lines.join('\n'), total };
}

fs.mkdirSync(path.join(root, 'bundles'), { recursive: true });

const full = bundle(all, 'PADEL CLUB: COMPLETE PROJECT (documents + all source code + tests)',
  'Online 4-player padel game. Node.js authoritative server + Three.js client. Read CHATGPT_BRIEFING.md first: it says what is wanted from you.');
fs.writeFileSync(path.join(root, 'bundles', 'PADEL_CLUB_FULL_CODE.txt'), full.text);

// the core: documents + the game logic and server, without the client rendering code and the tests (fits smaller contexts)
const core = all.filter((f) => /^(CHATGPT_BRIEFING|DEV_CHECKLIST|README)\.md$/.test(f) || f.startsWith('shared/') || f.startsWith('server/') || ['client/js/game.js', 'client/js/input.js', 'client/js/local.js', 'client/js/drills.js'].includes(f));
const small = bundle(core, 'PADEL CLUB: CORE (documents + shared game logic + server + client game loop)',
  'Smaller version of the project: the rules, physics, bot AI, career logic, server, and the client game loop. The rendering, UI and tests are left out. Read CHATGPT_BRIEFING.md first.');
fs.writeFileSync(path.join(root, 'bundles', 'PADEL_CLUB_CORE.txt'), small.text);

console.log('full:', all.length, 'files,', Math.round(full.text.length / 1024), 'KB');
console.log('core:', core.length, 'files,', Math.round(small.text.length / 1024), 'KB');
