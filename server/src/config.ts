import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const VERSION = '0.1.0';

export const DATA_DIR = path.resolve(process.env.DATA_DIR ?? './data');
export const PORT = Number(process.env.PORT ?? 8080);
export const HOST = process.env.HOST ?? '0.0.0.0';
export const WEB_DIR = path.resolve(process.env.WEB_DIR ?? '../web/dist');
export const IMAGES_DIR = path.join(DATA_DIR, 'images');

fs.mkdirSync(IMAGES_DIR, { recursive: true });

/** API token: from API_TOKEN, else generated once and persisted in the data dir. */
function loadToken(): { token: string; generated: boolean } {
  if (process.env.API_TOKEN) return { token: process.env.API_TOKEN, generated: false };
  const file = path.join(DATA_DIR, 'api-token');
  if (fs.existsSync(file)) return { token: fs.readFileSync(file, 'utf8').trim(), generated: false };
  const token = randomBytes(24).toString('base64url');
  fs.writeFileSync(file, token + '\n', { mode: 0o600 });
  return { token, generated: true };
}

export const { token: API_TOKEN, generated: TOKEN_GENERATED } = loadToken();

/** Set ALLOW_PRIVATE_IMAGE_HOSTS=1 only for local testing; it disables the SSRF guard. */
export const ALLOW_PRIVATE_HOSTS = process.env.ALLOW_PRIVATE_HOSTS === '1';
