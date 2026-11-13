// Clerk-Anmeldung prüfen ohne npm-Abhängigkeit (Muster aus botschaftenarchiv/api/sync.js).
// Bewusst ohne Standard-Key: fehlt die Konfiguration, liefert fromEnv null und die API antwortet 503.
const crypto = require('crypto');

const CLOCK_SKEW_SECONDS = 60;
const JWKS_TTL_MS = 60 * 60 * 1000;
const EMAILS_TTL_MS = 60 * 1000;
const DEFAULT_PARTIES = ['https://rhein-neckar-aktionskarte.vercel.app'];

class AuthError extends Error {}

function frontendApiFromPublishableKey(pk) {
  const parts = String(pk || '').split('_');
  if (parts.length < 3 || parts[0] !== 'pk') return null;
  const decoded = Buffer.from(parts.slice(2).join('_'), 'base64').toString('utf8');
  if (!decoded.endsWith('$')) return null;
  const host = decoded.slice(0, -1);
  return /^[a-z0-9.-]+$/i.test(host) ? host : null;
}

function configFromEnv(env) {
  const host = frontendApiFromPublishableKey(env.CLERK_PUBLISHABLE_KEY);
  const issuer = (env.CLERK_ISSUER || (host ? `https://${host}` : '')).replace(/\/+$/, '');
  const secret = env.CLERK_SECRET_KEY;
  if (!issuer || !secret) return null;
  const parties = (env.CLERK_AUTHORIZED_PARTIES || DEFAULT_PARTIES.join(','))
    .split(',').map(s => s.trim().replace(/\/+$/, '')).filter(Boolean);
  return { issuer, jwksUrl: env.CLERK_JWKS_URL || `${issuer}/.well-known/jwks.json`, parties, secret };
}

const b64url = (s) => Buffer.from(String(s), 'base64url');

let jwksCache = { url: null, keys: null, at: 0 };
async function fetchJwks(url, force) {
  if (!force && jwksCache.url === url && jwksCache.keys && Date.now() - jwksCache.at < JWKS_TTL_MS) return jwksCache.keys;
  const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error(`JWKS HTTP ${r.status}`);
  const json = await r.json();
  jwksCache = { url, keys: Array.isArray(json.keys) ? json.keys : [], at: Date.now() };
  return jwksCache.keys;
}

async function verifyToken(token, config, getJwks = fetchJwks) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new AuthError('Ungültiges Token');
  let header, payload;
  try {
    header = JSON.parse(b64url(parts[0]).toString('utf8'));
    payload = JSON.parse(b64url(parts[1]).toString('utf8'));
  } catch (e) {
    throw new AuthError('Ungültiges Token');
  }
  if (header.alg !== 'RS256') throw new AuthError('Nicht unterstützter Algorithmus');
  let jwk = (await getJwks(config.jwksUrl, false)).find(k => k.kid === header.kid);
  if (!jwk) jwk = (await getJwks(config.jwksUrl, true)).find(k => k.kid === header.kid); // Schlüsselrotation
  if (!jwk || jwk.kty !== 'RSA') throw new AuthError('Unbekannter Signaturschlüssel');
  const ok = crypto.verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`),
    crypto.createPublicKey({ key: jwk, format: 'jwk' }), b64url(parts[2]));
  if (!ok) throw new AuthError('Signatur ungültig');
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp < now - CLOCK_SKEW_SECONDS) throw new AuthError('Token abgelaufen');
  if (typeof payload.nbf === 'number' && payload.nbf > now + CLOCK_SKEW_SECONDS) throw new AuthError('Token noch nicht gültig');
  if (String(payload.iss || '').replace(/\/+$/, '') !== config.issuer) throw new AuthError('Issuer ungültig');
  // azp ist Pflicht: sonst gälten Tokens, die eine fremde Seite für diese Clerk-Instanz bekommen hat.
  if (!config.parties.includes(String(payload.azp || '').replace(/\/+$/, ''))) throw new AuthError('azp ungültig');
  if (!payload.sub || typeof payload.sub !== 'string') throw new AuthError('sub fehlt');
  return payload;
}

// Nur bestätigte Adressen: eine unbestätigte Adresse darf keine Einladung einlösen.
function verifiedEmailsOf(user) {
  return (user.email_addresses || [])
    .filter(e => e && e.verification && e.verification.status === 'verified')
    .map(e => String(e.email_address).toLowerCase());
}

const emailCache = new Map();
async function emailsOf(userId, config) {
  const hit = emailCache.get(userId);
  if (hit && Date.now() - hit.at < EMAILS_TTL_MS) return hit.emails;
  const r = await fetch(`https://api.clerk.com/v1/users/${encodeURIComponent(userId)}`, {
    headers: { Authorization: `Bearer ${config.secret}` }, signal: AbortSignal.timeout(5000)
  });
  if (!r.ok) throw new Error(`Clerk HTTP ${r.status}`);
  const emails = verifiedEmailsOf(await r.json());
  emailCache.set(userId, { emails, at: Date.now() });
  return emails;
}

function fromEnv(env) {
  const config = configFromEnv(env);
  if (!config) return null;
  return { verify: (t) => verifyToken(t, config), emailsOf: (id) => emailsOf(id, config) };
}

module.exports = { AuthError, fromEnv, configFromEnv, verifyToken, verifiedEmailsOf };
