const http = require("node:http");
const { readFile } = require("node:fs/promises");
const { extname, join, normalize } = require("node:path");
const { randomBytes } = require("node:crypto");
const { getSupabaseConfig } = require("../api/_lib/supabase");

const root = join(__dirname, "..");
const port = Number(process.env.PORT || 8000);

process.env.VERCEL_ENV ||= "preview";
process.env.SESSION_SECRET ||= randomBytes(48).toString("base64url");
// This development server is the only entry point that enables disposable assessment data.
// Deployed API functions require explicit configuration and reject preview mode in production.
process.env.ATTENOR_ASSESSMENT_PREVIEW ??= "1";

const apiRoutes = {
  "/api/leads": require("../api/leads"),
  "/api/login": require("../api/login"),
  "/api/logout": require("../api/logout"),
  "/api/session": require("../api/session"),
  "/api/impact-document": require("../api/impact-document"),
  "/api/wayman": require("../api/wayman"),
  "/api/portal": require("../api/portal"),
  "/api/assessment-session": require("../api/assessment-session"),
  "/api/assessment-access": require("../api/assessment-access"),
  "/api/assessment-questions": require("../api/assessment-questions"),
  "/api/assessment-submit": require("../api/assessment-submit"),
  "/api/assessment-admin": require("../api/assessment-admin"),
};

const pageRoutes = {
  "/": "index.html",
  "/login": "login.html",
  "/impact": "impact.html",
  "/portal": "portal.html",
  "/wayman": "wayman.html",
  "/assessments": "assessments.html",
  "/coherence": "assessments.html",
  "/facilitator": "assessments.html",
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
  const routePath = pathname.replace(/\/$/, "") || "/";
  if (pageRoutes[routePath]) return pageRoutes[routePath];
  if (/^\/coherence\/[a-z0-9][a-z0-9-]{0,79}$/.test(routePath)) return "assessments.html";
  if (/^\/benchmark-(?:[1-9]|1[0-9]|2[0-2])$/.test(routePath)) return "wayman.html";

  const cleaned = normalize(pathname).replace(/^[/\\]+/, "");
  const isRootAsset = ["index.html", "login.html", "impact.html", "assessments.html", "script.js", "login.js", "impact.js", "assessments.js", "portal.html", "portal.js", "portal.css", "wayman.html", "wayman.js", "wayman.css", "styles.css", "assessments.css"].includes(cleaned);
  const isPublicDirectory = cleaned.startsWith("assets/") || cleaned.startsWith("resources/");
  return isRootAsset || isPublicDirectory ? cleaned : null;
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || `localhost:${port}`}`);
  const schoolHost = require("../api/_lib/wayman").isWaymanHost(request);
  const schoolRedirect = schoolHost && /^\/(?:portal|assessments|profile|facilitator|login|impact|index|coherence)(?:\.html|\/.*)?$/.test(url.pathname);
  if (schoolRedirect || url.pathname === "/profile") {
    response.writeHead(302, { Location: schoolHost ? "/" : "/wayman", "Cache-Control": "no-store" });
    response.end(); return;
  }
  const apiHandler = apiRoutes[url.pathname];

  try {
    if (apiHandler) {
      request.query = Object.fromEntries(url.searchParams);
      await apiHandler(request, response);
      return;
    }

    const relativePath = schoolHost && url.pathname === "/" ? "wayman.html" : publicFile(url.pathname);
    if (!relativePath) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }

    const contents = await readFile(join(root, relativePath));
    response.writeHead(200, {
      "Content-Type": mimeTypes[extname(relativePath).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-store",
      ...(["assessments.html", "portal.html", "wayman.html"].includes(relativePath) ? { "X-Robots-Tag": "noindex, nofollow, noarchive", "Referrer-Policy": "same-origin" } : {}),
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
  if (process.env.ATTENOR_ACCOUNTS_JSON) {
    try {
      const accounts = JSON.parse(process.env.ATTENOR_ACCOUNTS_JSON);
      console.log(`Account configuration: .env.local (${accounts.map((account) => account.username).join(", ")})`);
    } catch {
      console.log("Account configuration: ATTENOR_ACCOUNTS_JSON is invalid JSON");
    }
  } else {
    console.log("Built-in preview login: Wayman / Eagles_FY26!");
  }
  const supabase = getSupabaseConfig();
  console.log(`Lead storage: ${supabase.ok ? "configured" : supabase.error}`);
  console.log(`Assessment Studio: http://localhost:${port}/assessments (${process.env.ATTENOR_ASSESSMENT_PREVIEW === "1" && process.env.VERCEL_ENV !== "production" ? "test portal; configured Supabase records persist" : "configured sessions only"})`);
  console.log("Press Ctrl+C to stop the server.");
});
