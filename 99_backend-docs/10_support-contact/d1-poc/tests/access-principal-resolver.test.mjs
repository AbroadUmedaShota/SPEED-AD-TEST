import assert from 'node:assert/strict';
import test from 'node:test';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { AccessPrincipalResolver } from '../accessPrincipalResolver.mjs';

const issuer = 'https://example.cloudflareaccess.com';
const audience = 'shared-trial-audience';

async function keyFixture(kid) {
  const pair = await generateKeyPair('RS256');
  const publicJwk = await exportJWK(pair.publicKey);
  return { ...pair, jwk: { ...publicJwk, alg: 'RS256', kid, use: 'sig' } };
}

async function token(key, claims = {}, header = {}, registered = {}) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ email: 'operator@example.invalid', type: 'app', ...claims })
    .setProtectedHeader({ alg: 'RS256', kid: 'key-1', ...header })
    .setIssuer(registered.issuer || issuer).setAudience(registered.audience || audience)
    .setIssuedAt(now).setNotBefore(registered.nbf ?? now - 1)
    .setExpirationTime(registered.exp ?? now + 300).sign(key.privateKey);
}

function env(active = true) {
  return {
    ACCESS_TEAM_DOMAIN: 'example.cloudflareaccess.com', ACCESS_AUD: audience,
    DB: { prepare: () => ({ bind: email => ({ first: async () => active ? {
      email, display_name: '担当者',
    } : null }) }) },
  };
}

function request(assertion) {
  return new Request('https://contact-ops.example.invalid/api/session', {
    headers: assertion ? { 'cf-access-jwt-assertion': assertion } : {},
  });
}

test('validates RS256 Access token and active operator', async () => {
  const key = await keyFixture('key-1');
  let fetches = 0;
  const resolver = new AccessPrincipalResolver({ fetchJwks: async url => {
    fetches += 1;
    assert.equal(url, `${issuer}/cdn-cgi/access/certs`);
    return Response.json({ keys: [key.jwk] });
  } });
  assert.deepEqual(await resolver.resolve(request(await token(key)), env()), {
    email: 'operator@example.invalid', displayName: '担当者',
  });
  assert.equal(fetches, 1);
});

test('rejects missing token and inactive operator', async () => {
  const key = await keyFixture('key-1');
  let fetches = 0;
  const resolver = new AccessPrincipalResolver({ fetchJwks: async () => {
    fetches += 1; return Response.json({ keys: [key.jwk] });
  } });
  assert.equal(await resolver.resolve(request(), env()), null);
  assert.equal(fetches, 0);
  assert.equal(await resolver.resolve(request(await token(key)), env(false)), null);
});

test('rejects invalid signature, issuer, audience, expiry, future nbf and service token', async () => {
  const key = await keyFixture('key-1');
  const other = await keyFixture('key-1');
  const resolver = new AccessPrincipalResolver({ fetchJwks: async () => Response.json({ keys: [key.jwk] }) });
  const now = Math.floor(Date.now() / 1000);
  const cases = [
    await token(other),
    await token(key, {}, {}, { issuer: 'https://other.cloudflareaccess.com' }),
    await token(key, {}, {}, { audience: 'other' }),
    await token(key, {}, {}, { exp: now - 1 }),
    await token(key, {}, {}, { nbf: now + 120 }),
    await token(key, { type: 'service_token' }),
    await token(key, { email: 42 }),
  ];
  for (const [index, assertion] of cases.entries()) {
    assert.equal(await resolver.resolve(request(assertion), env()), null, `case ${index}`);
  }
});

