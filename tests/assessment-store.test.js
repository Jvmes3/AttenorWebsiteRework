const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const store = require("../api/_lib/assessment-store");

const ENV_KEYS = ["SUPABASE_URL", "SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY", "VERCEL_ENV"];
const savedEnvironment = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
const originalFetch = global.fetch;
const submittedAt = "2026-11-07T21:00:00.000Z";
const session = { id: "team-one", slug: "team-one", name: "Team reflection", organization: "Example School", type: "leadership", expectedParticipants: 15, status: "open", passwordHash: "scrypt$test-salt$test-hash" };

test.beforeEach(() => {
  process.env.SUPABASE_URL = "https://store-test.supabase.co";
  process.env.SUPABASE_SECRET_KEY = "sb_secret_server-only-test-key";
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.VERCEL_ENV = "preview";
});

test.afterEach(() => {
  global.fetch = originalFetch;
  for (const key of ENV_KEYS) {
    if (savedEnvironment[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnvironment[key];
  }
});

function storedSession(overrides = {}) {
  return { environment: "test", id: session.id, slug: session.slug, name: session.name, organization: session.organization, type: session.type, benchmark: null, expected_participants: session.expectedParticipants, status: session.status, password_hash: session.passwordHash, created_at: submittedAt, ...overrides };
}

test("reads always scope sessions to test or production and keep secret keys in headers", async () => {
  const requests = [];
  global.fetch = async (url, options) => { requests.push({ url: new URL(url), options }); return Response.json([]); };
  assert.equal(store.available(), true);
  assert.equal(store.environment(), "test");
  await store.listSessions();
  process.env.VERCEL_ENV = "production";
  assert.equal(store.environment(), "production");
  assert.equal(await store.getSession("team-one"), null);
  assert.equal(requests[0].url.searchParams.get("environment"), "eq.test");
  assert.equal(requests[1].url.searchParams.get("environment"), "eq.production");
  assert.equal(requests[1].url.searchParams.get("slug"), "eq.team-one");
  assert.equal(requests[0].options.headers.apikey, "sb_secret_server-only-test-key");
  assert.equal(requests[0].options.headers.Authorization, undefined);
  assert.doesNotMatch(requests[0].url.href, /sb_secret/);
});

test("legacy service credentials use the server authorization header", async () => {
  delete process.env.SUPABASE_SECRET_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "legacy-service-test-key";
  global.fetch = async (url, options) => {
    assert.equal(options.headers.Authorization, "Bearer legacy-service-test-key");
    return Response.json([storedSession()]);
  };
  const result = await store.getSession("team-one");
  assert.equal(result.passwordHash, session.passwordHash);
  assert.equal(result.expectedParticipants, 15);
  assert.equal(result.createdAt, submittedAt);
});

test("unconfigured storage fails closed before attempting a save", async () => {
  delete process.env.SUPABASE_SECRET_KEY;
  let fetched = false;
  global.fetch = async () => { fetched = true; throw new Error("must not fetch"); };
  assert.equal(store.available(), false);
  await assert.rejects(store.createSession(session), (error) => error.status === 503);
  assert.equal(fetched, false);
});

test("session creation maps server fields and persists the environment partition", async () => {
  process.env.VERCEL_ENV = "production";
  global.fetch = async (url, options) => {
    const data = JSON.parse(options.body);
    assert.equal(options.method, "POST");
    assert.equal(data.environment, "production");
    assert.equal(data.expected_participants, 15);
    assert.equal(data.password_hash, session.passwordHash);
    assert.equal(data.expectedParticipants, undefined);
    assert.equal(options.headers.Prefer, "return=representation");
    return Response.json([{ ...data, created_at: submittedAt }]);
  };
  const created = await store.createSession(session);
  assert.equal(created.slug, session.slug);
  assert.equal(created.expectedParticipants, 15);
});

test("ensuring an existing seed preserves its stored password instead of overwriting it", async () => {
  let calls = 0;
  global.fetch = async (url, options) => {
    calls++;
    const parsed = new URL(url);
    if (options.method === "POST") {
      assert.equal(parsed.searchParams.get("on_conflict"), "environment,id");
      assert.match(options.headers.Prefer, /resolution=ignore-duplicates/);
      return Response.json([]);
    }
    assert.equal(parsed.searchParams.get("environment"), "eq.test");
    return Response.json([storedSession({ password_hash: "scrypt$prior-salt$prior-hash" })]);
  };
  const existing = await store.ensureSession(session);
  assert.equal(existing.passwordHash, "scrypt$prior-salt$prior-hash");
  assert.equal(calls, 2);
});

test("response retry uses the original receipt and canonical JSONB ordering", async () => {
  const id = randomUUID();
  const participantId = randomUUID();
  const response = { id, sessionId: session.id, participantId, type: "leadership", payload: { ratings: [{ score: 4, dimension: "data-use", explanation: "Practice example" }], note: "Practice" } };
  let stored;
  let posts = 0;
  global.fetch = async (url, options) => {
    if (options.method === "POST") {
      posts++;
      assert.equal(new URL(url).searchParams.get("on_conflict"), "environment,id");
      const data = JSON.parse(options.body);
      assert.equal(data.environment, "test");
      if (stored) return Response.json([]);
      assert.equal(data.participant_id, participantId);
      stored = { ...data, submitted_at: submittedAt };
      return Response.json([stored]);
    }
    assert.equal(new URL(url).searchParams.get("environment"), "eq.test");
    return Response.json([{ ...stored, payload: { note: "Practice", ratings: [{ explanation: "Practice example", dimension: "data-use", score: 4 }] } }]);
  };
  const first = await store.saveResponse(response);
  const retry = await store.saveResponse(response);
  assert.deepEqual(first, { id, submittedAt });
  assert.deepEqual(retry, first);
  assert.equal(posts, 2);
  await assert.rejects(store.saveResponse({ ...response, participantId: randomUUID() }), (error) => error.status === 409);
});

test("a duplicate ID cannot overwrite another session or changed answers", async () => {
  const id = randomUUID();
  const existing = { environment: "test", id, session_id: "another-team", participant_id: null, type: "benchmark", payload: { answers: ["A"] }, submitted_at: submittedAt };
  global.fetch = async (url, options) => Response.json(options.method === "POST" ? [] : [existing]);
  await assert.rejects(store.saveResponse({ id, sessionId: session.id, type: "benchmark", payload: { answers: ["B"] } }), (error) => error.status === 409);
});

test("save failures and missing receipts never report a successful save", async () => {
  const response = { id: randomUUID(), sessionId: session.id, type: "leadership", payload: { ratings: [] } };
  global.fetch = async () => Response.json({ message: "private provider details" }, { status: 500 });
  await assert.rejects(store.saveResponse(response), (error) => error.status === 503 && !error.message.includes("private provider"));
  global.fetch = async () => Response.json([]);
  await assert.rejects(store.saveResponse(response), (error) => error.status === 503);
  global.fetch = async () => { throw new Error("private connection details"); };
  await assert.rejects(store.saveResponse(response), (error) => error.status === 503 && !error.message.includes("private connection"));
});

test("response queries scope the exact session and paginate past a provider row cap", async () => {
  const row = { environment: "test", id: randomUUID(), session_id: session.id, participant_id: null, type: "leadership", payload: { ratings: [] }, submitted_at: submittedAt };
  const offsets = [];
  global.fetch = async (url) => {
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get("environment"), "eq.test");
    assert.equal(parsed.searchParams.get("session_id"), `eq.${session.id}`);
    const offset = Number(parsed.searchParams.get("offset"));
    offsets.push(offset);
    return Response.json(offset === 0 ? Array.from({ length: 500 }, () => row) : [row]);
  };
  const responses = await store.listResponses(session.id);
  assert.deepEqual(offsets, [0, 500]);
  assert.equal(responses.length, 501);
  assert.equal(responses[0].sessionId, session.id);
  assert.equal(responses[0].submittedAt, submittedAt);
});

test("oversized aggregates fail instead of returning an incomplete count", async () => {
  const row = { environment: "test", id: randomUUID(), session_id: session.id, participant_id: null, type: "benchmark", payload: {}, submitted_at: submittedAt };
  global.fetch = async (url) => Response.json(Array.from({ length: Number(new URL(url).searchParams.get("limit")) }, () => row));
  await assert.rejects(store.listResponses(session.id), (error) => error.status === 503);
});

test("invalid session or response data cannot reach the database", async () => {
  let requests = 0;
  global.fetch = async () => { requests++; return Response.json([]); };
  await assert.rejects(store.getSession("team-one&environment=eq.production"), (error) => error.status === 400);
  await assert.rejects(store.createSession({ ...session, expectedParticipants: 20 }), (error) => error.status === 400);
  await assert.rejects(store.saveResponse({ id: randomUUID(), sessionId: session.id, type: "leadership", payload: { invalid: Infinity } }), (error) => error.status === 400);
  assert.equal(requests, 0);
});
