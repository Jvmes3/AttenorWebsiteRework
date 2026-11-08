const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const portal = require("../api/_lib/portal");
const assessments = require("../api/_lib/assessments");

process.env.SESSION_SECRET = "portal-test-secret-at-least-thirty-two-random-characters";
process.env.ATTENOR_ASSESSMENT_PREVIEW = "1";
process.env.VERCEL_ENV = "preview";
process.env.SUPABASE_URL = "https://portal-tests.supabase.co";
process.env.SUPABASE_SECRET_KEY = "sb_secret_test_only";
delete process.env.ATTENOR_ASSESSMENT_ADMIN_PASSWORD_HASH;
delete process.env.ATTENOR_PORTAL_STUDENTS_ENABLED;

function cookieHeader(values) {
  return (Array.isArray(values) ? values : [values]).filter(Boolean).filter((value) => !/Max-Age=0(?:;|$)/.test(value)).map((value) => value.split(";")[0]).join("; ");
}

async function call(handler, { method = "GET", body, cookie, query, origin, address = randomUUID() } = {}) {
  const response = { headers: {}, setHeader(name, value) { this.headers[name] = value; }, end(text) { this.body = JSON.parse(text); } };
  await handler({ method, body, query, headers: { host: "localhost:8000", "x-forwarded-for": address, ...(cookie ? { cookie } : {}), ...(origin ? { origin } : {}) } }, response);
  return response;
}

function database(context) {
  const original = global.fetch;
  const rows = [];
  const sessions = [];
  const responses = [];
  const requests = [];
  global.fetch = async (url, options = {}) => {
    const parsed = new URL(url);
    requests.push({ url: parsed, options });
    assert.equal(options.headers.apikey, "sb_secret_test_only");
    assert.equal(options.headers.Authorization, undefined);
    const collections = { "/rest/v1/portal_students": rows, "/rest/v1/portal_assessment_sessions": sessions, "/rest/v1/portal_assessment_responses": responses };
    const collection = collections[parsed.pathname];
    assert.ok(collection, `Unexpected storage table: ${parsed.pathname}`);
    const method = options.method || "GET";
    if (method === "POST") {
      const row = JSON.parse(options.body);
      const duplicate = collection.some((candidate) => candidate.environment === row.environment && (row.id ? candidate.id === row.id : candidate.student_code === row.student_code));
      if (duplicate) return options.headers.Prefer?.includes("resolution=ignore-duplicates") ? Response.json([]) : Response.json({ error: "unique violation" }, { status: 409 });
      const account = { ...row, id: row.id || randomUUID(), created_at: new Date().toISOString(), submitted_at: new Date().toISOString() };
      collection.push(account);
      return Response.json([account], { status: 201 });
    }
    const matches = collection.filter((row) => ["environment", "id", "student_code", "slug", "session_id"].every((field) => !parsed.searchParams.has(field) || parsed.searchParams.get(field) === `eq.${row[field]}`));
    if (method === "PATCH") matches.forEach((row) => Object.assign(row, JSON.parse(options.body)));
    return Response.json(matches);
  };
  context.after(() => { global.fetch = original; });
  return { rows, requests };
}

async function signup(code = "W5-PORTAL-TEST", overrides = {}) {
  return call(portal.handler, { method: "POST", body: { action: "signup", studentCode: code, teacherName: "Practice Teacher", avatar: "fox", password: "Practice26!", ...overrides } });
}

test("student signup stores only a scrypt hash, returns public profile, and issues an HttpOnly role cookie", async (context) => {
  const db = database(context);
  const result = await signup(" w5-portal-test ", { role: "facilitator" });
  assert.equal(result.statusCode, 201);
  assert.equal(result.body.role, "student");
  assert.equal(result.body.profileStorage, "database");
  assert.deepEqual(result.body.profile, { studentCode: "W5-PORTAL-TEST", teacherName: "Practice Teacher", avatar: "fox" });
  assert.equal(result.body.password, undefined);
  assert.equal(result.body.password_hash, undefined);
  assert.equal(db.rows[0].environment, "test");
  assert.match(db.rows[0].password_hash, /^scrypt\$/);
  assert.notEqual(db.rows[0].password_hash, "Practice26!");
  const cookies = result.headers["Set-Cookie"];
  assert.match(cookies[0], /HttpOnly; SameSite=Strict/);
  assert.match(cookies[1], /attenor_assessment_admin=.*Max-Age=0/);
  const token = cookieHeader(cookies).split("=")[1];
  const payload = JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString("utf8"));
  assert.equal(payload.sub, db.rows[0].id);
  assert.equal(payload.environment, "test");
  assert.equal(payload.password_hash, undefined);
  assert.notEqual(payload.revision, db.rows[0].password_hash);
});

test("student can sign in from another browser and receives the current saved avatar", async (context) => {
  const db = database(context);
  await signup();
  db.rows[0].avatar = "panda";
  const login = await call(portal.handler, { method: "POST", body: { action: "signin", studentCode: "w5-portal-test", password: "Practice26!" } });
  assert.equal(login.statusCode, 200);
  assert.equal(login.body.profile.avatar, "panda");
  const current = await call(portal.handler, { cookie: cookieHeader(login.headers["Set-Cookie"]) });
  assert.equal(current.body.authenticated, true);
  assert.equal(current.body.profile.studentCode, "W5-PORTAL-TEST");
  assert.ok(db.requests.filter((entry) => !entry.options.method).every((entry) => entry.url.searchParams.get("environment") === "eq.test"));
  const wrong = await call(portal.handler, { method: "POST", body: { action: "signin", studentCode: "W5-PORTAL-TEST", password: "Incorrect26!" } });
  assert.equal(wrong.statusCode, 401);
  assert.equal(wrong.headers["Set-Cookie"], undefined);
});

