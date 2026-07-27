const test = require("node:test");
const assert = require("node:assert/strict");
const { scryptSync } = require("node:crypto");

const {
  currentAccount,
  publicAccount,
  sessionCookie,
  signSession,
  verifyPassword,
} = require("../api/_lib/http");

const salt = "test-salt";
const password = "long-test-password";
const passwordHash = `scrypt$${salt}$${scryptSync(password, salt, 64).toString("base64url")}`;

process.env.SESSION_SECRET = "test-secret-with-more-than-thirty-two-characters";
process.env.ATTENOR_ACCOUNTS_JSON = JSON.stringify([
  {
    username: "client-one",
    displayName: "Client One",
    passwordHash,
    documents: [
      {
        id: "report",
        title: "Private report",
        description: "For this client only.",
        storagePath: "client-one/report.pdf",
        filename: "report.pdf",
      },
    ],
  },
  { username: "client-two", passwordHash, documents: [] },
  { username: "client-three", passwordHash, documents: [] },
  { username: "client-four", passwordHash, documents: [] },
]);

test("scrypt password verification accepts only the correct password", () => {
  assert.equal(verifyPassword(password, passwordHash), true);
  assert.equal(verifyPassword("incorrect-password", passwordHash), false);
});

test("signed session resolves the intended account", () => {
  const token = signSession("client-one");
  const request = { headers: { cookie: sessionCookie(token) } };
  assert.equal(currentAccount(request).username, "client-one");
});

test("tampered session is rejected", () => {
  const token = `${signSession("client-one")}tampered`;
  const request = { headers: { cookie: `attenor_impact_session=${token}` } };
  assert.equal(currentAccount(request), null);
});

test("browser account data excludes password hashes and storage paths", () => {
  const account = currentAccount({
    headers: { cookie: sessionCookie(signSession("client-one")) },
  });
  const exposed = publicAccount(account);
  assert.equal(exposed.passwordHash, undefined);
  assert.equal(exposed.documents[0].storagePath, undefined);
  assert.deepEqual(exposed.documents[0], {
    id: "report",
    title: "Private report",
    description: "For this client only.",
  });
});
