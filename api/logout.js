const { sendJson, sessionCookie } = require("./_lib/http");

module.exports = async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return sendJson(response, 405, { error: "Method not allowed." });
  }

  response.setHeader("Set-Cookie", sessionCookie("", 0));
  return sendJson(response, 200, { loggedOut: true });
};