test('uses bounded cache and refreshes once for a rotated kid after cooldown', async () => {
  const oldKey = await keyFixture('key-1');
  const newKey = await keyFixture('key-2');
  let now = Date.now();
  let keys = [oldKey.jwk];
  let fetches = 0;
  const resolver = new AccessPrincipalResolver({
    now: () => now, refreshCooldownMs: 30_000,
    fetchJwks: async () => { fetches += 1; return Response.json({ keys }); },
  });
  assert.ok(await resolver.resolve(request(await token(oldKey)), env()));
  assert.ok(await resolver.resolve(request(await token(oldKey)), env()));
  assert.equal(fetches, 1);
  keys = [newKey.jwk];
  assert.equal(await resolver.resolve(request(await token(newKey, {}, { kid: 'key-2' })), env()), null);
  assert.equal(fetches, 1);
  now += 30_001;
  assert.ok(await resolver.resolve(request(await token(newKey, {}, { kid: 'key-2' })), env()));
  assert.equal(fetches, 2);
});

test('fails closed when expired JWKS cannot be refreshed', async () => {
  const key = await keyFixture('key-1');
  let now = Date.now();
  let fail = false;
  let fetches = 0;
  const resolver = new AccessPrincipalResolver({
    now: () => now, cacheTtlMs: 100,
    fetchJwks: async () => {
      fetches += 1;
      return fail ? new Response('', { status: 503 }) : Response.json({ keys: [key.jwk] });
    },
  });
  assert.ok(await resolver.resolve(request(await token(key)), env()));
  now += 30_001;
  fail = true;
  assert.equal(await resolver.resolve(request(await token(key)), env()), null);
  assert.equal(fetches, 2);
});

test('throttles failed JWKS refreshes and retries after cooldown', async () => {
  const key = await keyFixture('key-1');
  let now = Date.now();
  let fetches = 0;
  let available = false;
  const resolver = new AccessPrincipalResolver({
    now: () => now, refreshCooldownMs: 30_000,
    fetchJwks: async () => {
      fetches += 1;
      return available ? Response.json({ keys: [key.jwk] }) : new Response('', { status: 503 });
    },
  });
  const assertion = await token(key);
  for (let index = 0; index < 4; index += 1) {
    assert.equal(await resolver.resolve(request(assertion), env()), null);
  }
  assert.equal(fetches, 1);
  now += 30_001;
  available = true;
  assert.ok(await resolver.resolve(request(assertion), env()));
  assert.equal(fetches, 2);
});

test('rejects missing nbf and ignores Authorization bearer fallback', async () => {
  const key = await keyFixture('key-1');
  const now = Math.floor(Date.now() / 1000);
  const missingNbf = await new SignJWT({ email: 'operator@example.invalid', type: 'app' })
    .setProtectedHeader({ alg: 'RS256', kid: 'key-1' }).setIssuer(issuer).setAudience(audience)
    .setIssuedAt(now).setExpirationTime(now + 300).sign(key.privateKey);
  let dbReads = 0;
  const checkedEnv = env();
  checkedEnv.DB.prepare = () => { dbReads += 1; throw new Error('unexpected DB read'); };
  const resolver = new AccessPrincipalResolver({ fetchJwks: async () => Response.json({ keys: [key.jwk] }) });
  assert.equal(await resolver.resolve(request(missingNbf), checkedEnv), null);
  assert.equal(dbReads, 0);
  const bearer = new Request('https://contact-ops.example.invalid/api/session', {
    headers: { authorization: `Bearer ${await token(key)}` },
  });
  assert.equal(await resolver.resolve(bearer, checkedEnv), null);
  assert.equal(dbReads, 0);
});

test('aborts a stalled JWKS request within the configured timeout', async () => {
  const key = await keyFixture('key-1');
  const resolver = new AccessPrincipalResolver({
    timeoutMs: 10,
    fetchJwks: (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }),
  });
  const startedAt = Date.now();
  assert.equal(await resolver.resolve(request(await token(key)), env()), null);
  assert.ok(Date.now() - startedAt < 500);
});

test('rejects untrusted team-domain configuration without fetching', async () => {
  let fetches = 0;
  const resolver = new AccessPrincipalResolver({ fetchJwks: async () => { fetches += 1; } });
  assert.equal(await resolver.resolve(request('not-a-jwt'), {
    ...env(), ACCESS_TEAM_DOMAIN: 'attacker.example',
  }), null);
  assert.equal(fetches, 0);
});
