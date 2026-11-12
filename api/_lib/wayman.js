const { createHmac, randomUUID, timingSafeEqual } = require("node:crypto");
const { readJson, sendJson } = require("./http");
const store = require("./assessment-store");
const { previewEnabled, environment } = require("./portal-store");

const QUESTION_FIELDS = "id,question_number,question_text,choice_a,choice_b,choice_c,choice_d,standard_code,standard_domain";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const attempts = new Map();

class WaymanError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function isWaymanHost(request) {
  return String(request.headers?.host || "").toLowerCase().split(":")[0] === "wayman.attenorcollab.com";
}
function schoolYear() {
  const year = process.env.WAYMAN_SCHOOL_YEAR || "2026-2027";
  if (!/^20\d{2}-20\d{2}$/.test(year) || Number(year.slice(5)) !== Number(year.slice(0, 4)) + 1) throw new WaymanError(503, "The school-year setting needs attention. Please check with your teacher.");
  return year;
}
function benchmarkNumber(value) {
  if (!/^(?:[1-9]|1\d|2[0-2])$/.test(String(value ?? ""))) throw new WaymanError(404, "That benchmark was not found.");
  return Number(value);
}
function studentDetails(body) {
  const studentNumber = typeof body.studentNumber === "string" ? body.studentNumber.trim() : "";
  const teacherName = typeof body.teacherName === "string" ? body.teacherName.trim() : "";
  if (!/^\d{1,40}$/.test(studentNumber)) throw new WaymanError(400, "Enter the student number your teacher assigned you, using numbers only.");
  if (!teacherName || teacherName.length > 120) throw new WaymanError(400, "Enter your teacher’s name.");
  return { studentNumber, teacherName };
}
function questionConnection() {
  const key = process.env.WAYMAN_SUPABASE_KEY;
  const rawUrl = process.env.WAYMAN_SUPABASE_URL;
  if (!key || !rawUrl) return null;
  let url;
  try { url = new URL(rawUrl); } catch { throw new WaymanError(503, "The assessment connection needs attention. Please check with your teacher."); }
  if (url.protocol !== "https:" || !url.hostname.endsWith(".supabase.co") || url.username || url.password || url.search || url.hash || !["", "/"].includes(url.pathname)) throw new WaymanError(503, "The assessment connection needs attention. Please check with your teacher.");
  const headers = { apikey: key, "Content-Type": "application/json" };
  if (!key.startsWith("sb_secret_") && !key.startsWith("sb_publishable_")) headers.Authorization = `Bearer ${key}`;
  return { url: url.origin, headers };
}
async function questionRequest(path, options = {}) {
  const connection = questionConnection();
  if (!connection) throw new WaymanError(503, "This benchmark’s questions are being prepared. Your teacher will let you know when they are ready.");
  let result;
  try { result = await fetch(`${connection.url}${path}`, { ...options, headers: { ...connection.headers, ...options.headers }, signal: AbortSignal.timeout(12000) }); }
  catch { throw new WaymanError(503, "The assessment service could not be reached. Please keep this page open and try again."); }
  if (!result.ok) throw new WaymanError(503, "The assessment service could not complete this request. Please keep this page open and try again.");
  try { return await result.json(); } catch { throw new WaymanError(503, "The assessment service returned an incomplete response. Please try again."); }
}
function cleanQuestions(data) {
  if (!Array.isArray(data) || !data.length || data.length > 100) throw new WaymanError(503, "This benchmark’s questions are being prepared. Please check with your teacher.");
  const ids = new Set();
  return data.map((question) => {
    if (!question || !["string", "number"].includes(typeof question.id) || ids.has(String(question.id)) || typeof question.question_text !== "string" || !["a", "b", "c", "d"].every((letter) => typeof question[`choice_${letter}`] === "string")) throw new WaymanError(503, "The questions need a quick check before this benchmark can open.");
    ids.add(String(question.id));
    return Object.fromEntries(QUESTION_FIELDS.split(",").map((key) => [key, question[key] ?? ""]));
  });
}
async function questionsFor(number) {
  if (!questionConnection() && previewEnabled() && number === 1) return cleanQuestions(require("../_assets/benchmark-1.json"));
  return cleanQuestions(await questionRequest(`/rest/v1/wayman_questions?assessment_id=eq.${number}&select=${QUESTION_FIELDS}&order=question_number.asc`));
}
async function catalog() {
  const counts = new Map();
  if (questionConnection()) {
    const rows = await questionRequest("/rest/v1/wayman_questions?select=assessment_id&assessment_id=gte.1&assessment_id=lte.22&limit=5000");
    if (!Array.isArray(rows) || rows.length >= 5000) throw new WaymanError(503, "The benchmark list could not be confirmed. Please try again.");
    for (const row of rows) if (Number.isInteger(row.assessment_id) && row.assessment_id >= 1 && row.assessment_id <= 22) counts.set(row.assessment_id, (counts.get(row.assessment_id) || 0) + 1);
  } else if (previewEnabled()) counts.set(1, require("../_assets/benchmark-1.json").length);
  return Array.from({ length: 22 }, (_, index) => ({ benchmark: index + 1, title: `Science · Benchmark ${index + 1}`, available: counts.has(index + 1), questionCount: counts.get(index + 1) || 0 }));
}
function sessionFor(number) {
  return { id: `benchmark-${number}`, slug: `benchmark-${number}`, name: `Science · Benchmark ${number}`, organization: "Wayman Academy of Arts", type: "benchmark", benchmark: number, expectedParticipants: null, status: "open", passwordHash: "scrypt$unused$unused" };
}
function signingSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new WaymanError(503, "The assessment service is not ready yet. Please check with your teacher.");
  return secret;
}
function sign(payload) { return createHmac("sha256", signingSecret()).update(`wayman-attempt:${payload}`).digest("base64url"); }
function cookieName(number) { return `wayman_benchmark_${number}`; }
function attemptCookie(request, number, details, attemptId) {
  const payload = Buffer.from(JSON.stringify({ purpose: "wayman-benchmark", benchmark: number, schoolYear: schoolYear(), environment: environment(), ...details, attemptId, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 4 })).toString("base64url");
  const secure = process.env.VERCEL || request.headers?.["x-forwarded-proto"] === "https" ? "; Secure" : "";
  return `${cookieName(number)}=${payload}.${sign(payload)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=14400${secure}`;
}
function readAttempt(request, number, submissionId) {
  try {
    const entry = String(request.headers?.cookie || "").split(";").map((part) => part.trim()).find((part) => part.startsWith(`${cookieName(number)}=`));
    if (!entry || entry.length > 4000) throw new Error("attempt");
    const pieces = entry.slice(cookieName(number).length + 1).split(".");
    if (pieces.length !== 2) throw new Error("signature");
    const actual = Buffer.from(pieces[1]); const expected = Buffer.from(sign(pieces[0]));
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error("signature");
    const data = JSON.parse(Buffer.from(pieces[0], "base64url").toString("utf8"));
    if (data.purpose !== "wayman-benchmark" || data.benchmark !== number || data.schoolYear !== schoolYear() || data.environment !== environment() || !Number.isFinite(data.exp) || data.exp <= Date.now() / 1000 || data.attemptId !== submissionId || !UUID.test(data.attemptId)) throw new Error("attempt");
    studentDetails(data);
    return data;
  } catch { throw new WaymanError(401, "Please start this benchmark again with your student number and teacher’s name. Keep your current answers until your teacher can help."); }
}
function checkOrigin(request) {
  if (request.headers?.["sec-fetch-site"] === "cross-site") throw new WaymanError(403, "Open the benchmark on this website to continue.");
  if (!request.headers?.origin) return;
  try {
    const origin = new URL(request.headers.origin);
    if (!["http:", "https:"].includes(origin.protocol) || origin.host !== request.headers.host) throw new Error("origin");
  } catch { throw new WaymanError(403, "Open the benchmark on this website to continue."); }
}
function limitBegins(request) {
  const address = String(request.headers?.["x-forwarded-for"] || request.socket?.remoteAddress || "unknown").slice(0, 120);
  const now = Date.now();
  for (const [key, entry] of attempts) if (entry.until < now) attempts.delete(key);
  const entry = attempts.get(address) || { count: 0, until: now + 15 * 60 * 1000 };
  if (entry.count >= 300 || attempts.size > 5000) throw new WaymanError(429, "The assessment service is busy. Please wait a little and try again.");
  attempts.set(address, { ...entry, count: entry.count + 1 });
}
function mode() { return previewEnabled() ? "preview" : "connected"; }
async function begin(request, response, body) {
  limitBegins(request);
  const number = benchmarkNumber(body.benchmark);
  const details = studentDetails(body);
  signingSecret();
  const questions = await questionsFor(number);
  const attemptId = randomUUID();
  response.setHeader("Set-Cookie", attemptCookie(request, number, details, attemptId));
  return sendJson(response, 200, { benchmark: number, schoolYear: schoolYear(), questions, attemptId, mode: mode() });
}
async function submit(request, response, body) {
  const number = benchmarkNumber(body.benchmark);
  const attempt = readAttempt(request, number, body.submissionId);
  const questions = await questionsFor(number);
  if (!Array.isArray(body.answers) || body.answers.length !== questions.length) throw new WaymanError(400, "Please answer every question before submitting.");
  const answers = new Map();
  for (const answer of body.answers) {
    const id = String(answer?.questionId ?? "");
    if (answers.has(id) || !questions.some((question) => String(question.id) === id) || !["A", "B", "C", "D"].includes(answer.answer)) throw new WaymanError(400, "Please answer every question before submitting.");
    answers.set(id, answer.answer);
  }
  const normalized = questions.map((question) => ({ question_id: question.id, selected_answer: answers.get(String(question.id)) }));
  const payload = { schoolYear: attempt.schoolYear, assessmentId: number, studentNumber: attempt.studentNumber, teacherName: attempt.teacherName, answers: normalized };
  let receipt;
  if (previewEnabled()) {
    if (!store.available()) throw new WaymanError(503, "Test response storage is not connected. Your answers have not been confirmed saved. Keep this page open and check with your teacher.");
    await store.ensureSession(sessionFor(number));
    receipt = await store.saveResponse({ id: body.submissionId, sessionId: sessionFor(number).id, participantId: null, type: "benchmark", payload });
  } else {
    const rpc = process.env.WAYMAN_SUBMIT_RPC;
    if (process.env.WAYMAN_SUBMISSIONS_ENABLED !== "1" || !rpc || !/^[a-z][a-z0-9_]{0,62}$/.test(rpc)) throw new WaymanError(503, "Response saving is being connected. Your answers have not been confirmed saved. Keep this page open and check with your teacher.");
    receipt = await questionRequest(`/rest/v1/rpc/${rpc}`, { method: "POST", body: JSON.stringify({ p_submission_id: body.submissionId, p_session_id: `wayman-${attempt.schoolYear}-benchmark-${number}`, p_assessment_id: number, p_school_year: attempt.schoolYear, p_student_code: attempt.studentNumber, p_teacher_name: attempt.teacherName, p_answers: normalized }) });
  }
  if (!receipt || receipt.id !== body.submissionId || typeof receipt.submittedAt !== "string" || Number.isNaN(Date.parse(receipt.submittedAt))) throw new WaymanError(503, "The save could not be confirmed. Keep this page open and try again, or check with your teacher.");
  return sendJson(response, 200, { receipt: { id: receipt.id, submittedAt: receipt.submittedAt }, schoolYear: attempt.schoolYear, mode: mode(), storage: "database" });
}
async function handler(request, response) {
  try {
    if (request.method === "GET") {
      if (request.query?.action !== "catalog") throw new WaymanError(400, "Choose a benchmark to begin.");
      return sendJson(response, 200, { benchmarks: await catalog(), schoolYear: schoolYear(), mode: mode() });
    }
    if (request.method !== "POST") { response.setHeader("Allow", "GET, POST"); throw new WaymanError(405, "Method not allowed."); }
    checkOrigin(request);
    let body;
    try { body = await readJson(request); } catch { throw new WaymanError(400, "Please check your details and try again."); }
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new WaymanError(400, "Please check your details and try again.");
    if (body.action === "begin") return await begin(request, response, body);
    if (body.action === "submit") return await submit(request, response, body);
    throw new WaymanError(400, "Choose a benchmark to begin.");
  } catch (error) {
    if (!error.status) console.error("Wayman assessment failed", error.name);
    return sendJson(response, error.status || 503, { error: error.status ? error.message : "The benchmark is temporarily unavailable. Please try again." });
  }
}

module.exports = { handler, isWaymanHost };
