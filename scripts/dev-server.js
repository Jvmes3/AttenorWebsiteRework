const http = require("node:http");
const { readFile } = require("node:fs/promises");
const { extname, join, normalize } = require("node:path");
const { randomBytes } = require("node:crypto");

const root = join(__dirname, "..");
const port = Number(process.env.PORT || 8000);

process.env.VERCEL_ENV ||= "preview";
process.env.SESSION_SECRET ||= randomBytes(48).toString("base64url");

const apiRoutes = {
  "/api/leads": require("../api/leads"),
  "/api/login": require("../api/login"),
  "/api/logout": require("../api/logout"),
  "/api/session": require("../api/session"),
  "/api/impact-document": require("../api/impact-document"),
};

const pageRoutes = {
  "/": "index.html",
  "/login": "login.html",
  "/impact": "impact.html",
};

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".md": "text/markdown; charset=utf-8",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

function publicFile(pathname) {
  if (pageRoutes[pathname]) return pageRoutes[pathname];

  const cleaned = normalize(pathname).replace(/^[/\\]+/, "");
  const isRootAsset = ["index.html", "login.html", "impact.html", "script.js", "login.js", "impact.js", "styles.css"].includes(cleaned);
  const isPublicDirectory = cleaned.startsWith("assets/") || cleaned.startsWith("resources/");
  return isRootAsset || isPublicDirectory ? cleaned : null;
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || `localhost:${port}`}`);
  const apiHandler = apiRoutes[url.pathname];

  try {
    if (apiHandler) {
      request.query = Object.fromEntries(url.searchParams);
      await apiHandler(request, response);
      return;
    }

    const relativePath = publicFile(url.pathname);
    if (!relativePath) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }

    const contents = await readFile(join(root, relativePath));
    response.writeHead(200, {
      "Content-Type": mimeTypes[extname(relativePath).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    response.end(contents);
  } catch (error) {
    console.error(error);
    if (!response.headersSent) {
      response.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    }
    response.end(JSON.stringify({ error: "Local preview error." }));
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Attenor local preview: http://localhost:${port}`);
  console.log("Preview login: user1 / 1234");
  console.log("Press Ctrl+C to stop the server.");
});
