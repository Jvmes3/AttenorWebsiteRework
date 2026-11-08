const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID, scryptSync } = require("node:crypto");
const api = require("../api/_lib/assessments");

process.env.SESSION_SECRET = "assessment-tests-secret-at-least-thirty-two-characters";
process.env.ATTENOR_ASSESSMENT_PREVIEW = "1";
process.env.VERCEL_ENV = "preview";
delete process.env.ATTENOR_ASSESSMENT_SESSIONS_JSON;
delete process.env.ATTENOR_ASSESSMENT_ADMIN_PASSWORD_HASH;
delete process.env.WAYMAN_SUPABASE_URL;
delete process.env.WAYMAN_SUPABASE_KEY;
delete process.env.WAYMAN_SUBMIT_RPC;

async function call(handler, { method = "GET", body, query, cookie, origin } = {}) {
  const response = { headers: {}, setHeader(name, value) { this.headers[name] = value; }, end(value) { this.body = JSON.parse(value); } };
  await handler({ method, body, query, headers: { host: "localhost:8000", ...(cookie ? { cookie } : {}), ...(origin ? { origin } : {}) } }, response);
  return response;
}
async function participant(slug = "leadership-demo", password = "Coherence26!") {
  const response = await call(api.access, { method: "POST", body: { session: slug, password } });
  assert.equal(response.statusCode, 200);
  return response.headers["Set-Cookie"];
}
async function administrator() {
  const response = await call(api.admin, { method: "POST", body: { action: "login", password: "Facilitator26!" } });
  assert.equal(response.statusCode, 200);
  return response.headers["Set-Cookie"];
}
function ratings() {
  return ["Strategic Clarity", "Leadership Alignment", "Enabling Conditions", "Capacity Building", "Data Use", "Community Engagement", "Accountability Systems", "Foresight Readiness"].map((dimension) => ({ dimension, score: 3, explanation: "We have evidence to discuss with the team." }));
}
function configureWayman(context) {
  const originalFetch = global.fetch;
  process.env.WAYMAN_SUPABASE_URL = "https://example.supabase.co";
  process.env.WAYMAN_SUPABASE_KEY = "server-only-test-key";
  context.after(() => { global.fetch = originalFetch; delete process.env.WAYMAN_SUPABASE_URL; delete process.env.WAYMAN_SUPABASE_KEY; delete process.env.WAYMAN_SUBMIT_RPC; });
}
const question = { id: 7, question_number: 1, question_text: "An actual configured question", choice_a: "A", choice_b: "B", choice_c: "C", choice_d: "D", standard_code: "SC.5", standard_domain: "Science", correct_answer: "C", explanation: "Must not be exposed before submission." };

test("preview access uses scoped server-only cookies and never exposes password hashes", async () => {
  const wrong = await call(api.access, { method: "POST", body: { session: "leadership-demo", password: "wrong" } });
  assert.equal(wrong.statusCode, 401);
  const cookie = await participant();
  assert.match(cookie, /HttpOnly; SameSite=Strict/);
  const metadata = await call(api.session, { query: { session: "leadership-demo" }, cookie });
  assert.equal(metadata.body.authorized, true);
  assert.equal(metadata.body.session.passwordHash, undefined);
  const different = await call(api.session, { query: { session: "benchmark-1" }, cookie });
  assert.equal(different.body.authorized, false);
  assert.equal(different.body.session.status, "open");
  assert.equal(different.body.mode, "preview");
  const admin = await call(api.admin, { cookie });
  assert.equal(admin.statusCode, 401);
});

test("production cannot use preview passwords or preview session storage", async (context) => {
  process.env.VERCEL_ENV = "production";
  context.after(() => { process.env.VERCEL_ENV = "preview"; });
  const metadata = await call(api.session, { query: { session: "leadership-demo" } });
  assert.equal(metadata.statusCode, 404);
  const login = await call(api.admin, { method: "POST", body: { action: "login", password: "Facilitator26!" } });
  assert.equal(login.statusCode, 503);
});

test("cross-site access requests are rejected before a cookie is issued", async () => {
  const response = await call(api.access, { method: "POST", body: { session: "leadership-demo", password: "Coherence26!" }, origin: "https://other.example" });
  assert.equal(response.statusCode, 403);
  assert.equal(response.headers["Set-Cookie"], undefined);
});

test("leadership validation requires every dimension once with an explanation", async () => {
  const cookie = await participant();
  for (const invalid of [ratings().slice(1), ratings().map((rating, i) => i ? rating : { ...rating, score: 6 }), ratings().map((rating, i) => i ? rating : { ...rating, explanation: " " })]) {
    const response = await call(api.submit, { method: "POST", cookie, body: { session: "leadership-demo", submissionId: randomUUID(), ratings: invalid } });
    assert.equal(response.statusCode, 400);
  }
});

