import { parentPort } from 'node:worker_threads';
import { playMatch } from './match.js';
parentPort.on('message', (job) => {
  try { parentPort.postMessage({ id: job.id, stats: playMatch(job) }); } catch (e) { parentPort.postMessage({ id: job.id, error: String(e.stack || e) }); }
});
