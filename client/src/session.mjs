// Хранилище сессии: deviceId, androidId, токены.
// Файл создаётся с правами 0600 в client/.state/session.json (переопределяется LENTA_STATE_DIR).

import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

export const STATE_DIR = process.env.LENTA_STATE_DIR || join(HERE, '..', '.state');
export const SESSION_FILE = join(STATE_DIR, 'session.json');

export function loadSession() {
  try {
    return JSON.parse(readFileSync(SESSION_FILE, 'utf8'));
  } catch {
    return {};
  }
}

export function saveSession(session) {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2) + '\n', { mode: 0o600 });
}

export function clearSession() {
  if (existsSync(SESSION_FILE)) rmSync(SESSION_FILE);
}

// deviceId генерируется один раз: "A-" + UUID (PreferencesImpl.getDeviceId).
// androidId — 16 hex-символов, как Android ID (заголовок x-mob-sgm).
export function ensureIdentity(session) {
  if (!session.deviceId) session.deviceId = 'A-' + randomUUID();
  if (!session.androidId) session.androidId = randomBytes(8).toString('hex');
  return session;
}