test("leadership retry returns the same preview receipt and counts only one response", async () => {
  const cookie = await participant();
  const admin = await administrator();
  const before = await call(api.admin, { cookie: admin });
  const countBefore = before.body.sessions.find((session) => session.slug === "leadership-demo").responseCount;
  const body = { session: "leadership-demo", submissionId: randomUUID(), ratings: ratings() };
  const first = await call(api.submit, { method: "POST", cookie, body });
  const retry = await call(api.submit, { method: "POST", cookie, body });
  assert.equal(first.statusCode, 200);
  assert.equal(first.body.mode, "preview");
  assert.deepEqual(retry.body.receipt, first.body.receipt);
  const after = await call(api.admin, { cookie: admin });
  assert.equal(after.body.sessions.find((session) => session.slug === "leadership-demo").responseCount, countBefore + 1);
  const changed = await call(api.submit, { method: "POST", cookie, body: { ...body, ratings: ratings().map((rating) => ({ ...rating, score: 4 })) } });
  assert.equal(changed.statusCode, 409);
});

test("session creation requires facilitator access and generates a new password", async () => {
  const participantCookie = await participant();
  const body = { action: "create", name: "Team reflection", organization: "Example School", expectedParticipants: 8 };
  const denied = await call(api.admin, { method: "POST", cookie: participantCookie, body });
  assert.equal(denied.statusCode, 401);
  const admin = await administrator();
  const created = await call(api.admin, { method: "POST", cookie: admin, body });
  assert.equal(created.statusCode, 201);
  assert.match(created.body.session.slug, /^coherence-/);
  assert.ok(created.body.password.length >= 16);
  assert.equal(created.body.session.passwordHash, undefined);
  await participant(created.body.session.slug, created.body.password);
  const unauthorized = await call(api.session, { query: { session: created.body.session.slug }, cookie: participantCookie });
  assert.equal(unauthorized.body.authorized, false);
});

test("Wayman questions require session access and exclude answer keys", async (context) => {
  configureWayman(context);
  let requested;
  global.fetch = async (url) => { requested = url; return Response.json([question]); };
  const unauthorized = await call(api.questions, { query: { session: "benchmark-1" } });
  assert.equal(unauthorized.statusCode, 401);
  assert.equal(requested, undefined);
  const cookie = await participant("benchmark-1", "Eagles_FY26!");
  const response = await call(api.questions, { query: { session: "benchmark-1" }, cookie });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.questions[0].correct_answer, undefined);
  assert.equal(response.body.questions[0].explanation, undefined);
  assert.match(requested, /assessment_id=eq.1/);
  assert.doesNotMatch(requested, /correct_answer/);
});

test("production Wayman submit fails closed without an atomic persistence adapter", async (context) => {
  configureWayman(context);
  process.env.VERCEL_ENV = "production";
  process.env.ATTENOR_ASSESSMENT_SESSIONS_JSON = JSON.stringify([{ id: "benchmark-1", slug: "benchmark-1", name: "Benchmark 1", organization: "Wayman", type: "benchmark", benchmark: 1, passwordHash: `scrypt$production-test$${scryptSync("Eagles_FY26!", "production-test", 64).toString("base64url")}` }]);
  context.after(() => { process.env.VERCEL_ENV = "preview"; delete process.env.ATTENOR_ASSESSMENT_SESSIONS_JSON; });
  let requests = 0;
  global.fetch = async () => { requests++; throw new Error("must not write"); };
  const cookie = await participant("benchmark-1", "Eagles_FY26!");
  const result = await call(api.submit, { method: "POST", cookie, body: { session: "benchmark-1", submissionId: randomUUID(), studentCode: "TEST", teacherName: "Test Teacher", answers: [{ questionId: 7, answer: "A" }] } });
  assert.equal(result.statusCode, 503);
  assert.equal(result.body.receipt, undefined);
  assert.equal(requests, 0);
});

