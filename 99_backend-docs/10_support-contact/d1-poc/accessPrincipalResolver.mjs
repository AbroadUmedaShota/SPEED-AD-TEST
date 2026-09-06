import { decodeProtectedHeader, importJWK, jwtVerify } from 'jose';

const DEFAULT_CACHE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_REFRESH_COOLDOWN_MS = 30 * 1000;
const DEFAULT_TIMEOUT_MS = 3 * 1000;

function trustedIssuer(teamDomain) {
  const value = String(teamDomain || '').trim().toLowerCase();
  if (!/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(value)) {
    throw new Error('invalid_access_team_domain');
  }
  return `https://${value}`;
}

function bearerToken(request) {
  const assertion = request.headers.get('cf-access-jwt-assertion');
  return assertion ? assertion.trim() : '';
}

export class AccessPrincipalResolver {
  constructor(options = {}) {
    this.fetchJwks = options.fetchJwks || fetch;
    this.now = options.now || Date.now;
    this.cacheTtlMs = Math.min(options.cacheTtlMs || DEFAULT_CACHE_TTL_MS, DEFAULT_CACHE_TTL_MS);
    this.refreshCooldownMs = options.refreshCooldownMs || DEFAULT_REFRESH_COOLDOWN_MS;
    this.timeoutMs = Math.min(options.timeoutMs || DEFAULT_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
    this.cache = null;
    this.lastRefreshAttempt = -Infinity;
    this.inFlight = null;
  }

  async refresh(issuer) {
    if (this.inFlight) return this.inFlight;
    this.lastRefreshAttempt = this.now();
    this.inFlight = (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.fetchJwks(`${issuer}/cdn-cgi/access/certs`, {
          headers: { accept: 'application/json' },
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('jwks_fetch_failed');
        const body = await response.json();
        if (!Array.isArray(body.keys)) throw new Error('invalid_jwks');
        const keys = new Map();
        for (const jwk of body.keys) {
          if (jwk?.kid && jwk.kty === 'RSA' && (!jwk.alg || jwk.alg === 'RS256')) {
            keys.set(jwk.kid, await importJWK(jwk, 'RS256'));
          }
        }
        if (!keys.size) throw new Error('invalid_jwks');
        this.cache = { issuer, keys, expiresAt: this.now() + this.cacheTtlMs };
        return this.cache;
      } finally {
        clearTimeout(timer);
        this.inFlight = null;
      }
    })();
    return this.inFlight;
  }

  async keyFor(token, issuer) {
    const header = decodeProtectedHeader(token);
    if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid) {
      throw new Error('invalid_jwt_header');
    }
    const now = this.now();
    if (!this.cache || this.cache.issuer !== issuer || this.cache.expiresAt <= now) {
      if (this.inFlight) await this.refresh(issuer);
      else {
        if (now - this.lastRefreshAttempt < this.refreshCooldownMs) {
          throw new Error('jwks_refresh_cooldown');
        }
        await this.refresh(issuer);
      }
    }
    let key = this.cache?.keys.get(header.kid);
    if (!key && now - this.lastRefreshAttempt >= this.refreshCooldownMs) {
      await this.refresh(issuer);
      key = this.cache?.keys.get(header.kid);
    }
    if (!key) throw new Error('unknown_jwt_key');
    return key;
  }

  async resolve(request, env) {
    const token = bearerToken(request);
    if (!token) return null;
    try {
      const issuer = trustedIssuer(env.ACCESS_TEAM_DOMAIN);
      const audience = String(env.ACCESS_AUD || '').trim();
      if (!audience) throw new Error('invalid_access_audience');
      const key = await this.keyFor(token, issuer);
      const { payload, protectedHeader } = await jwtVerify(token, key, {
        algorithms: ['RS256'],
        audience,
        issuer,
        currentDate: new Date(this.now()),
      });
      if (protectedHeader.alg !== 'RS256'
        || payload.type !== 'app'
        || typeof payload.email !== 'string'
        || !payload.email.includes('@')
        || typeof payload.exp !== 'number'
        || typeof payload.iat !== 'number'
        || typeof payload.nbf !== 'number') return null;
      const email = payload.email.trim().toLowerCase();
      const operator = await env.DB.prepare(
        'SELECT email, display_name FROM contact_operators WHERE email = ? AND active = 1',
      ).bind(email).first();
      return operator ? { email: operator.email, displayName: operator.display_name } : null;
    } catch {
      return null;
    }
  }
}

export const accessPrincipalResolver = new AccessPrincipalResolver();
