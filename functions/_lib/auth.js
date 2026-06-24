// Auth helpers for Cloudflare Pages Functions (Web Crypto, no external service).
// Sessions stored in Neon; password hashing via PBKDF2-SHA256.

const enc = new TextEncoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" }, key, 256);
  return `pbkdf2$100000$${b64(salt)}$${b64(bits)}`;
}

export async function verifyPassword(password, stored) {
  try {
    const [, iter, saltB64, hashB64] = stored.split("$");
    const salt = fromB64(saltB64);
    const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: parseInt(iter, 10), hash: "SHA-256" }, key, 256);
    return b64(bits) === hashB64;
  } catch { return false; }
}

export function newToken() {
  return b64(crypto.getRandomValues(new Uint8Array(32))).replace(/[^a-zA-Z0-9]/g, "").slice(0, 40);
}

export async function createSession(sql, customerId) {
  const token = newToken();
  const expires = new Date(Date.now() + 30 * 864e5).toISOString();
  await sql`insert into sessions (token, customer_id, expires_at) values (${token}, ${customerId}, ${expires})`;
  return token;
}

export function sessionCookie(token) {
  return `sid=${token}; Path=/; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax`;
}
export function clearCookie() {
  return `sid=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

export function getCookie(request, name) {
  const h = request.headers.get("Cookie") || "";
  const m = h.match(new RegExp("(?:^|; )" + name + "=([^;]+)"));
  return m ? decodeURIComponent(m[1]) : null;
}

export async function getSessionCustomer(sql, request) {
  const token = getCookie(request, "sid");
  if (!token) return null;
  const rows = await sql`select c.id, c.email, c.name from sessions s
    join customers c on c.id = s.customer_id
    where s.token = ${token} and s.expires_at > now() limit 1`;
  return rows[0] || null;
}