test("preview Wayman completion validates answers, saves in memory, and deduplicates retries without remote writes", async (context) => {
  configureWayman(context);
  process.env.WAYMAN_SUBMIT_RPC = "save_wayman_assessment";
  const methods = [];
  global.fetch = async (url, options) => { methods.push(options.method || "GET"); return Response.json([question]); };
  const cookie = await participant("benchmark-1", "Eagles_FY26!");
  const body = { session: "benchmark-1", submissionId: randomUUID(), studentCode: "PREVIEW", teacherName: "Preview Teacher", answers: [{ questionId: 7, answer: "B" }] };
  const metadata = await call(api.session, { query: { session: "benchmark-1" }, cookie });
  assert.equal(metadata.body.mode, "preview");
  const invalid = await call(api.submit, { method: "POST", cookie, body: { ...body, answers: [{ questionId: 999, answer: "B" }] } });
  assert.equal(invalid.statusCode, 400);
  const first = await call(api.submit, { method: "POST", cookie, body });
  const retry = await call(api.submit, { method: "POST", cookie, body });
  assert.equal(first.statusCode, 200);
  assert.equal(first.body.mode, "preview");
  assert.deepEqual(first.body.receipt, retry.body.receipt);
  process.env.WAYMAN_SUBMIT_RPC = "malformed/rpc";
  const withMalformedRpc = await call(api.submit, { method: "POST", cookie, body });
  assert.equal(withMalformedRpc.statusCode, 200);
  assert.equal(withMalformedRpc.body.mode, "preview");
  assert.deepEqual(withMalformedRpc.body.receipt, first.body.receipt);
  const changed = await call(api.submit, { method: "POST", cookie, body: { ...body, studentCode: "DIFFERENT" } });
  assert.equal(changed.statusCode, 409);
  const admin = await administrator();
  const sessions = await call(api.admin, { cookie: admin });
  assert.equal(sessions.body.sessions.find((session) => session.slug === "benchmark-1").responseCount, 1);
  assert.ok(methods.every((method) => method === "GET"));
});

test("configured Wayman RPC receives validated answers and never reports failed writes as saved", async (context) => {
  configureWayman(context);
  process.env.VERCEL_ENV = "production";
  process.env.ATTENOR_ASSESSMENT_SESSIONS_JSON = JSON.stringify([{ id: "benchmark-1", slug: "benchmark-1", name: "Benchmark 1", organization: "Wayman", type: "benchmark", benchmark: 1, passwordHash: `scrypt$production-rpc-test$${scryptSync("Eagles_FY26!", "production-rpc-test", 64).toString("base64url")}` }]);
  context.after(() => { process.env.VERCEL_ENV = "preview"; delete process.env.ATTENOR_ASSESSMENT_SESSIONS_JSON; });
  process.env.WAYMAN_SUBMIT_RPC = "save_wayman_assessment";
  const submissionId = randomUUID();
  const cookie = await participant("benchmark-1", "Eagles_FY26!");
  const body = { session: "benchmark-1", submissionId, studentCode: "TEST", teacherName: "Test Teacher", answers: [{ questionId: 7, answer: "A" }] };
  let rpcPayload;
  global.fetch = async (url, options) => {
    if (options.method === "POST") { rpcPayload = JSON.parse(options.body); return Response.json({ error: "storage unavailable" }, { status: 503 }); }
    return Response.json([question]);
  };
  const failed = await call(api.submit, { method: "POST", cookie, body });
  assert.equal(failed.statusCode, 503);
  assert.equal(failed.body.receipt, undefined);
  assert.equal(rpcPayload.p_submission_id, submissionId);
  assert.deepEqual(rpcPayload.p_answers, [{ question_id: 7, selected_answer: "A" }]);
  assert.equal(rpcPayload.p_teacher_name, "Test Teacher");
  global.fetch = async (url, options) => options.method === "POST" ? Response.json({ id: submissionId, submittedAt: new Date().toISOString() }) : Response.json([question]);
  const saved = await call(api.submit, { method: "POST", cookie, body });
  assert.equal(saved.statusCode, 200);
  assert.equal(saved.body.receipt.id, submissionId);
  assert.equal(saved.body.mode, "connected");
});

function durableStore(context, { sessions = [], responses = [] } = {}) {
  const store = require("../api/_lib/assessment-store");
  const methods = ["available", "listSessions", "ensureSession", "createSession", "saveResponse", "listResponses"];
  const originals = Object.fromEntries(methods.map((method) => [method, store[method]]));
  context.after(() => Object.assign(store, originals));
  store.available = () => true;
  store.listSessions = async () => [...sessions];
  store.ensureSession = async (session) => { sessions.push(session); return session; };
  store.createSession = async (session) => { sessions.push(session); return session; };
  store.saveResponse = async (response) => {
    const receipt = { id: response.id, submittedAt: "2026-11-07T21:00:00.000Z" };
    responses.push({ ...response, submittedAt: receipt.submittedAt });
    return receipt;
  };
  store.listResponses = async (sessionId) => responses.filter((response) => response.sessionId === sessionId);
  return { store, sessions, responses };
}

