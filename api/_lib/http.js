const { createHmac, scryptSync, timingSafeEqual } = require("node:crypto");

const SESSION_COOKIE = "attenor_impact_session";
const SESSION_MAX_AGE = 60 * 60 * 8;
const PREVIEW_ACCOUNTS = [
  {
    username: "user1",
    displayName: "Wayman Academy of the Arts",
    passwordHash:
      "scrypt$attenor-wayman-preview-eagles-fy26$S_MB8yAPS86Q5nNYaxflvdpDmlzZUtxevxk_tEBG21eS-E4bLQarEU1bSmq4ARxj7NuqU34wqJ2Tg-IGEgLYgw",
    documents: [
      {
        id: "wayman-story-of-impact",
        title: "Wayman Story of Impact",
        description: "An interactive account of Wayman Academy's progress and trajectory.",
        embeddedKey: "storyOfImpact",
        filename: "wayman-story-of-impact.pdf",
        pdfFilename: "wayman-story-of-impact.pdf",
      },
      {
        id: "wayman-path-to-b",
        title: "Wayman: The Path to B",
        description: "A focused planning brief outlining the components, targets, and investments.",
        embeddedKey: "pathToB",
        filename: "wayman-path-to-b-brief.pdf",
        pdfFilename: "wayman-path-to-b-brief.pdf",
      },
    ],
  },
];

function sendJson(response, status, body) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  if (request.body && typeof request.body === "object") return request.body;

  let raw = "";
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 20_000) throw new Error("Request is too large.");
  }

  return raw ? JSON.parse(raw) : {};
}

function getAccounts() {
  const raw = process.env.ATTENOR_ACCOUNTS_JSON;
  if (!raw) {
    if (process.env.VERCEL_ENV === "production") {
      throw new Error("Production account access is not configured.");
    }
    return PREVIEW_ACCOUNTS;
  }

  const accounts = JSON.parse(raw);
  if (!Array.isArray(accounts) || accounts.length < 1) {
    throw new Error("ATTENOR_ACCOUNTS_JSON must contain at least one account.");
  }

  return accounts;
}

function getSessionSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET must contain at least 32 characters.");
  }
  return secret;
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function verifyPassword(password, storedHash) {
  const [scheme, salt, expected] = String(storedHash || "").split("$");
  if (scheme !== "scrypt" || !salt || !expected) return false;

  const calculated = scryptSync(String(password), salt, 64).toString("base64url");
  return safeEqual(calculated, expected);
}

function encode(value) {
  return Buffer.from(value).toString("base64url");
}

function signSession(username) {
  const payload = encode(
    JSON.stringify({ sub: username, exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE }),
  );
  const signature = createHmac("sha256", getSessionSecret()).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function verifySession(token) {
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;

  const expected = createHmac("sha256", getSessionSecret()).update(payload).digest("base64url");
  if (!safeEqual(signature, expected)) return null;

  const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  if (!session.sub || session.exp <= Math.floor(Date.now() / 1000)) return null;
  return session;
}

function parseCookies(request) {
  return String(request.headers.cookie || "")
    .split(";")
    .reduce((cookies, pair) => {
      const separator = pair.indexOf("=");
      if (separator < 0) return cookies;
      cookies[pair.slice(0, separator).trim()] = decodeURIComponent(pair.slice(separator + 1));
      return cookies;
    }, {});
}

function sessionCookie(token, maxAge = SESSION_MAX_AGE) {
  const secure = process.env.VERCEL ? "; Secure" : "";
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

function currentAccount(request) {
  const session = verifySession(parseCookies(request)[SESSION_COOKIE]);
  if (!session) return null;
  return getAccounts().find((account) => account.username === session.sub) || null;
}

function publicAccount(account) {
  return {
    username: account.username,
    displayName: account.displayName,
    documents: (account.documents || []).map(({ id, title, description }) => ({
      id,
      title,
      description,
    })),
  };
}

module.exports = {
  currentAccount,
  getAccounts,
  publicAccount,
  readJson,
  sendJson,
  sessionCookie,
  signSession,
  verifyPassword,
};
