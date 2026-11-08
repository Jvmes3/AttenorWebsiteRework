const { getSupabaseConfig } = require("./supabase");

const SESSION_TABLE = "portal_assessment_sessions";
const RESPONSE_TABLE = "portal_assessment_responses";
const SESSION_FIELDS = "environment,id,slug,name,organization,type,benchmark,expected_participants,status,password_hash,created_at";
const RESPONSE_FIELDS = "environment,id,session_id,participant_id,type,payload,submitted_at";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9][a-z0-9-]{0,79}$/;
const PAGE_SIZE = 500;
const MAX_RESPONSES = 5000;

class AssessmentStoreError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "AssessmentStoreError";
    this.status = status;
  }
}

function available() { return getSupabaseConfig().ok; }
function environment() { return process.env.VERCEL_ENV === "production" ? "production" : "test"; }

function textValue(value, label, maximum) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maximum) {
    throw new AssessmentStoreError(400, `Please provide a valid ${label}.`);
  }
  return value.trim();
}

function typeValue(value) {
  if (!["leadership", "benchmark"].includes(value)) throw new AssessmentStoreError(400, "Choose a valid assessment type.");
  return value;
}

function sessionRow(session) {
  if (!session || !SLUG.test(session.slug)) throw new AssessmentStoreError(400, "Please provide a valid session code.");
  const type = typeValue(session.type);
  const benchmark = session.benchmark ?? null;
  const expectedParticipants = session.expectedParticipants ?? null;
  if (type === "benchmark" && (!Number.isInteger(benchmark) || benchmark < 1 || benchmark > 22)) {
    throw new AssessmentStoreError(400, "Choose a benchmark from 1 to 22.");
  }
  if (expectedParticipants !== null && (!Number.isInteger(expectedParticipants) || expectedParticipants < 5 || expectedParticipants > 15)) {
    throw new AssessmentStoreError(400, "Choose a team size from 5 to 15 participants.");
  }
  if (!["open", "closed", "unavailable"].includes(session.status || "open") || !/^scrypt\$[^$]+\$[^$]+$/.test(session.passwordHash || "")) {
    throw new AssessmentStoreError(400, "Please provide valid session access settings.");
  }
  return {
    environment: environment(),
    id: textValue(session.id, "session ID", 100),
    slug: session.slug,
    name: textValue(session.name, "session name", 160),
    organization: textValue(session.organization, "organization", 160),
    type,
    benchmark: type === "benchmark" ? benchmark : null,
    expected_participants: expectedParticipants,
    status: session.status || "open",
    password_hash: session.passwordHash,
  };
}

function toSession(row) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    organization: row.organization,
    type: row.type,
    benchmark: row.benchmark,
    expectedParticipants: row.expected_participants,
    status: row.status,
    passwordHash: row.password_hash,
    createdAt: row.created_at,
  };
}

function toResponse(row) {
  return {
    id: row.id,
    sessionId: row.session_id,
    participantId: row.participant_id,
    type: row.type,
    payload: row.payload,
    submittedAt: row.submitted_at,
  };
}

function queryPath(table, parameters) {
  return `/rest/v1/${table}?${new URLSearchParams({ environment: `eq.${environment()}`, ...parameters })}`;
}

function insertPath(table, parameters) {
  return `/rest/v1/${table}?${new URLSearchParams(parameters)}`;
}

async function request(path, options = {}) {
  const config = getSupabaseConfig();
  if (!config.ok) throw new AssessmentStoreError(503, "Assessment storage is not connected yet. Please try again shortly.");
  let response;
  try {
    response = await fetch(`${config.url}${path}`, {
      ...options,
      headers: { ...config.headers, "Content-Type": "application/json", ...options.headers },
      signal: AbortSignal.timeout(12000),
    });
  } catch {
    throw new AssessmentStoreError(503, "Assessment storage could not be reached. Keep this page open and try again.");
  }
  if (!response.ok) {
    if (response.status === 409) throw new AssessmentStoreError(409, "A record with this ID or session code already exists.");
    throw new AssessmentStoreError(503, "Assessment storage could not complete this request. Keep this page open and try again.");
  }
  let data;
  try { data = await response.json(); } catch { throw new AssessmentStoreError(503, "The storage response was incomplete. Please try again."); }
  if (!Array.isArray(data)) throw new AssessmentStoreError(503, "The storage response was incomplete. Please try again.");
  return data;
}

async function listSessions() {
  const rows = await request(queryPath(SESSION_TABLE, { select: SESSION_FIELDS, order: "created_at.asc,id.asc", limit: "501" }));
  if (rows.length > 500) throw new AssessmentStoreError(503, "This workspace has more sessions than can be loaded at once. Please contact Attenor.");
  return rows.map(toSession);
}