test("configured portal storage persists leadership and benchmark responses instead of using memory", async (context) => {
  const fixture = durableStore(context);
  const cookie = await participant();
  const submissionId = randomUUID();
  const leadership = await call(api.submit, { method: "POST", cookie, body: { session: "leadership-demo", submissionId, ratings: ratings() } });
  assert.equal(leadership.statusCode, 200);
  assert.equal(leadership.body.storage, "database");
  assert.equal(fixture.responses[0].sessionId, "leadership-demo");
  assert.equal(fixture.responses[0].payload.ratings.length, 8);
  const benchmarkCookie = await participant("benchmark-1", "Eagles_FY26!");
  const questions = await call(api.questions, { query: { session: "benchmark-1" }, cookie: benchmarkCookie });
  assert.equal(questions.body.questions.length, 7);
  const benchmark = await call(api.submit, { method: "POST", cookie: benchmarkCookie, body: { session: "benchmark-1", submissionId: randomUUID(), studentCode: "TEST", teacherName: "Practice Teacher", answers: questions.body.questions.map((question) => ({ questionId: question.id, answer: "A" })) } });
  assert.equal(benchmark.statusCode, 200);
  assert.equal(benchmark.body.storage, "database");
  assert.equal(fixture.responses[1].payload.teacherName, "Practice Teacher");
  assert.equal(fixture.responses[1].payload.answers.length, 7);
  assert.equal(fixture.responses[1].payload.score, undefined);
});

test("stored leadership analytics stay hidden until the actual response threshold is met", async (context) => {
  const passwordHash = `scrypt$analytics-test$${scryptSync("Coherence26!", "analytics-test", 64).toString("base64url")}`;
  const storedSession = { id: "analytics-team", slug: "analytics-team", name: "Team calibration", organization: "Practice School", type: "leadership", expectedParticipants: 5, status: "open", passwordHash };
  const responses = Array.from({ length: 4 }, () => ({ id: randomUUID(), sessionId: storedSession.id, type: "leadership", payload: { ratings: ratings().map((rating) => ({ ...rating, dimension: rating.dimension.toLowerCase().replace(/\s+/g, "-") })) } }));
  durableStore(context, { sessions: [storedSession], responses });
  const cookie = await administrator();
  const before = await call(api.admin, { cookie });
  const pending = before.body.sessions.find((session) => session.id === storedSession.id);
  assert.equal(pending.responseCount, 4);
  assert.equal(pending.analytics.ready, false);
  assert.deepEqual(pending.analytics.dimensions, []);
  responses.push({ ...responses[0], id: randomUUID() });
  const after = await call(api.admin, { cookie });
  const ready = after.body.sessions.find((session) => session.id === storedSession.id);
  assert.equal(ready.analytics.ready, true);
  assert.equal(ready.analytics.threshold, 5);
  assert.equal(ready.analytics.dimensions.length, 8);
  assert.deepEqual(ready.analytics.dimensions[0], { dimension: "strategic-clarity", average: 3, min: 3, max: 3 });
  assert.equal(ready.passwordHash, undefined);
  assert.equal(JSON.stringify(ready).includes("We have evidence"), false);
});

test("a durable storage failure cannot fall back to an in-memory response receipt", async (context) => {
  const fixture = durableStore(context);
  const cookie = await participant();
  fixture.store.saveResponse = async () => { throw new fixture.store.AssessmentStoreError(503, "Storage is temporarily unavailable."); };
  const failed = await call(api.submit, { method: "POST", cookie, body: { session: "leadership-demo", submissionId: randomUUID(), ratings: ratings() } });
  assert.equal(failed.statusCode, 503);
  assert.equal(failed.body.receipt, undefined);
  assert.equal(fixture.responses.length, 0);
});

test("seeded session access survives a separate serverless module instance", async (context) => {
  const cookie = await participant();
  const modulePath = require.resolve("../api/_lib/assessments");
  const original = require.cache[modulePath];
  delete require.cache[modulePath];
  context.after(() => { require.cache[modulePath] = original; });
  const secondInstance = require(modulePath);
  const metadata = await call(secondInstance.session, { query: { session: "leadership-demo" }, cookie });
  assert.equal(metadata.statusCode, 200);
  assert.equal(metadata.body.authorized, true);
  assert.equal(metadata.body.session.expectedParticipants, 15);
});

test("published preview without storage fails closed rather than creating disposable sessions", async (context) => {
  process.env.VERCEL = "1";
  context.after(() => { delete process.env.VERCEL; });
  const metadata = await call(api.session, { query: { session: "leadership-demo" } });
  assert.equal(metadata.statusCode, 503);
  assert.match(metadata.body.error, /storage is not connected/i);
});
