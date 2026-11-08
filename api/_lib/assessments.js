const { createHmac, randomBytes, scryptSync, timingSafeEqual } = require("node:crypto");
const { readJson, sendJson, verifyPassword } = require("./http");
const store = require("./assessment-store");

const MAX_AGE = 60 * 60 * 8;
const SLUG = /^[a-z0-9][a-z0-9-]{0,79}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIMENSIONS = ["strategic-clarity", "leadership-alignment", "enabling-conditions", "capacity-building", "data-use", "community-engagement", "accountability-systems", "foresight-readiness"];
const previewSessions = new Map();
const previewSubmissions = new Map();
const attempts = new Map();

class AssessmentError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function previewEnabled() {
  return require("./portal-store").previewEnabled();
}

function hashPassword(password, salt = randomBytes(16).toString("base64url")) {
  return `scrypt$${salt}$${scryptSync(password, salt, 64).toString("base64url")}`;
}

function seedPreview() {
  if (previewSessions.size) return;
  for (const session of [
    { id: "leadership-demo", slug: "leadership-demo", name: "Leadership Coherence Check", organization: "Attenor Collaborative", type: "leadership", expectedParticipants: 15, status: "open", password: "Coherence26!" },
    { id: "benchmark-1", slug: "benchmark-1", name: "Science · Benchmark 1", organization: "Wayman Academy of Arts", type: "benchmark", benchmark: 1, expectedParticipants: null, status: "open", password: "Eagles_FY26!" },
    { id: "benchmark-2", slug: "benchmark-2", name: "Science · Benchmark 2", organization: "Wayman Academy of Arts", type: "benchmark", benchmark: 2, expectedParticipants: null, status: "unavailable", password: "Eagles_FY26!" },
  ]) {
    const { password, ...metadata } = session;
    previewSessions.set(session.slug, { ...metadata, passwordHash: hashPassword(password, `attenor-test-session-${metadata.id}`) });
  }
}

function configuredSessions() {
  const raw = process.env.ATTENOR_ASSESSMENT_SESSIONS_JSON;
  if (!raw) return [];
  let sessions;
  try { sessions = JSON.parse(raw); } catch { throw new AssessmentError(503, "Assessment session configuration needs attention."); }
  if (!Array.isArray(sessions) || sessions.length > 500) throw new AssessmentError(503, "Assessment session configuration needs attention.");
  const ids = new Set();
  const slugs = new Set();
  return sessions.map((session) => {
    if (!session || !SLUG.test(session.slug) || typeof session.id !== "string" || session.id.length > 100 || !session.id || ids.has(session.id) || slugs.has(session.slug) || !["leadership", "benchmark"].includes(session.type) || typeof session.name !== "string" || session.name.length > 160 || typeof session.organization !== "string" || session.organization.length > 160 || !/^scrypt\$/.test(session.passwordHash || "") || (session.type === "benchmark" && (!Number.isInteger(session.benchmark) || session.benchmark < 1 || session.benchmark > 22))) {
      throw new AssessmentError(503, "Assessment session configuration needs attention.");
    }
    if (!session.name.trim() || !session.organization.trim() || (session.status !== undefined && !["open", "closed", "unavailable"].includes(session.status)) || (session.expectedParticipants != null && (!Number.isInteger(session.expectedParticipants) || session.expectedParticipants < 5 || session.expectedParticipants > 15))) {
      throw new AssessmentError(503, "Assessment session configuration needs attention.");
    }
    ids.add(session.id); slugs.add(session.slug);
    return { ...session, status: ["open", "closed", "unavailable"].includes(session.status) ? session.status : "open" };
  });
}

async function getSessions() {
  const configured = configuredSessions();
  if (previewEnabled()) seedPreview();
  const configuredSlugs = new Set(configured.map((session) => session.slug));
  const initial = [...configured, ...(previewEnabled() ? [...previewSessions.values()].filter((session) => !configuredSlugs.has(session.slug)) : [])];
  if (store.available()) {
    const sessions = await store.listSessions();
    for (const item of initial) {
      if (!sessions.some((existing) => existing.id === item.id || existing.slug === item.slug)) sessions.push(await store.ensureSession(item));
    }
    return sessions;
  }
  if (process.env.VERCEL) throw new AssessmentError(503, "Assessment storage is not connected yet. Please check with Attenor.");
  return initial;
}

