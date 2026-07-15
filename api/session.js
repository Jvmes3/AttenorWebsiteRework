const { currentAccount, publicAccount, sendJson } = require("./_lib/http");

module.exports = async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return sendJson(response, 405, { error: "Method not allowed." });
  }

  try {
    const account = currentAccount(request);
    if (!account) return sendJson(response, 401, { error: "Sign in is required." });
    return sendJson(response, 200, { account: publicAccount(account) });
  } catch (error) {
    console.error("Session endpoint failed", error);
    return sendJson(response, 503, { error: "Account access is not configured yet." });
  }
};
