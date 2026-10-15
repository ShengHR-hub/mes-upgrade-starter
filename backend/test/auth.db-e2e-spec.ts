import { randomBytes } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { decodeProtectedHeader, jwtVerify, SignJWT } from 'jose';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/bootstrap.js';
import { PasswordService } from '../src/modules/auth/password.service.js';

// Real MySQL + normal Nest providers + HTTP login + Argon2id + HS256.
// No identity override. Credentials/tokens remain in process memory.
const roles = ['admin', 'manager', 'operator'] as const;
const run = randomBytes(6).toString('hex');
const fixtures: Array<{ id: string; username: string; password: string; role: string; token: string }> = [];
const oldSecret = process.env.JWT_SECRET;
const oldLogging = process.env.DB_LOGGING;
const secret = randomBytes(48).toString('hex');
let app: INestApplication | undefined;
let db: DataSource | undefined;
let http: ReturnType<typeof request>;

beforeAll(async () => {
  if (!process.env.DB_PASSWORD) throw new Error('DB_PASSWORD unavailable: real JWT/DB tests not executed');
  process.env.JWT_SECRET = secret;
  process.env.DB_LOGGING = 'false';
  const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = module.createNestApplication({ logger: false });
  configureApp(app);
  await app.init();
  const connected = app.get(DataSource);
  db = connected;
  http = request(app.getHttpServer());
  const passwords = app.get(PasswordService);
  for (const role of roles) {
    const username = `s12_${run}_${role}`;
    const password = randomBytes(24).toString('hex');
    const hash = await passwords.hashPassword(password);
    await connected.query('INSERT INTO sys_user (username, name, role, password_hash, enabled) VALUES (?, ?, ?, ?, 1)',
      [username, 'S12 isolated test', role, hash]);
    // Track immediately after insertion, so a subsequent assertion/login failure is cleanable.
    const rows = await connected.query('SELECT id FROM sys_user WHERE username = ?', [username]);
    fixtures.push({ id: String(rows[0].id), username, password, role, token: '' });
  }
});

afterAll(async () => {
  try {
    if (db?.isInitialized) {
      // Exact per-run names also cover insertion followed by SELECT failure.
      for (const role of roles) {
        const username = `s12_${run}_${role}`;
        const rows = await db.query('SELECT id FROM sys_user WHERE username = ?', [username]);
        for (const row of rows) {
          await db.query('DELETE FROM audit_log WHERE user_id = ? AND target = ?', [row.id, `sys_user:${row.id}`]);
          await db.query('DELETE FROM sys_user WHERE id = ? AND username = ?', [row.id, username]);
        }
      }
    }
  } finally {
    await app?.close();
    if (oldSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = oldSecret;
    if (oldLogging === undefined) delete process.env.DB_LOGGING; else process.env.DB_LOGGING = oldLogging;
    for (const fixture of fixtures) { fixture.password = ''; fixture.token = ''; }
  }
});

describe('S12 real database authentication (no identity substitute)', () => {
  it('three roles log in with real passwords and receive verifiable HS256 tokens', async () => {
    for (const fixture of fixtures) {
      const result = await http.post('/api/v1/sessions').send({ username: fixture.username, password: fixture.password });
      expect(result.status).toBe(200);
      expect(result.body.code).toBe(0);
      fixture.token = result.body.data.accessToken;
      expect(typeof fixture.token === 'string' && fixture.token.length > 0).toBe(true);
      expect(decodeProtectedHeader(fixture.token).alg).toBe('HS256');
      const { payload } = await jwtVerify(fixture.token, new TextEncoder().encode(secret), {
        algorithms: ['HS256'], issuer: 'mes-backend', audience: 'mes-web',
      });
      expect(payload.sub === fixture.id && payload.role === fixture.role).toBe(true);
      expect(Number(payload.exp) - Number(payload.iat)).toBe(7200);
      const me = await http.get('/api/v1/users/me').auth(fixture.token, { type: 'bearer' });
      expect(me.status).toBe(200);
      expect(me.body.data.role).toBe(fixture.role);
      const users = await http.get('/api/v1/users').auth(fixture.token, { type: 'bearer' });
      expect(users.status).toBe(fixture.role === 'admin' ? 200 : 403);
    }
  });

  it('wrong password and unknown username share the same public failure code', async () => {
    for (const username of [fixtures[0]!.username, `absent_${run}`]) {
      const result = await http.post('/api/v1/sessions').send({ username, password: randomBytes(16).toString('hex') });
      expect(result.body.code).toBe(20003);
      expect(result.status).toBe(401);
    }
  });

  it('disabling a test account through the admin API invalidates its existing token immediately', async () => {
    const admin = fixtures[0]!;
    const operator = fixtures[2]!;
    expect((await http.patch(`/api/v1/users/${operator.id}`).auth(admin.token, { type: 'bearer' })
      .send({ enabled: false })).status).toBe(200);
    const result = await http.get('/api/v1/users/me').auth(operator.token, { type: 'bearer' });
    expect(result.status).toBe(403);
    expect(result.body.code).toBe(20004);
    expect((await http.patch(`/api/v1/users/${operator.id}`).auth(admin.token, { type: 'bearer' })
      .send({ enabled: true })).status).toBe(200);
  });

  it('role changes apply to an already issued token without relogin', async () => {
    const admin = fixtures[0]!;
    const manager = fixtures[1]!;
    await http.patch(`/api/v1/users/${manager.id}`).auth(admin.token, { type: 'bearer' })
      .send({ role: 'admin' }).expect(200);
    expect((await http.get('/api/v1/users').auth(manager.token, { type: 'bearer' })).status).toBe(200);
    await http.patch(`/api/v1/users/${manager.id}`).auth(admin.token, { type: 'bearer' })
      .send({ role: 'operator' }).expect(200);
    expect((await http.get('/api/v1/users').auth(manager.token, { type: 'bearer' })).status).toBe(403);
    expect((await http.get('/api/v1/users/me').auth(manager.token, { type: 'bearer' })).body.data.role).toBe('operator');
  });

  it('missing, incorrectly signed and expired tokens are rejected', async () => {
    expect((await http.get('/api/v1/users/me')).body.code).toBe(20001);
    for (const expired of [false, true]) {
      const token = await new SignJWT({ role: 'admin' }).setProtectedHeader({ alg: 'HS256' })
        .setSubject(fixtures[0]!.id).setIssuer('mes-backend').setAudience('mes-web')
        .setIssuedAt(Math.floor(Date.now() / 1000) - 120)
        .setExpirationTime(expired ? Math.floor(Date.now() / 1000) - 60 : Math.floor(Date.now() / 1000) + 60)
        .sign(new TextEncoder().encode(expired ? secret : randomBytes(48).toString('hex')));
      const result = await http.get('/api/v1/users/me').auth(token, { type: 'bearer' });
      expect(result.status).toBe(401);
      expect(result.body.code).toBe(expired ? 20002 : 20001);
    }
  });
});
