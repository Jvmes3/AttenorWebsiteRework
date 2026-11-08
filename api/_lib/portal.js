const { createHmac, randomBytes, scryptSync, timingSafeEqual } = require("node:crypto");
const { readJson, sendJson, verifyPassword } = require("./http");
const store = require("./portal-store");

const AVATARS = Object.freeze(["fox", "owl", "bear", "rabbit", "panda", "cat", "dog", "tiger"]);
const SESSION_COOKIE = "attenor_portal_student";
const SESSION_AGE = 60 * 60 * 8;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const attempts = new Map();
const IDENTITY = Symbol("attenorPortalIdentity");

class PortalError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function studentAccountsEnabled() {
  return store.previewEnabled() || process.env.ATTENOR_PORTAL_STUDENTS_ENABLED === "1";
}

function secret() {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) throw new PortalError(503, "Portal access has not been configured yet.");
  return value;
}
function signature(value) { return createHmac("sha256", secret()).update(`attenor-portal:${value}`).digest("base64url"); }
function equal(left, right) {
  const a = Buffer.from(String(left)); const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
}
function revision(account) { return signature(account.password_hash); }
function authHelpers() { return require("./assessments").facilitatorAuth; }
function publicProfile(account) { return { studentCode: account.student_code, teacherName: account.teacher_name, avatar: account.avatar }; }
function cookie(request, value, age = SESSION_AGE) {
  const secure = process.env.VERCEL || request.headers?.["x-forwarded-proto"] === "https" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${secure}`;
}
function signedToken(account) {
  const payload = Buffer.from(JSON.stringify({ purpose: "student", sub: account.id, environment: store.environment(), revision: revision(account), exp: Math.floor(Date.now() / 1000) + SESSION_AGE })).toString("base64url");
  return `${payload}.${signature(payload)}`;
}
function readToken(request) {
  try {
    const entry = String(request.headers?.cookie || "").split(";").map((part) => part.trim()).find((part) => part.startsWith(`${SESSION_COOKIE}=`));
    if (!entry || entry.length > 3000) return null;
    const parts = decodeURIComponent(entry.slice(SESSION_COOKIE.length + 1)).split(".");
    if (parts.length !== 2 || !equal(signature(parts[0]), parts[1])) return null;
    const token = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    if (token.purpose !== "student" || !UUID.test(token.sub) || token.environment !== store.environment() || !Number.isFinite(token.exp) || token.exp <= Date.now() / 1000) return null;
    return token;
  } catch { return null; }
}

async function findStudent(field, value) {
  const query = new URLSearchParams({ select: "id,student_code,teacher_name,avatar,password_hash", environment: `eq.${store.environment()}`, [field]: `eq.${value}`, limit: "1" });
  const rows = await store.request(`/rest/v1/portal_students?${query}`);
  if (!Array.isArray(rows)) throw new PortalError(503, "Student profiles are temporarily unavailable.");
  return rows[0] || null;
}

async function resolvePortal(request) {
  const token = studentAccountsEnabled() ? readToken(request) : null;
  if (token) {
    const account = await findStudent("id", token.sub);
    if (account && equal(token.revision, revision(account))) return { authenticated: true, role: "student", participantId: account.id, profile: publicProfile(account), mode: store.previewEnabled() ? "preview" : "connected", profileStorage: "database" };
  }
  try {
    authHelpers().requireAdmin(request);
    return { authenticated: true, role: "facilitator", profile: null, mode: store.previewEnabled() ? "preview" : "connected", profileStorage: null };
  } catch { return null; }
}

async function currentPortal(request) {
  request[IDENTITY] ||= resolvePortal(request);
  return request[IDENTITY];
}

async function requireRole(request, role) {
  const identity = await currentPortal(request);
  if (!identity) throw new PortalError(401, "Sign in to the portal to continue.");
  if (identity.role !== role) throw new PortalError(403, role === "student" ? "Student profiles are available from the student portal." : "This part of the portal is for facilitators.");
  return identity;
}
async function requireStudent(request) { return requireRole(request, "student"); }
function setStudentCookies(request, response, account) {
  const auth = authHelpers();
  response.setHeader("Set-Cookie", [cookie(request, signedToken(account)), auth.cookie(request, auth.cookieName(), "", 0)]);
}
function checkOrigin(request) {
  if (request.headers?.["sec-fetch-site"] === "cross-site") throw new PortalError(403, "Open the portal on this website to continue.");
  const origin = request.headers?.origin;
  if (!origin) return;
  try {
    const url = new URL(origin);
    if (!["http:", "https:"].includes(url.protocol) || url.host !== request.headers?.host) throw new Error("origin");
  } catch { throw new PortalError(403, "Open the portal on this website to continue."); }
}
function limitAttempts(request, action) {
  const address = String(request.headers?.["x-forwarded-for"] || request.socket?.remoteAddress || "unknown").slice(0, 120);
  const key = `${address}:${action}`;
  const now = Date.now();
  if (attempts.size > 2000) {
    for (const [id, entry] of attempts) if (entry.expires < now) attempts.delete(id);
    if (attempts.size > 4000) throw new PortalError(429, "The portal is busy. Please try again shortly.");
  }
  const prior = attempts.get(key);
  if (prior && prior.expires > now && prior.count >= 20) throw new PortalError(429, "Too many sign-in attempts. Please wait 15 minutes and try again.");
  attempts.set(key, prior && prior.expires > now ? { ...prior, count: prior.count + 1 } : { count: 1, expires: now + 15 * 60 * 1000 });
}
function studentCode(value) {
  const code = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (!/^[A-Z0-9][A-Z0-9_-]{1,79}$/.test(code)) throw new PortalError(400, "Enter your student code using letters, numbers, underscores, or dashes.");
  return code;
}
function teacherName(value) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 120) throw new PortalError(400, "Enter your teacher’s name.");
  return value.trim();
}
function avatar(value) {
  if (!AVATARS.includes(value)) throw new PortalError(400, "Choose an animal avatar from the list.");
  return value;
}
async function bodyFor(request) {
  try {
    const body = await readJson(request);
    if (!body || Array.isArray(body) || typeof body !== "object" || JSON.stringify(body).length > 20000) throw new Error("body");
    return body;
  } catch { throw new PortalError(400, "Check your details and try again."); }
}

async function handler(request, response) {
  try {
    if (request.method === "GET") {
      const identity = await currentPortal(request);
      const publicIdentity = identity && { authenticated: identity.authenticated, role: identity.role, profile: identity.profile, mode: identity.mode, profileStorage: identity.profileStorage };
      return sendJson(response, 200, publicIdentity || { authenticated: false, role: null, profile: null, mode: store.previewEnabled() ? "preview" : "connected", profileStorage: "database" });
    }
    if (request.method !== "POST") {
      response.setHeader("Allow", "GET, POST");
      throw new PortalError(405, "Method not allowed.");
    }
    checkOrigin(request);
    const body = await bodyFor(request);
    if (body.action === "logout") {
      const auth = authHelpers();
      response.setHeader("Set-Cookie", [cookie(request, "", 0), auth.cookie(request, auth.cookieName(), "", 0)]);
      return sendJson(response, 200, { authenticated: false, role: null, profile: null, mode: store.previewEnabled() ? "preview" : "connected" });
    }
    if (body.action === "facilitator") {
      limitAttempts(request, "facilitator");
      const auth = authHelpers();
      if (typeof body.password !== "string" || body.password.length > 200 || !verifyPassword(body.password, auth.adminHash())) throw new PortalError(401, "The facilitator password is incorrect.");
      response.setHeader("Set-Cookie", [auth.cookie(request, auth.cookieName(), auth.signedToken("admin", "facilitator", auth.signature(auth.adminHash()))), cookie(request, "", 0)]);
      return sendJson(response, 200, { authenticated: true, role: "facilitator", profile: null, mode: store.previewEnabled() ? "preview" : "connected", profileStorage: null });
    }
    if (!["signup", "signin", "profile"].includes(body.action)) throw new PortalError(400, "Choose a sign-in option to continue.");
    if (!studentAccountsEnabled()) throw new PortalError(503, "Student accounts are not connected yet. Please check with your teacher.");
    if (body.action === "profile") {
      await requireStudent(request);
      const token = readToken(request);
      const query = new URLSearchParams({ environment: `eq.${store.environment()}`, id: `eq.${token.sub}`, select: "id,student_code,teacher_name,avatar,password_hash" });
      const rows = await store.request(`/rest/v1/portal_students?${query}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ avatar: avatar(body.avatar), updated_at: new Date().toISOString() }) });
      if (!Array.isArray(rows) || rows.length !== 1) throw new PortalError(503, "Your avatar change could not be confirmed. Please try again.");
      setStudentCookies(request, response, rows[0]);
      return sendJson(response, 200, { authenticated: true, role: "student", profile: publicProfile(rows[0]), mode: store.previewEnabled() ? "preview" : "connected", profileStorage: "database" });
    }
    limitAttempts(request, "student");
    const code = studentCode(body.studentCode);
    if (typeof body.password !== "string" || body.password.length < 8 || body.password.length > 128) throw new PortalError(400, "Use a password with 8–128 characters.");
    let account;
    if (body.action === "signup") {
      const salt = randomBytes(16).toString("base64url");
      const row = { environment: store.environment(), student_code: code, teacher_name: teacherName(body.teacherName), avatar: avatar(body.avatar), password_hash: `scrypt$${salt}$${scryptSync(body.password, salt, 64).toString("base64url")}` };
      let rows;
      try { rows = await store.request("/rest/v1/portal_students?select=id,student_code,teacher_name,avatar,password_hash", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(row) }); }
      catch (error) { if (error.code === 409) throw new PortalError(409, "That student code is already registered. Choose student sign in or check with your teacher."); throw error; }
      if (!Array.isArray(rows) || rows.length !== 1 || !UUID.test(rows[0].id)) throw new PortalError(503, "Your student profile could not be confirmed. Please check with your teacher.");
      account = rows[0];
    } else {
      account = await findStudent("student_code", code);
      if (!account || !verifyPassword(body.password, account.password_hash)) throw new PortalError(401, "The student code or password is incorrect.");
    }
    setStudentCookies(request, response, account);
    return sendJson(response, body.action === "signup" ? 201 : 200, { authenticated: true, role: "student", profile: publicProfile(account), mode: store.previewEnabled() ? "preview" : "connected", profileStorage: "database" });
  } catch (error) {
    if (!(error instanceof PortalError) && !error.status) console.error("Portal endpoint failed", error.name);
    return sendJson(response, error.status || 503, { error: error.message && (error instanceof PortalError || error.status) ? error.message : "Portal access is temporarily unavailable. Please try again." });
  }
}

module.exports = { handler, currentPortal, requireRole, requireStudent, AVATARS };