async function getSession(slug) {
  if (typeof slug !== "string" || !SLUG.test(slug)) throw new AssessmentStoreError(400, "Please provide a valid session code.");
  const rows = await request(queryPath(SESSION_TABLE, { slug: `eq.${slug}`, select: SESSION_FIELDS, limit: "1" }));
  return rows[0] ? toSession(rows[0]) : null;
}

async function createSession(session) {
  const row = sessionRow(session);
  const rows = await request(insertPath(SESSION_TABLE, { select: SESSION_FIELDS }), {
    method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(row),
  });
  if (rows.length !== 1 || rows[0].id !== row.id || rows[0].environment !== row.environment) {
    throw new AssessmentStoreError(503, "The new session could not be confirmed. Please try again.");
  }
  return toSession(rows[0]);
}

async function ensureSession(session) {
  const row = sessionRow(session);
  const rows = await request(insertPath(SESSION_TABLE, { on_conflict: "environment,id", select: SESSION_FIELDS }), {
    method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=representation" }, body: JSON.stringify(row),
  });
  if (rows.length === 1 && rows[0].id === row.id && rows[0].environment === row.environment) return toSession(rows[0]);
  const existing = await getSession(row.slug);
  if (!existing || existing.id !== row.id) throw new AssessmentStoreError(409, "This session code is already assigned to another session.");
  return existing;
}

function canonical(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  throw new AssessmentStoreError(400, "Please provide valid response data.");
}

function responseRow(response) {
  if (!response || !UUID.test(response.id || "") || (response.participantId != null && !UUID.test(response.participantId))) {
    throw new AssessmentStoreError(400, "Please provide a valid response ID.");
  }
  if (!response.payload || typeof response.payload !== "object" || Array.isArray(response.payload)) {
    throw new AssessmentStoreError(400, "Please provide valid response data.");
  }
  let payload;
  try {
    payload = canonical(response.payload);
    if (Buffer.byteLength(JSON.stringify(payload), "utf8") > 25000) throw new Error("size");
  } catch {
    throw new AssessmentStoreError(400, "Please provide valid response data within the response limit.");
  }
  return {
    environment: environment(), id: response.id.toLowerCase(),
    session_id: textValue(response.sessionId, "session ID", 100),
    participant_id: response.participantId?.toLowerCase() || null,
    type: typeValue(response.type), payload,
  };
}

function receiptFor(row, expected) {
  if (!row || row.id !== expected.id || row.environment !== expected.environment || typeof row.submitted_at !== "string" || Number.isNaN(Date.parse(row.submitted_at))) {
    throw new AssessmentStoreError(503, "The save could not be confirmed. Keep this page open and retry.");
  }
  const same = row.session_id === expected.session_id && row.participant_id === expected.participant_id && row.type === expected.type && JSON.stringify(canonical(row.payload)) === JSON.stringify(expected.payload);
  if (!same) throw new AssessmentStoreError(409, "This response was already submitted with different answers. Contact your facilitator to make a change.");
  return { id: row.id, submittedAt: row.submitted_at };
}

async function saveResponse(response) {
  const row = responseRow(response);
  const rows = await request(insertPath(RESPONSE_TABLE, { on_conflict: "environment,id", select: RESPONSE_FIELDS }), {
    method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=representation" }, body: JSON.stringify(row),
  });
  if (rows.length === 1) return receiptFor(rows[0], row);
  if (rows.length !== 0) throw new AssessmentStoreError(503, "The save could not be confirmed. Keep this page open and retry.");
  const existing = await request(queryPath(RESPONSE_TABLE, { id: `eq.${row.id}`, select: RESPONSE_FIELDS, limit: "1" }));
  return receiptFor(existing[0], row);
}

async function listResponses(sessionId) {
  const id = textValue(sessionId, "session ID", 100);
  const rows = [];
  // Explicit pagination avoids the Data API's default per-request row cap.
  // Refuse a partial aggregate if the configured session exceeds the supported bound.
  for (let offset = 0; offset <= MAX_RESPONSES; offset += PAGE_SIZE) {
    const page = await request(queryPath(RESPONSE_TABLE, { session_id: `eq.${id}`, select: RESPONSE_FIELDS, order: "submitted_at.asc,id.asc", offset: String(offset), limit: String(offset === MAX_RESPONSES ? 1 : PAGE_SIZE) }));
    rows.push(...page);
    if (rows.length > MAX_RESPONSES) throw new AssessmentStoreError(503, "This session has more responses than can be summarized at once. Please contact Attenor.");
    if (page.length < PAGE_SIZE) return rows.map(toResponse);
  }
  return rows.map(toResponse);
}

module.exports = { available, environment, listSessions, getSession, createSession, ensureSession, saveResponse, listResponses, AssessmentStoreError };
