const {
  getAccounts,
  publicAccount,
  readJson,
  sendJson,
  sessionCookie,
  signSession,
  verifyPassword,
} = require("./_lib/http");

module.exports = async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return sendJson(response, 405, { error: "Method not allowed." });
  }

  try {
    const { username, password } = await readJson(request);
    const normalizedUsername = String(username || "").trim().toLowerCase();
    const account = getAccounts().find(
      (candidate) => String(candidate.username).toLowerCase() === normalizedUsername,
    );

    if (!account || !verifyPassword(password, account.passwordHash)) {
      return sendJson(response, 401, { error: "The username or password is incorrect." });
    }

    response.setHeader("Set-Cookie", sessionCookie(signSession(account.username)));
    return sendJson(response, 200, { account: publicAccount(account) });
  } catch (error) {
    console.error("Login endpoint failed", error);
    return sendJson(response, 503, { error: "Account access is not configured yet." });
  }
};
