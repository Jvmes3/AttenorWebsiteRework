const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const portal = require("../api/_lib/portal");
const assessments = require("../api/_lib/assessments");
const store = require("../api/_lib/assessment-store");
process.env.SESSION_SECRET = "facilitator-test-secret-at-least-thirty-two-characters";
process.env.ATTENOR_ASSESSMENT_PREVIEW = "1";
process.env.VERCEL_ENV = "preview";
delete process.env.ATTENOR_ASSESSMENT_ADMIN_PASSWORD_HASH;

function cookies(values) {
  return (Array.isArray(values) ? values : [values]).filter(Boolean).filter((value) => !value.includes("Max-Age=0")).map((value) => value.split(";")[0]).join("; ");
}
async function call(handler, { method = "GET", body, cookie, host = "localhost:8000", origin } = {}) {
  const response = { headers: {}, setHeader(name, value) { this.headers[name] = value; }, end(text) { this.body = JSON.parse(text); } };
  await handler({ method, body, headers: { host, "x-forwarded-for": randomUUID(), ...(cookie ? { cookie } : {}), ...(origin ? { origin } : {}) } }, response);
  return response;
}
test("facilitator password and workspace access remain available without student profiles", async (context) => {
  context.mock.method(store, "available", () => false);
  const wrong = await call(portal.handler, { method: "POST", body: { action: "facilitator", password: "wrong" } });
  assert.equal(wrong.statusCode, 401);
  const login = await call(portal.handler, { method: "POST", body: { action: "facilitator", password: "Facilitator26!" } });
  assert.equal(login.statusCode, 200);
  assert.equal(login.body.role, "facilitator");
  assert.equal(login.body.profile, null);
  assert.match(login.headers["Set-Cookie"][0], /HttpOnly; SameSite=Strict/);
  const cookie = cookies(login.headers["Set-Cookie"]);
  const identity = await call(portal.handler, { cookie });
  assert.equal(identity.body.authenticated, true);
  const workspace = await call(assessments.admin, { cookie });
  assert.equal(workspace.statusCode, 200);
  assert.ok(workspace.body.sessions.some((session) => session.type === "leadership"));
  const logout = await call(portal.handler, { method: "POST", cookie, body: { action: "logout" } });
  assert.equal(logout.body.authenticated, false);
  assert.ok(logout.headers["Set-Cookie"].every((value) => value.includes("Max-Age=0")));
});
test("student registration, sign-in, and avatar changes are retired without touching the database", async (context) => {
  const fetch = context.mock.method(global, "fetch", () => { throw new Error("Student records must not be read or written"); });
  for (const action of ["signup", "signin", "profile"]) {
    const result = await call(portal.handler, { method: "POST", body: { action, studentCode: "0017", password: "unused", avatar: "fox" } });
    assert.equal(result.statusCode, 410);
    assert.equal(result.body.authenticated, undefined);
    assert.equal(result.headers["Set-Cookie"], undefined);
  }
  assert.equal(fetch.mock.callCount(), 0);
});
test("retired student cookies return the separate Wayman entry and never grant facilitator access", async (context) => {
  const fetch = context.mock.method(global, "fetch", () => { throw new Error("No student profile lookup"); });
  const result = await call(portal.handler, { cookie: "attenor_portal_student=retired-token" });
  assert.equal(result.body.authenticated, false);
  assert.equal(result.body.waymanEntry, true);
  assert.match(result.headers["Set-Cookie"], /Max-Age=0/);
  assert.equal(fetch.mock.callCount(), 0);
});
test("the Wayman hostname does not serve consulting authentication or facilitator APIs", async () => {
  const login = await call(portal.handler, { method: "POST", body: { action: "facilitator", password: "Facilitator26!" } });
  const cookie = cookies(login.headers["Set-Cookie"]);
  const publicHost = await call(portal.handler, { host: "wayman.attenorcollab.com", cookie });
  assert.equal(publicHost.statusCode, 404);
  const workspace = await call(assessments.admin, { host: "wayman.attenorcollab.com", cookie });
  assert.equal(workspace.statusCode, 404);
});
test("cross-site facilitator sign-in cannot issue cookies and test credentials stay disabled in production", async (context) => {
  const rejected = await call(portal.handler, { method: "POST", origin: "https://elsewhere.example", body: { action: "facilitator", password: "Facilitator26!" } });
  assert.equal(rejected.statusCode, 403);
  assert.equal(rejected.headers["Set-Cookie"], undefined);
  process.env.VERCEL_ENV = "production";
  context.after(() => { process.env.VERCEL_ENV = "preview"; });
  const production = await call(portal.handler, { method: "POST", body: { action: "facilitator", password: "Facilitator26!" } });
  assert.equal(production.statusCode, 503);
});