test("avatar changes persist to only the signed-in profile and reject arbitrary animal values", async (context) => {
  const db = database(context);
  const first = await signup("FIRST-STUDENT");
  await signup("SECOND-STUDENT", { avatar: "owl" });
  const cookie = cookieHeader(first.headers["Set-Cookie"]);
  const changed = await call(portal.handler, { method: "POST", cookie, body: { action: "profile", studentCode: "SECOND-STUDENT", avatar: "rabbit" } });
  assert.equal(changed.statusCode, 200);
  assert.equal(changed.body.profile.studentCode, "FIRST-STUDENT");
  assert.equal(db.rows[0].avatar, "rabbit");
  assert.equal(db.rows[1].avatar, "owl");
  const invalid = await call(portal.handler, { method: "POST", cookie, body: { action: "profile", avatar: "<script>" } });
  assert.equal(invalid.statusCode, 400);
  const tampered = await call(portal.handler, { cookie: `${cookie}tampered` });
  assert.equal(tampered.body.authenticated, false);
});

test("student role is enforced by APIs even if a stale facilitator cookie is present", async (context) => {
  database(context);
  const student = await signup();
  const facilitator = await call(portal.handler, { method: "POST", body: { action: "facilitator", password: "Facilitator26!" } });
  assert.equal(facilitator.statusCode, 200);
  const cookie = `${cookieHeader(student.headers["Set-Cookie"])}; ${cookieHeader(facilitator.headers["Set-Cookie"])}`;
  const identity = await call(portal.handler, { cookie });
  assert.equal(identity.body.role, "student");
  const admin = await call(assessments.admin, { cookie });
  assert.equal(admin.statusCode, 403);
  const leadership = await call(assessments.session, { cookie, query: { session: "leadership-demo" } });
  assert.equal(leadership.statusCode, 403);
  const catalog = await call(assessments.session, { cookie, query: { catalog: "1" } });
  assert.equal(catalog.statusCode, 200);
  assert.ok(catalog.body.sessions.every((session) => session.type === "benchmark" && session.status === "open" && session.benchmark === 1));
});

test("facilitator password grants existing admin access and clears any student session", async (context) => {
  database(context);
  const denied = await call(portal.handler, { method: "POST", body: { action: "facilitator", password: "wrong" } });
  assert.equal(denied.statusCode, 401);
  const login = await call(portal.handler, { method: "POST", body: { action: "facilitator", password: "Facilitator26!" } });
  assert.equal(login.body.role, "facilitator");
  assert.equal(login.body.profile, null);
  assert.match(login.headers["Set-Cookie"][1], /attenor_portal_student=.*Max-Age=0/);
  const cookie = cookieHeader(login.headers["Set-Cookie"]);
  const current = await call(portal.handler, { cookie });
  assert.equal(current.body.role, "facilitator");
  const admin = await call(assessments.admin, { cookie });
  assert.equal(admin.statusCode, 200);
  const logout = await call(portal.handler, { method: "POST", cookie, body: { action: "logout" } });
  assert.equal(logout.body.authenticated, false);
  assert.ok(logout.headers["Set-Cookie"].every((value) => /Max-Age=0/.test(value)));
});

test("signup validation and cross-site requests cannot create profiles", async (context) => {
  const db = database(context);
  for (const overrides of [{ avatar: "invalid" }, { password: "short" }, { studentCode: "invalid code" }, { teacherName: " " }]) {
    const result = await signup("VALID-CODE", overrides);
    assert.equal(result.statusCode, 400);
  }
  const crossSite = await call(portal.handler, { method: "POST", origin: "https://other.example", body: { action: "signup", studentCode: "VALID-CODE", teacherName: "Teacher", avatar: "fox", password: "Practice26!" } });
  assert.equal(crossSite.statusCode, 403);
  assert.equal(db.rows.length, 0);
});

test("database failures never report a completed signup or avatar save", async (context) => {
  const original = global.fetch;
  context.after(() => { global.fetch = original; });
  global.fetch = async () => Response.json({ error: "storage down" }, { status: 503 });
  const failed = await signup();
  assert.equal(failed.statusCode, 503);
  assert.equal(failed.body.authenticated, undefined);
  assert.equal(failed.headers["Set-Cookie"], undefined);
});

test("production does not enable student accounts with a preview flag and test cookies cannot cross environments", async (context) => {
  database(context);
  const created = await signup();
  process.env.VERCEL_ENV = "production";
  context.after(() => { process.env.VERCEL_ENV = "preview"; });
  const blocked = await signup("PRODUCTION-CODE");
  assert.equal(blocked.statusCode, 503);
  const identity = await call(portal.handler, { cookie: cookieHeader(created.headers["Set-Cookie"]) });
  assert.equal(identity.body.authenticated, false);
});
