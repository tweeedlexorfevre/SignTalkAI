// Passwords (scrypt), bearer tokens, unique IDs and input validation.
import { createHash, randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);
const KEY_LENGTH = 64;
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scryptAsync(password.normalize('NFKC'), salt, KEY_LENGTH, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  const parts = String(stored).split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltText, keyText] = parts;
  const expected = Buffer.from(keyText, 'base64');
  const key = await scryptAsync(password.normalize('NFKC'), Buffer.from(saltText, 'base64'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: SCRYPT.maxmem,
  });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** A hash computed once so a login with an unknown name costs the same as a wrong password. */
let dummyHash = null;
export async function burnPasswordCheck(password) {
  dummyHash ??= await hashPassword('signtalk-timing-equaliser');
  await verifyPassword(password, dummyHash);
}

export function newToken() {
  return randomBytes(32).toString('base64url');
}

export function tokenHash(token) {
  return createHash('sha256').update(token).digest('hex');
}

// No 0/O/1/I so an ID read aloud or written by hand is unambiguous.
const ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function newPublicId() {
  let code = '';
  for (let i = 0; i < 6; i++) code += ID_ALPHABET[randomInt(ID_ALPHABET.length)];
  return `ST-${code}`;
}

/** Accepts "ST-7KQ2MX", "st7kq2mx", "7KQ2MX", " ST 7KQ 2MX " and returns "ST-7KQ2MX", else null. */
export function normalizePublicId(input) {
  const compact = String(input ?? '')
    .toUpperCase()
    .replace(/[\s-]/g, '');
  const code = compact.startsWith('ST') && compact.length === 8 ? compact.slice(2) : compact;
  return /^[A-HJ-NP-Z2-9]{6}$/.test(code) ? `ST-${code}` : null;
}

export const USERNAME = /^[A-Za-z0-9_.]{3,24}$/;

export function validateRegistration(body) {
  const errors = {};
  const username = typeof body?.username === 'string' ? body.username.trim() : '';
  const displayName = cleanName(body?.displayName);
  const password = typeof body?.password === 'string' ? body.password : '';
  if (!USERNAME.test(username)) errors.username = 'invalid_username';
  if (!displayName) errors.displayName = 'invalid_display_name';
  if (password.length < 8 || password.length > 128) errors.password = 'invalid_password';
  return { username, displayName, password, errors };
}

export function cleanName(value) {
  if (typeof value !== 'string') return '';
  // Collapse whitespace and drop control characters.
  const name = value.replace(/[\p{Cc}\p{Cf}]/gu, '').replace(/\s+/g, ' ').trim();
  return name.length >= 1 && name.length <= 40 ? name : '';
}

/** A short human label for a device, from its User-Agent. Only this label is stored. */
export function deviceName(userAgent) {
  const ua = String(userAgent ?? '');
  const os = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Mac OS X|Macintosh/.test(ua)
            ? 'macOS'
            : /CrOS/.test(ua)
              ? 'ChromeOS'
              : /Linux/.test(ua)
                ? 'Linux'
                : '';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /YaBrowser\//.test(ua)
        ? 'Yandex'
        : /Firefox\//.test(ua)
          ? 'Firefox'
          : /Chrome\//.test(ua)
            ? 'Chrome'
            : /Safari\//.test(ua)
              ? 'Safari'
              : '';
  const label = [browser, os].filter(Boolean).join(' · ');
  return label || 'Устройство';
}
