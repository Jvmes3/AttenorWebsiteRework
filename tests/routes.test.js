const test = require("node:test");
const assert = require("node:assert/strict");
const { scryptSync } = require("node:crypto");

const login = require("../api/login");
const session = require("../api/session");
const impactDocument = require("../api/impact-document");

const salt = "route-test-salt";
const password = "route-test-password";
const passwordHash = `scrypt$${salt}$${scryptSync(password, salt, 64).toString("base64url")}`;

process.env.SESSION_SECRET = "route-test-secret-with-at-least-thirty-two-characters";
process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-test-key";
process.env.ATTENOR_ACCOUNTS_JSON = JSON.stringify([
  {
    username: "one",
    displayName: "Account One",
    passwordHash,
    documents: [
      {
        id: "one-report",
        title: "Account One Report",
        storagePath: "one/report.pdf",
        filename: "report.pdf",
      },
    ],
  },
  { username: "two", passwordHash, documents: [] },
  { username: "three", passwordHash, documents: [] },
  { username: "four", passwordHash, documents: [] },
]);

function responseMock() {
  return {
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
    },
    end(body) {
      this.body = body;
    },
  };
}

test("login creates a server-only cookie and session returns only assigned metadata", async () => {
  const loginResponse = responseMock();
  await login(
    { method: "POST", body: { username: "one", password }, headers: {} },
    loginResponse,
  );

  assert.equal(loginResponse.statusCode, 200);
  assert.match(loginResponse.headers["Set-Cookie"], /HttpOnly/);
  assert.match(loginResponse.headers["Set-Cookie"], /SameSite=Lax/);

  const sessionResponse = responseMock();
  await session(
    { method: "GET", headers: { cookie: loginResponse.headers["Set-Cookie"] } },
    sessionResponse,
  );

  const body = JSON.parse(sessionResponse.body);
  assert.equal(body.account.username, "one");
  assert.deepEqual(body.account.documents, [
    { id: "one-report", title: "Account One Report" },
  ]);
});

test("document endpoint rejects a document not assigned to the signed-in account", async () => {
  const loginResponse = responseMock();
  await login(
    { method: "POST", body: { username: "two", password }, headers: {} },
    loginResponse,
  );

  const downloadResponse = responseMock();
  await impactDocument(
    {
      method: "GET",
      query: { id: "one-report" },
      headers: { cookie: loginResponse.headers["Set-Cookie"] },
    },
    downloadResponse,
  );

  assert.equal(downloadResponse.statusCode, 404);
});

test("assigned document is fetched through the authenticated private-storage endpoint", async (context) => {
  const loginResponse = responseMock();
  await login(
    { method: "POST", body: { username: "one", password }, headers: {} },
    loginResponse,
  );

  const originalFetch = global.fetch;
  context.after(() => (global.fetch = originalFetch));
  let requestedUrl;
  global.fetch = async (url) => {
    requestedUrl = url;
    return new Response("private pdf", { status: 200, headers: { "Content-Type": "application/pdf" } });
  };

  const downloadResponse = responseMock();
  await impactDocument(
    {
      method: "GET",
      query: { id: "one-report" },
      headers: { cookie: loginResponse.headers["Set-Cookie"] },
    },
    downloadResponse,
  );

  assert.equal(downloadResponse.statusCode, 200);
  assert.equal(
    requestedUrl,
    "https://example.supabase.co/storage/v1/object/authenticated/impact-documents/one/report.pdf",
  );
  assert.equal(downloadResponse.headers["Content-Type"], "application/pdf");
});
