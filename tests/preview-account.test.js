const test = require("node:test");
const assert = require("node:assert/strict");

delete process.env.ATTENOR_ACCOUNTS_JSON;
process.env.VERCEL_ENV = "preview";
process.env.SESSION_SECRET = "preview-test-secret-with-at-least-thirty-two-characters";

const login = require("../api/login");
const session = require("../api/session");
const impactDocument = require("../api/impact-document");

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

test("preview user1 can access both Wayman documents", async () => {
  const loginResponse = responseMock();
  await login(
    { method: "POST", body: { username: "user1", password: "1234" }, headers: {} },
    loginResponse,
  );
  assert.equal(loginResponse.statusCode, 200);

  const sessionResponse = responseMock();
  await session(
    { method: "GET", headers: { cookie: loginResponse.headers["Set-Cookie"] } },
    sessionResponse,
  );
  const account = JSON.parse(sessionResponse.body).account;
  assert.equal(account.displayName, "Wayman Academy of the Arts");
  assert.equal(account.documents.length, 2);

  const documentResponse = responseMock();
  await impactDocument(
    {
      method: "GET",
      query: { id: "wayman-story-of-impact", mode: "view", zoom: "1.2" },
      headers: { cookie: loginResponse.headers["Set-Cookie"] },
    },
    documentResponse,
  );
  assert.equal(documentResponse.statusCode, 200);
  assert.equal(documentResponse.headers["Content-Type"], "text/html; charset=utf-8");
  assert.match(documentResponse.headers["Content-Disposition"], /^inline/);
  assert.match(documentResponse.body, /Wayman Academy of the Arts/);
  assert.match(documentResponse.body, /html \{ zoom: 1.2; \}/);
});

test("preview fallback is unavailable when Vercel marks the deployment production", async () => {
  process.env.VERCEL_ENV = "production";
  const response = responseMock();
  await login(
    { method: "POST", body: { username: "user1", password: "1234" }, headers: {} },
    response,
  );
  assert.equal(response.statusCode, 503);
  process.env.VERCEL_ENV = "preview";
});