async function getSession(slug) {
  if (typeof slug !== "string" || !SLUG.test(slug)) throw new AssessmentError(404, "This assessment link was not found. Check the link with your facilitator.");
  const session = (await getSessions()).find((candidate) => candidate.slug === slug);
  if (!session) throw new AssessmentError(404, "This assessment link was not found. Check the link with your facilitator.");
  return session;
}

function waymanConfig() {
  const key = process.env.WAYMAN_SUPABASE_KEY;
  const rawUrl = process.env.WAYMAN_SUPABASE_URL;
  if (!key || !rawUrl) return null;
  let url;
  try { url = new URL(rawUrl); } catch { throw new AssessmentError(503, "The assessment connection needs attention."); }
  if (url.protocol !== "https:" || !url.hostname.endsWith(".supabase.co") || !["", "/"].includes(url.pathname) || url.username || url.password || url.search || url.hash) throw new AssessmentError(503, "The assessment connection needs attention.");
  const headers = { apikey: key, "Content-Type": "application/json" };
  if (!key.startsWith("sb_secret_") && !key.startsWith("sb_publishable_")) headers.Authorization = `Bearer ${key}`;
  return { url: url.origin, headers };
}

function modeFor(session) {
  if (previewEnabled()) return "preview";
  return store.available() || (session.type === "benchmark" && waymanConfig()) ? "connected" : "preview";
}

function snapshotAvailable(session) { return previewEnabled() && session.type === "benchmark" && session.benchmark === 1; }
function storage() { return store.available() ? "database" : "memory"; }
function publicSession(session) {
  const result = {
    id: session.id, slug: session.slug, name: session.name, organization: session.organization,
    type: session.type, benchmark: session.benchmark || null, expectedParticipants: session.expectedParticipants || null,
    status: session.status,
  };
  if (session.type === "benchmark" && !waymanConfig() && !snapshotAvailable(session)) result.status = "unavailable";
  return result;
}

async function adminSession(session) {
  const result = publicSession(session);
  if (!store.available()) {
    result.responseCount = [...previewSubmissions.values()].filter((entry) => entry.sessionId === session.id).length;
    result.analytics = { ready: false, count: result.responseCount, threshold: session.expectedParticipants || 15, dimensions: [], kind: session.type };
    return result;
  }
  const responses = await store.listResponses(session.id);
  result.responseCount = responses.length;
  const threshold = session.expectedParticipants || 15;
  result.analytics = { ready: false, count: responses.length, threshold, dimensions: [], kind: session.type };
  if (responses.length < threshold) return result;
  if (session.type === "leadership") {
    const valid = responses.filter((entry) => {
      const ratings = entry.payload?.ratings;
      return Array.isArray(ratings) && ratings.length === DIMENSIONS.length && DIMENSIONS.every((dimension) => ratings.filter((rating) => rating.dimension === dimension && Number.isInteger(rating.score) && rating.score >= 1 && rating.score <= 5).length === 1);
    });
    if (valid.length < threshold) return result;
    result.analytics.ready = true;
    result.analytics.count = valid.length;
    result.analytics.dimensions = DIMENSIONS.map((dimension) => {
      const scores = valid.map((entry) => entry.payload.ratings.find((rating) => rating.dimension === dimension).score);
      return { dimension, average: Number((scores.reduce((sum, value) => sum + value, 0) / scores.length).toFixed(2)), min: Math.min(...scores), max: Math.max(...scores) };
    });
  } else {
    const scores = responses.map((entry) => entry.payload?.score).filter((score) => Number.isFinite(score) && score >= 0 && score <= 100);
    if (scores.length >= threshold) {
      result.analytics.ready = true;
      result.analytics.average = Number((scores.reduce((sum, value) => sum + value, 0) / scores.length).toFixed(2));
      result.analytics.min = Math.min(...scores);
      result.analytics.max = Math.max(...scores);
    }
  }
  return result;
}

function secret() {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) throw new AssessmentError(503, "Assessment access has not been configured yet.");
  return value;
}

