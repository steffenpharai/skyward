/**
 * Accounts, auth, and proof-of-personhood (plan §10 MUST-ADD 4 + M5).
 *
 * - Passwords are scrypt-hashed with a per-user salt (never stored plaintext);
 *   comparison is timing-safe. Length is bounded (MIN_PASSWORD .. MAX_PASSWORD) so a
 *   pathologically long password can't be used to burn CPU in scryptSync.
 * - Sessions are opaque random tokens with a TTL (owned by the world server).
 * - Proof-of-personhood is a PLUGGABLE gate:
 *     • If SKY_POP_PROVIDER (turnstile | hcaptcha | recaptcha) + SKY_POP_SECRET are
 *       set, registration verifies a real captcha token server-side (the production path).
 *     • Otherwise a single-use, short-TTL arithmetic challenge ships as the default/dev
 *       gate. It is intentionally weak on its own — the real anti-sybil guarantees are
 *       the captcha provider above plus the per-IP registration cap in world.mjs.
 *
 * Pure helpers — the world server owns the account records + session map and persists
 * them through the store. No DB coupling here.
 */
import crypto from "node:crypto";

export const MIN_PASSWORD = 8;
export const MAX_PASSWORD = 200;   // scryptSync DoS guard — never hash unbounded input

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return `${salt}:${hash}`;
}
export function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || "").split(":");
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(String(password), salt, 64).toString("hex");
  const a = Buffer.from(hash, "hex"), b = Buffer.from(test, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
export function makeToken() { return crypto.randomBytes(24).toString("base64url"); }

// --- proof-of-personhood (pluggable: real captcha provider, else dev challenge) ----
const POP_PROVIDER = (process.env.SKY_POP_PROVIDER || "").toLowerCase();
const POP_SECRET = process.env.SKY_POP_SECRET || "";
const POP_VERIFY_URL = {
  turnstile: "https://challenges.cloudflare.com/turnstile/v0/siteverify",
  hcaptcha:  "https://hcaptcha.com/siteverify",
  recaptcha: "https://www.google.com/recaptcha/api/siteverify",
};
/** The active captcha provider name, or null when running on the dev challenge. */
export const popProvider = () => (POP_PROVIDER && POP_SECRET && POP_VERIFY_URL[POP_PROVIDER] ? POP_PROVIDER : null);

const challenges = new Map();   // id -> { answer, exp, tries }
export function issueChallenge() {
  // Wider space + single-use + short TTL + capped tries. Real anti-sybil is the
  // captcha provider (when configured) + the per-IP registration cap.
  const a = 12 + Math.floor(Math.random() * 88), b = 12 + Math.floor(Math.random() * 88);
  const id = crypto.randomBytes(12).toString("hex");
  challenges.set(id, { answer: a + b, exp: Date.now() + 120000, tries: 0 });
  for (const [k, v] of challenges) if (v.exp < Date.now()) challenges.delete(k);
  if (popProvider()) return { id: null, provider: popProvider(), question: null };
  return { id, provider: null, question: `Prove you're human: what is ${a} + ${b}?` };
}

/**
 * Verify a human proof. Async because the provider path makes a network call.
 * @param {{challengeId?:string, answer?:any, captchaToken?:string, ip?:string}} input
 */
export async function verifyHumanProof(input = {}) {
  const provider = popProvider();
  if (provider) {
    try {
      const body = new URLSearchParams({ secret: POP_SECRET, response: String(input.captchaToken || "") });
      if (input.ip) body.set("remoteip", input.ip);
      const r = await fetch(POP_VERIFY_URL[provider], {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
      });
      const data = await r.json().catch(() => ({}));
      return !!data.success;
    } catch { return false; }
  }
  // dev/default challenge
  const c = challenges.get(input.challengeId);
  if (!c || c.exp < Date.now()) { if (c) challenges.delete(input.challengeId); return false; }
  c.tries++;
  if (c.tries > 3) { challenges.delete(input.challengeId); return false; }   // no brute force
  const ok = Number(input.answer) === c.answer;
  if (ok) challenges.delete(input.challengeId);
  return ok;
}

export const validUsername = (u) => typeof u === "string" && /^[a-zA-Z0-9_]{3,20}$/.test(u);

// --- Sign in with Google (OIDC ID-token verification, dependency-free) ------------
// The GIS button returns a signed ID token (JWT); we verify it server-side against
// Google's public JWKS and our client id. Per Google's 2026 guidance the user's stable
// identity is the `sub` claim (never the email). No external library: Node's crypto can
// build a public key straight from a JWK and verify RS256.
const GOOGLE_ISS = ["accounts.google.com", "https://accounts.google.com"];
let _gKeys = { keys: [], exp: 0 };
async function googleJwks() {
  if (Date.now() < _gKeys.exp && _gKeys.keys.length) return _gKeys.keys;
  const r = await fetch("https://www.googleapis.com/oauth2/v3/certs");
  if (!r.ok) throw new Error("jwks " + r.status);
  const data = await r.json();
  const m = /max-age=(\d+)/.exec(r.headers.get("cache-control") || "");
  _gKeys = { keys: data.keys || [], exp: Date.now() + (m ? +m[1] : 3600) * 1000 };
  return _gKeys.keys;
}
const _b64urlJson = (s) => JSON.parse(Buffer.from(String(s), "base64url").toString("utf8"));
/**
 * Verify a Google OIDC ID token. Returns a trusted profile { sub, email, emailVerified,
 * name, picture, nonce } or null. `keysOverride` is for tests only.
 */
export async function verifyGoogleIdToken(idToken, clientId, keysOverride) {
  try {
    if (!idToken || !clientId) return null;
    const p = String(idToken).split(".");
    if (p.length !== 3) return null;
    const header = _b64urlJson(p[0]), payload = _b64urlJson(p[1]);
    if (header.alg !== "RS256") return null;
    let keys = keysOverride || await googleJwks();
    let jwk = keys.find((k) => k.kid === header.kid);
    if (!jwk && !keysOverride) { _gKeys.exp = 0; keys = await googleJwks(); jwk = keys.find((k) => k.kid === header.kid); }
    if (!jwk) return null;
    const pub = crypto.createPublicKey({ key: jwk, format: "jwk" });
    if (!crypto.verify("RSA-SHA256", Buffer.from(p[0] + "." + p[1]), pub, Buffer.from(p[2], "base64url"))) return null;
    if (!GOOGLE_ISS.includes(payload.iss)) return null;
    if (payload.aud !== clientId) return null;
    const now = Math.floor(Date.now() / 1000);
    if (!payload.exp || payload.exp < now - 60) return null;     // expired (60s skew)
    if (payload.iat && payload.iat > now + 300) return null;     // issued in the future
    return { sub: String(payload.sub), email: payload.email || null, emailVerified: !!payload.email_verified,
      name: payload.name || null, picture: payload.picture || null, nonce: payload.nonce || null };
  } catch { return null; }
}
