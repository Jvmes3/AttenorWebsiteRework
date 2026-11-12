const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const wayman = require("../api/_lib/wayman");
const store = require("../api/_lib/assessment-store");
process.env.SESSION_SECRET = "wayman-tests-secret-at-least-thirty-two-characters";
process.env.ATTENOR_ASSESSMENT_PREVIEW = "1";
process.env.VERCEL_ENV = "preview";
delete process.env.WAYMAN_SUPABASE_URL;
delete process.env.WAYMAN_SUPABASE_KEY;
delete process.env.WAYMAN_SUBMIT_RPC;
delete process.env.WAYMAN_SUBMISSIONS_ENABLED;
const q = { id: 81, question_number: 1, question_text: "A real question from the configured bank", choice_a: "A", choice_b: "B", choice_c: "C", choice_d: "D", correct_answer: "B", explanation: "Never sent to the participant" };
async function call({ method = "GET", body, cookie, query = { action: "catalog" }, origin } = {}, handler = wayman.handler) {
  const response = { headers: {}, setHeader(name, value) { this.headers[name] = value; }, end(text) { this.body = JSON.parse(text); } };
  await handler({ method, body, query, headers: { host: "wayman.attenorcollab.com", "x-forwarded-for": randomUUID(), ...(cookie ? { cookie } : {}), ...(origin ? { origin } : {}) } }, response);
  return response;
}
async function begin(number = 1, details = {}) {
  const result = await call({ method: "POST", body: { action: "begin", benchmark: number, studentNumber: "0017", teacherName: "Practice Teacher", ...details } });
  assert.equal(result.statusCode, 200);
  return { result, cookie: result.headers["Set-Cookie"].split(";")[0], submissionId: result.body.attemptId, answers: result.body.questions.map((question) => ({ questionId: question.id, answer: "A" })) };
}
function questionBank(context) {
  process.env.WAYMAN_SUPABASE_URL = "https://example.supabase.co";
  process.env.WAYMAN_SUPABASE_KEY = "sb_secret_test_only";
  context.after(() => { delete process.env.WAYMAN_SUPABASE_URL; delete process.env.WAYMAN_SUPABASE_KEY; });
}
test("anonymous benchmark directory exposes all 22 paths without accounts, dates, or release locks", async () => {
  const result = await call();
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.body.benchmarks.map((item) => item.benchmark), Array.from({ length: 22 }, (_, index) => index + 1));
  assert.equal(result.body.benchmarks[0].available, true);
  assert.equal(result.body.benchmarks[0].questionCount, 7);
  assert.equal(result.body.benchmarks[21].available, false);
  assert.equal(result.headers["Set-Cookie"], undefined);
});
test("a later or missed benchmark opens when actual questions exist, without completing earlier weeks", async (context) => {
  questionBank(context);
  context.mock.method(global, "fetch", async (url) => new URL(url).searchParams.get("select") === "assessment_id" ? Response.json([{ assessment_id: 7 }]) : Response.json([q]));
  const list = await call();
  assert.equal(list.body.benchmarks[6].available, true);
  const attempt = await begin(7);
  assert.equal(attempt.result.body.benchmark, 7);
  assert.equal(attempt.result.body.questions[0].correct_answer, undefined);
  assert.equal(attempt.result.body.questions[0].explanation, undefined);
});
test("starting requires only a number and teacher, preserves leading zeros, and issues an attempt cookie rather than an account", async () => {
  const attempt = await begin();
  assert.match(attempt.result.headers["Set-Cookie"], /wayman_benchmark_1=.*HttpOnly; SameSite=Strict/);
  assert.doesNotMatch(attempt.result.headers["Set-Cookie"], /attenor_portal|Domain=/);
  assert.equal(attempt.result.body.questions.length, 7);
  assert.equal(attempt.result.body.password, undefined);
  const payload = JSON.parse(Buffer.from(attempt.cookie.split("=")[1].split(".")[0], "base64url").toString());
  assert.equal(payload.studentNumber, "0017");
  assert.equal(payload.schoolYear, "2026-2027");
  assert.equal(payload.teacherName, "Practice Teacher");
});
test("student names, missing teacher, invalid benchmark paths, and cross-site starts are rejected", async () => {
  for (const body of [
    { action: "begin", benchmark: 1, studentNumber: "Student Name", teacherName: "Teacher" },
    { action: "begin", benchmark: 1, studentNumber: "17", teacherName: " " },
    { action: "begin", benchmark: 23, studentNumber: "17", teacherName: "Teacher" },
  ]) {
    const result = await call({ method: "POST", body });
    assert.ok([400, 404].includes(result.statusCode));
    assert.equal(result.headers["Set-Cookie"], undefined);
  }
  const result = await call({ method: "POST", origin: "https://elsewhere.example", body: { action: "begin", benchmark: 1, studentNumber: "17", teacherName: "Teacher" } });
  assert.equal(result.statusCode, 403);
});
test("saved identity comes from the attempt, never a student account or a spoofed submission body", async (context) => {
  const saved = [];
  context.mock.method(store, "available", () => true);
  context.mock.method(store, "ensureSession", async (session) => session);
  context.mock.method(store, "saveResponse", async (row) => { saved.push(row); return { id: row.id, submittedAt: "2026-11-12T16:00:00.000Z" }; });
  const attempt = await begin();
  const body = { action: "submit", benchmark: 1, submissionId: attempt.submissionId, answers: attempt.answers, studentNumber: "999", teacherName: "Spoofed", participantId: randomUUID() };
  const result = await call({ method: "POST", cookie: attempt.cookie, body });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.storage, "database");
  assert.equal(saved[0].participantId, null);
  assert.equal(saved[0].payload.studentNumber, "0017");
  assert.equal(saved[0].payload.teacherName, "Practice Teacher");
  assert.equal(saved[0].payload.schoolYear, "2026-2027");
  assert.equal(saved[0].sessionId, "benchmark-1");
});
test("changed cookies, mismatched attempts, and incomplete answers never save responses", async (context) => {
  const save = context.mock.method(store, "saveResponse", async () => { throw new Error("No invalid response may save"); });
  const attempt = await begin();
  const body = { action: "submit", benchmark: 1, submissionId: attempt.submissionId, answers: attempt.answers };
  for (const request of [
    { method: "POST", cookie: `${attempt.cookie}x`, body },
    { method: "POST", cookie: attempt.cookie, body: { ...body, submissionId: randomUUID() } },
    { method: "POST", cookie: attempt.cookie, body: { ...body, answers: attempt.answers.slice(1) } },
  ]) assert.ok([400, 401].includes((await call(request)).statusCode));
  assert.equal(save.mock.callCount(), 0);
});
test("database failures cannot produce a confirmation or fall back to temporary memory", async (context) => {
  context.mock.method(store, "available", () => true);
  context.mock.method(store, "ensureSession", async () => { throw new store.AssessmentStoreError(503, "Storage unavailable"); });
  const attempt = await begin();
  const result = await call({ method: "POST", cookie: attempt.cookie, body: { action: "submit", benchmark: 1, submissionId: attempt.submissionId, answers: attempt.answers } });
  assert.equal(result.statusCode, 503);
  assert.equal(result.body.receipt, undefined);
});
test("production cannot write to the staging store or use a snapshot before the approved live save is enabled", async (context) => {
  process.env.VERCEL_ENV = "production";
  context.after(() => { process.env.VERCEL_ENV = "preview"; });
  questionBank(context);
  const methods = [];
  context.mock.method(global, "fetch", async (url, options) => { methods.push(options.method || "GET"); return Response.json([q]); });
  const save = context.mock.method(store, "saveResponse", async () => { throw new Error("No live writes to test storage"); });
  const attempt = await begin();
  const result = await call({ method: "POST", cookie: attempt.cookie, body: { action: "submit", benchmark: 1, submissionId: attempt.submissionId, answers: attempt.answers } });
  assert.equal(result.statusCode, 503);
  assert.equal(result.body.receipt, undefined);
  assert.equal(save.mock.callCount(), 0);
  assert.ok(methods.every((method) => method === "GET"));
});
test("question-service errors do not turn pending benchmarks into invented question content", async (context) => {
  questionBank(context);
  context.mock.method(global, "fetch", async () => Response.json({ error: "unavailable" }, { status: 503 }));
  const result = await call();
  assert.equal(result.statusCode, 503);
  assert.equal(result.body.benchmarks, undefined);
});