function signature(value) { return createHmac("sha256", secret()).update(value).digest("base64url"); }
function equals(left, right) {
  const a = Buffer.from(String(left)); const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
}
function version(session) { return createHmac("sha256", secret()).update(session.passwordHash).digest("base64url"); }
function cookieName(session) { return session ? `attenor_assessment_${session.slug}` : "attenor_assessment_admin"; }
function signedToken(purpose, subject, revision) {
  const payload = Buffer.from(JSON.stringify({ purpose, sub: subject, revision, exp: Math.floor(Date.now() / 1000) + MAX_AGE })).toString("base64url");
  return `${payload}.${signature(payload)}`;
}
function readToken(request, name) {
  try {
    const pair = String(request.headers?.cookie || "").split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
    if (!pair) return null;
    const pieces = decodeURIComponent(pair.slice(name.length + 1)).split(".");
    if (pieces.length !== 2 || !equals(signature(pieces[0]), pieces[1])) return null;
    const parsed = JSON.parse(Buffer.from(pieces[0], "base64url").toString("utf8"));
    return Number.isFinite(parsed.exp) && parsed.exp > Date.now() / 1000 ? parsed : null;
  } catch { return null; }
}
function cookie(request, name, token, maxAge = MAX_AGE) {
  const secure = process.env.VERCEL || request.headers?.["x-forwarded-proto"] === "https" ? "; Secure" : "";
  return `${name}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure}`;
}
async function authorized(request, session) {
  const identity = await require("./portal").currentPortal(request);
  if (identity) return identity.role === "facilitator" || session.type === "benchmark";
  const token = readToken(request, cookieName(session));
  return !!token && token.purpose === "participant" && token.sub === session.id && token.revision === version(session);
}
async function requireParticipant(request, session) {
  const identity = await require("./portal").currentPortal(request);
  if (identity?.role === "student" && session.type !== "benchmark") throw new AssessmentError(403, "Your student portal contains the available benchmarks.");
  if (!(await authorized(request, session))) throw new AssessmentError(401, "Enter the session password to continue.");
  if (session.status === "closed") throw new AssessmentError(409, "This session is closed. Please contact your facilitator.");
}
function adminHash() {
  const configured = process.env.ATTENOR_ASSESSMENT_ADMIN_PASSWORD_HASH;
  if (configured) return configured;
  if (previewEnabled()) return `scrypt$attenor-facilitator-preview$${scryptSync("Facilitator26!", "attenor-facilitator-preview", 64).toString("base64url")}`;
  throw new AssessmentError(503, "Facilitator access has not been configured yet.");
}
function requireAdmin(request) {
  const token = readToken(request, cookieName());
  const revision = signature(adminHash());
  if (!token || token.purpose !== "admin" || token.sub !== "facilitator" || token.revision !== revision) throw new AssessmentError(401, "Facilitator sign-in is required.");
}

