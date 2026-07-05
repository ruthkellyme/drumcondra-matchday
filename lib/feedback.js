// Lightweight, no-database feedback log — residents can say how a match day
// actually played out, so the estimates in lib/config.js can be tuned against
// reality. Appends to a local JSONL file rather than a real database, which
// is enough for a personal tool but WON'T survive a redeploy/restart on an
// ephemeral host like Render's free tier — see README for the caveat.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const FEEDBACK_FILE = path.join(DATA_DIR, 'feedback.jsonl');

export function appendFeedback(entry) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.appendFileSync(FEEDBACK_FILE, `${JSON.stringify(entry)}\n`, 'utf8');
}

export function readFeedback() {
  if (!fs.existsSync(FEEDBACK_FILE)) return [];
  return fs.readFileSync(FEEDBACK_FILE, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}
