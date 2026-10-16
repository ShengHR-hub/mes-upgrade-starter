// Authorized admin password reset (verification only).
//
// Why this exists: scripts/bootstrap-admin.ps1 intentionally refuses to touch an account
// that already has a usable Argon2id hash ("Target user already has a usable password").
// In the current local database the admin account was already initialized in an earlier
// session, so the normal first-login bootstrap path cannot set the requested password.
// The task owner explicitly authorized setting the MES admin password for this verification
// run, so this script performs the equivalent update, restricted to:
//   - exactly one row: sys_user WHERE username = 'admin'
//   - only if that row is an enabled admin row
// The new password is read from the process environment (MES_ADMIN_PASSWORD) and is never
// printed or written to disk. No other user row is read or modified.
import { createRequire } from 'node:module';
import mysql from '../backend/node_modules/mysql2/promise.js';
import { hash } from '../backend/node_modules/@node-rs/argon2/index.js';

const require = createRequire(import.meta.url);
const dotenv = require('../backend/node_modules/dotenv/dist/index.cjs');

// Load backend/.env (same file the NestJS app uses); process env always wins,
// so an injected DB_PASSWORD / MES_ADMIN_PASSWORD is never overridden.
const envPath = decodeURIComponent(new URL('../backend/.env', import.meta.url).pathname).replace(/^\//, '');
dotenv.config({ path: envPath, override: false });

const required = ['DB_HOST', 'DB_PORT', 'DB_USERNAME', 'DB_DATABASE', 'MES_ADMIN_PASSWORD'];
for (const name of required) {
  if (!process.env[name]) throw new Error(`${name} is required`);
}

const username = 'admin';
const password = process.env.MES_ADMIN_PASSWORD;
if (password.length < 1 || password.length > 64) throw new Error('Password length must be 1-64 characters');

const connection = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_DATABASE,
  charset: process.env.DB_CHARSET || 'utf8mb4',
  connectTimeout: Number(process.env.DB_CONNECT_TIMEOUT || 10000),
});

try {
  const [rows] = await connection.execute(
    'SELECT id, role, enabled FROM sys_user WHERE username = ? LIMIT 1',
    [username],
  );
  const user = rows[0];
  if (!user) throw new Error(`User not found: ${username}`);
  if (Number(user.enabled) !== 1 || user.role !== 'admin') {
    throw new Error('Target user must be an enabled admin');
  }
  const passwordHash = await hash(password);
  await connection.execute('UPDATE sys_user SET password_hash = ? WHERE id = ?', [passwordHash, user.id]);
  console.log(`Password reset completed for admin account '${username}' (id=${user.id}). The password was not printed.`);
} finally {
  await connection.end();
}