function checkOrigin(request) {
  const origin = request.headers?.origin;
  if (request.headers?.["sec-fetch-site"] === "cross-site") throw new AssessmentError(403, "Open the assessment on this website to continue.");
  if (!origin) return;
  try {
    const parsed = new URL(origin);
    if (!["https:", "http:"].includes(parsed.protocol) || parsed.host !== request.headers.host) throw new Error("origin");
  } catch { throw new AssessmentError(403, "Open the assessment on this website to continue."); }
}
function limitAttempts(request, target) {
  const key = `${String(request.headers?.["x-forwarded-for"] || request.socket?.remoteAddress || "unknown").slice(0, 120)}:${target}`;
  const now = Date.now();
  if (attempts.size > 2000) for (const [id, entry] of attempts) if (entry.expires < now) attempts.delete(id);
  const entry = attempts.get(key);
  if (entry && entry.expires > now && entry.count >= 20) throw new AssessmentError(429, "Too many sign-in attempts. Please wait 15 minutes and try again.");
  attempts.set(key, entry && entry.expires > now ? { ...entry, count: entry.count + 1 } : { count: 1, expires: now + 15 * 60 * 1000 });
}
function boundedText(value, label, max) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) throw new AssessmentError(400, `Please provide a valid ${label}.`);
  return value.trim();
}
async function bodyFor(request) {
  try {
    const body = await readJson(request);
    if (!body || Array.isArray(body) || typeof body !== "object" || JSON.stringify(body).length > 20000) throw new Error("body");
    return body;
  } catch { throw new AssessmentError(400, "Please check the form and try again."); }
}
async function waymanRequest(path, options = {}) {
  const config = waymanConfig();
  if (!config) throw new AssessmentError(503, "This assessment is not connected yet. Please check with your teacher.");
  let response;
  try { response = await fetch(`${config.url}${path}`, { ...options, headers: { ...config.headers, ...options.headers }, signal: AbortSignal.timeout(12000) }); }
  catch { throw new AssessmentError(503, "The assessment service could not be reached. Your answers have not been confirmed saved. Please try again."); }
  if (!response.ok) throw new AssessmentError(503, "The assessment service could not complete this request. Your answers have not been confirmed saved. Please try again.");
  try { return await response.json(); } catch { throw new AssessmentError(503, "The assessment service returned an incomplete response. Please try again."); }
}
async function questionsFor(session) {
  if (session.type !== "benchmark") throw new AssessmentError(400, "This session uses the Leadership Coherence Check.");
  if (session.status === "unavailable") throw new AssessmentError(503, "This benchmark is coming soon. Your teacher will let you know when it is ready.");
  const fields = "id,question_number,question_text,choice_a,choice_b,choice_c,choice_d,standard_code,standard_domain";
  const data = !waymanConfig() && snapshotAvailable(session)
    ? require("../_assets/benchmark-1.json")
    : await waymanRequest(`/rest/v1/wayman_questions?assessment_id=eq.${session.benchmark}&select=${fields}&order=question_number.asc`);
  if (!Array.isArray(data) || !data.length || data.length > 100) throw new AssessmentError(503, "The questions are not ready yet. Please check with your teacher.");
  return data.map((question) => {
    if (!question || !["string", "number"].includes(typeof question.id) || typeof question.question_text !== "string" || !["a", "b", "c", "d"].every((letter) => typeof question[`choice_${letter}`] === "string")) throw new AssessmentError(503, "The questions need a quick check before this assessment can open.");
    return Object.fromEntries(fields.split(",").map((field) => [field, question[field] ?? ""]));
  });
}

