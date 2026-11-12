const { readJson, sendJson, verifyPassword } = require("./http");
const { previewEnabled } = require("./portal-store");
const { isWaymanHost } = require("./wayman");
const IDENTITY = Symbol("attenorFacilitator");
const attempts = new Map();
class PortalError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
function authHelpers() { return require("./assessments").facilitatorAuth; }
function clearStudentCookie(request) {
  const secure = process.env.VERCEL || request.headers?.["x-forwarded-proto"] === "https" ? "; Secure" : "";
  return `attenor_portal_student=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`;
}
async function currentPortal(request) {
  if (isWaymanHost(request)) return null;
  if (request[IDENTITY] !== undefined) return request[IDENTITY];
  try {
    authHelpers().requireAdmin(request);
    request[IDENTITY] = { authenticated: true, role: "facilitator", profile: null, mode: previewEnabled() ? "preview" : "connected", profileStorage: null };
  } catch { request[IDENTITY] = null; }
  return request[IDENTITY];
}
async function requireRole(request, role) {
  const identity = await currentPortal(request);
  if (!identity) throw new PortalError(401, "Facilitator sign-in is required.");
  if (role !== "facilitator") throw new PortalError(403, "Student accounts are no longer used. Open the Wayman benchmark page instead.");
  return identity;
}
async function requireStudent() { throw new PortalError(410, "Student accounts are no longer used. Open the Wayman benchmark page instead."); }
function checkOrigin(request) {
  if (request.headers?.["sec-fetch-site"] === "cross-site") throw new PortalError(403, "Open the facilitator portal on this website to continue.");
  if (!request.headers?.origin) return;
  try {
    const origin = new URL(request.headers.origin);
    if (!["http:", "https:"].includes(origin.protocol) || origin.host !== request.headers.host) throw new Error("origin");
  } catch { throw new PortalError(403, "Open the facilitator portal on this website to continue."); }
}
function limitAttempts(request) {
  const now = Date.now();
  for (const [key, entry] of attempts) if (entry.until < now) attempts.delete(key);
  const key = String(request.headers?.["x-forwarded-for"] || request.socket?.remoteAddress || "unknown").slice(0, 120);
  const entry = attempts.get(key) || { count: 0, until: now + 15 * 60 * 1000 };
  if (entry.count >= 20 || attempts.size > 4000) throw new PortalError(429, "Too many sign-in attempts. Please wait 15 minutes and try again.");
  attempts.set(key, { ...entry, count: entry.count + 1 });
}
async function handler(request, response) {
  try {
    if (isWaymanHost(request)) throw new PortalError(404, "This page is not part of the Wayman benchmark site.");
    if (request.method === "GET") {
      const identity = await currentPortal(request);
      const retiredStudent = !identity && String(request.headers?.cookie || "").split(";").some((entry) => entry.trim().startsWith("attenor_portal_student="));
      if (retiredStudent) response.setHeader("Set-Cookie", clearStudentCookie(request));
      return sendJson(response, 200, identity || { authenticated: false, role: null, profile: null, waymanEntry: retiredStudent, mode: previewEnabled() ? "preview" : "connected" });
    }
    if (request.method !== "POST") { response.setHeader("Allow", "GET, POST"); throw new PortalError(405, "Method not allowed."); }
    checkOrigin(request);
    let body;
    try { body = await readJson(request); } catch { throw new PortalError(400, "Check your details and try again."); }
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new PortalError(400, "Check your details and try again.");
    const auth = authHelpers();
    if (body.action === "logout") {
      response.setHeader("Set-Cookie", [auth.cookie(request, auth.cookieName(), "", 0), clearStudentCookie(request)]);
      return sendJson(response, 200, { authenticated: false, role: null, profile: null });
    }
    if (["signup", "signin", "profile"].includes(body.action)) throw new PortalError(410, "Student accounts and avatars are no longer used. Open the Wayman benchmark page instead.");
    if (body.action !== "facilitator") throw new PortalError(400, "Enter your facilitator password to continue.");
    limitAttempts(request);
    if (typeof body.password !== "string" || body.password.length > 200 || !verifyPassword(body.password, auth.adminHash())) throw new PortalError(401, "The facilitator password is incorrect.");
    response.setHeader("Set-Cookie", [auth.cookie(request, auth.cookieName(), auth.signedToken("admin", "facilitator", auth.signature(auth.adminHash()))), clearStudentCookie(request)]);
    return sendJson(response, 200, { authenticated: true, role: "facilitator", profile: null, mode: previewEnabled() ? "preview" : "connected" });
  } catch (error) {
    if (!error.status) console.error("Facilitator portal failed", error.name);
    return sendJson(response, error.status || 503, { error: error.status ? error.message : "Facilitator access is temporarily unavailable. Please try again." });
  }
}
module.exports = { handler, currentPortal, requireRole, requireStudent };