async function sessionHandler(request, response) {
  if (request.query?.catalog === "1" && !request.query?.session) {
    const identity = await require("./portal").currentPortal(request);
    if (!identity) throw new AssessmentError(401, "Sign in to the portal to continue.");
    const sessions = (await getSessions()).map((item) => publicSession(item)).filter((item) => identity.role === "facilitator" || (item.type === "benchmark" && item.benchmark === 1 && item.status === "open"));
    return sendJson(response, 200, { sessions, mode: previewEnabled() ? "preview" : "connected", storage: storage() });
  }
  const session = await getSession(request.query?.session);
  const identity = await require("./portal").currentPortal(request);
  if (identity?.role === "student" && session.type !== "benchmark") throw new AssessmentError(403, "Your student portal contains the available benchmarks.");
  return sendJson(response, 200, { session: publicSession(session), mode: modeFor(session), storage: storage(), authorized: await authorized(request, session) });
}
async function accessHandler(request, response) {
  const body = await bodyFor(request);
  const session = await getSession(body.session);
  const identity = await require("./portal").currentPortal(request);
  if (identity?.role === "student" && session.type !== "benchmark") throw new AssessmentError(403, "Your student portal contains the available benchmarks.");
  limitAttempts(request, session.slug);
  if (typeof body.password !== "string" || body.password.length > 200 || !verifyPassword(body.password, session.passwordHash)) throw new AssessmentError(401, "That password does not match this session. Please try again.");
  if (session.status === "closed") throw new AssessmentError(409, "This session is closed. Please contact your facilitator.");
  response.setHeader("Set-Cookie", cookie(request, cookieName(session), signedToken("participant", session.id, version(session))));
  return sendJson(response, 200, { session: publicSession(session), mode: modeFor(session), storage: storage(), authorized: true });
}
async function questionsHandler(request, response) {
  const session = await getSession(request.query?.session);
  await requireParticipant(request, session);
  return sendJson(response, 200, { questions: await questionsFor(session), mode: modeFor(session), storage: storage() });
}
function validatedRatings(ratings) {
  if (!Array.isArray(ratings) || ratings.length !== DIMENSIONS.length) throw new AssessmentError(400, "Please complete all eight dimensions before submitting.");
  const seen = new Set();
  return ratings.map((rating) => {
    const dimension = typeof rating?.dimension === "string" ? rating.dimension.toLowerCase().replace(/\s+/g, "-") : "";
    if (!DIMENSIONS.includes(dimension) || seen.has(dimension) || !Number.isInteger(rating.score) || rating.score < 1 || rating.score > 5) throw new AssessmentError(400, "Please select a score from 1 to 5 for each dimension.");
    seen.add(dimension);
    return { dimension, score: rating.score, explanation: boundedText(rating.explanation, "brief explanation for every dimension", 1500) };
  });
}
async function submitHandler(request, response) {
  const body = await bodyFor(request);
  const session = await getSession(body.session);
  await requireParticipant(request, session);
  const identity = await require("./portal").currentPortal(request);
  if (typeof body.submissionId !== "string" || !UUID.test(body.submissionId)) throw new AssessmentError(400, "Please refresh the assessment and try again.");
  if (session.type === "leadership") {
    const ratings = validatedRatings(body.ratings);
    if (store.available()) {
      const receipt = await store.saveResponse({ id: body.submissionId, sessionId: session.id, participantId: identity?.participantId || null, type: "leadership", payload: { ratings } });
      return sendJson(response, 200, { receipt, mode: modeFor(session), storage: "database" });
    }
    if (!previewEnabled()) throw new AssessmentError(503, "Response storage is not connected yet. Your answers have not been saved.");
    const key = `${session.id}:${body.submissionId}`;
    const prior = previewSubmissions.get(key);
    if (prior && JSON.stringify(prior.ratings) !== JSON.stringify(ratings)) throw new AssessmentError(409, "This response was already submitted. Please contact your facilitator to make a change.");
    const receipt = prior?.receipt || { id: body.submissionId, submittedAt: new Date().toISOString() };
    if (!prior) previewSubmissions.set(key, { sessionId: session.id, ratings, receipt });
    return sendJson(response, 200, { receipt, mode: "preview", storage: "memory" });
  }

  const studentCode = boundedText(identity?.role === "student" ? identity.profile.studentCode : body.studentCode, "student code", 80);
  const teacherName = boundedText(identity?.role === "student" ? identity.profile.teacherName : body.teacherName, "teacher name", 120);
  const rpc = process.env.WAYMAN_SUBMIT_RPC;
  if (!store.available() && !previewEnabled() && (!rpc || !/^[a-z][a-z0-9_]{0,62}$/.test(rpc))) throw new AssessmentError(503, "Submission storage is not connected yet. Your answers have not been saved. Please check with your teacher.");
  const questions = await questionsFor(session);
  if (!Array.isArray(body.answers) || body.answers.length !== questions.length) throw new AssessmentError(400, "Please answer every question before submitting.");
  const answers = new Map();
  for (const answer of body.answers) {
    const id = String(answer?.questionId ?? "");
    if (!questions.some((question) => String(question.id) === id) || answers.has(id) || !["A", "B", "C", "D"].includes(answer.answer)) throw new AssessmentError(400, "Please answer every question before submitting.");
    answers.set(id, answer.answer);
  }
  const normalizedAnswers = questions.map((question) => ({ question_id: question.id, selected_answer: answers.get(String(question.id)) }));
  if (store.available()) {
    const receipt = await store.saveResponse({ id: body.submissionId, sessionId: session.id, participantId: identity?.participantId || null, type: "benchmark", payload: { assessmentId: session.benchmark, studentCode, teacherName, answers: normalizedAnswers } });
    return sendJson(response, 200, { receipt, mode: modeFor(session), storage: "database" });
  }
  if (previewEnabled()) {
    const key = `${session.id}:${body.submissionId}`;
    const payload = { studentCode, teacherName, answers: normalizedAnswers };
    const prior = previewSubmissions.get(key);
    if (prior && JSON.stringify(prior.benchmark) !== JSON.stringify(payload)) throw new AssessmentError(409, "This response was already submitted. Please contact your teacher to make a change.");
    const receipt = prior?.receipt || { id: body.submissionId, submittedAt: new Date().toISOString() };
    if (!prior) previewSubmissions.set(key, { sessionId: session.id, benchmark: payload, receipt });
    return sendJson(response, 200, { receipt, mode: "preview", storage: "memory" });
  }
  // The configured RPC must grade, atomically save both Wayman tables, and deduplicate
  // p_submission_id. The original HTML's two independent inserts cannot do this safely.
  const receipt = await waymanRequest(`/rest/v1/rpc/${rpc}`, {
    method: "POST",
    body: JSON.stringify({ p_submission_id: body.submissionId, p_session_id: session.id, p_assessment_id: session.benchmark, p_student_code: studentCode, p_teacher_name: teacherName, p_answers: normalizedAnswers }),
  });
  if (!receipt || receipt.id !== body.submissionId || typeof receipt.submittedAt !== "string" || Number.isNaN(Date.parse(receipt.submittedAt))) throw new AssessmentError(503, "The save could not be confirmed. Keep this page open and retry, or contact your teacher.");
  return sendJson(response, 200, { receipt: { id: receipt.id, submittedAt: receipt.submittedAt }, mode: "connected" });
}
async function adminHandler(request, response) {
  const identity = await require("./portal").currentPortal(request);
  if (identity?.role === "student") throw new AssessmentError(403, "This workspace is for facilitators. Your student benchmarks are in the portal.");
  if (request.method === "GET") {
    requireAdmin(request);
    const sessions = await getSessions();
    const metadata = [];
    for (let index = 0; index < sessions.length; index += 8) {
      metadata.push(...await Promise.all(sessions.slice(index, index + 8).map(adminSession)));
    }
    return sendJson(response, 200, { sessions: metadata, mode: previewEnabled() ? "preview" : "connected", storage: storage() });
  }
  const body = await bodyFor(request);
  if (body.action === "login") {
    limitAttempts(request, "admin");
    const passwordHash = adminHash();
    if (typeof body.password !== "string" || body.password.length > 200 || !verifyPassword(body.password, passwordHash)) throw new AssessmentError(401, "The facilitator password is incorrect.");
    response.setHeader("Set-Cookie", cookie(request, cookieName(), signedToken("admin", "facilitator", signature(passwordHash))));
    return sendJson(response, 200, { authorized: true, mode: previewEnabled() ? "preview" : "connected", storage: storage() });
  }
  if (body.action === "logout") {
    response.setHeader("Set-Cookie", cookie(request, cookieName(), "", 0));
    return sendJson(response, 200, { authorized: false });
  }
  requireAdmin(request);
  if (body.action !== "create") throw new AssessmentError(400, "Choose a valid session action.");
  if (!store.available() && !previewEnabled()) throw new AssessmentError(503, "Session management storage is not connected yet. No session was created.");
  const name = boundedText(body.name, "session name", 120);
  const organization = boundedText(body.organization, "organization", 120);
  const expectedParticipants = Number(body.expectedParticipants);
  if (!Number.isInteger(expectedParticipants) || expectedParticipants < 5 || expectedParticipants > 15) throw new AssessmentError(400, "Choose a team size from 5 to 15 participants.");
  if ((await getSessions()).length >= 500) throw new AssessmentError(409, "The session limit has been reached. Please contact Attenor.");
  const slug = `coherence-${randomBytes(8).toString("hex")}`;
  const password = randomBytes(12).toString("base64url");
  const session = { id: slug, slug, name, organization, expectedParticipants, type: "leadership", status: "open", passwordHash: hashPassword(password) };
  if (store.available()) await store.createSession(session);
  else previewSessions.set(slug, session);
  return sendJson(response, 201, { session: await adminSession(session), password, mode: modeFor(session), storage: storage() });
}

function endpoint(methods, handler) {
  return async (request, response) => {
    try {
      if (!methods.includes(request.method)) { response.setHeader("Allow", methods.join(", ")); throw new AssessmentError(405, "Method not allowed."); }
      if (request.method !== "GET") checkOrigin(request);
      return await handler(request, response);
    } catch (error) {
      const known = error instanceof AssessmentError || error instanceof store.AssessmentStoreError;
      if (!known) console.error("Assessment endpoint failed", error.name);
      return sendJson(response, error.status || 503, { error: known ? error.message : "Assessment access is temporarily unavailable. Please try again." });
    }
  };
}

module.exports = {
  session: endpoint(["GET"], sessionHandler), access: endpoint(["POST"], accessHandler),
  questions: endpoint(["GET"], questionsHandler), submit: endpoint(["POST"], submitHandler),
  admin: endpoint(["GET", "POST"], adminHandler),
  facilitatorAuth: { requireAdmin, adminHash, cookie, cookieName, signedToken, signature },
};
