const { currentAccount, sendJson } = require("./_lib/http");
const embeddedDocuments = require("./_lib/wayman-documents");
const { getSupabaseConfig } = require("./_lib/supabase");

function safeFilename(value) {
  return String(value || "document.pdf").replace(/[^a-zA-Z0-9._-]/g, "-");
}

function prepareEmbeddedHtml(encodedDocument, zoom, shouldPrint) {
  let html = Buffer.from(encodedDocument, "base64").toString("utf8");
  const additions = [
    `<style id="attenor-viewer-zoom">html { zoom: ${zoom}; }</style>`,
    shouldPrint ? '<script>window.addEventListener("load",function(){setTimeout(function(){window.print()},350)})</script>' : "",
  ].join("");
  return html.replace(/<\/head>/i, `${additions}</head>`);
}

module.exports = async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return sendJson(response, 405, { error: "Method not allowed." });
  }

  try {
    const account = currentAccount(request);
    if (!account) return sendJson(response, 401, { error: "Sign in is required." });

    const document = (account.documents || []).find((item) => item.id === request.query.id);
    if (!document) {
      return sendJson(response, 404, { error: "Document not found." });
    }

    const mode = ["view", "print", "download"].includes(request.query.mode)
      ? request.query.mode
      : "download";

    if (document.embeddedKey && embeddedDocuments[document.embeddedKey]) {
      const requestedZoom = Number(request.query.zoom || 1);
      const zoom = Math.min(1.5, Math.max(0.6, Number.isFinite(requestedZoom) ? requestedZoom : 1));
      const html = prepareEmbeddedHtml(
        embeddedDocuments[document.embeddedKey],
        zoom,
        mode === "print",
      );

      response.statusCode = 200;
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.setHeader(
        "Content-Disposition",
        `${mode === "download" ? "attachment" : "inline"}; filename="${safeFilename(document.filename)}"`,
      );
      response.setHeader("Cache-Control", "private, no-store");
      response.setHeader("X-Content-Type-Options", "nosniff");
      response.setHeader("X-Frame-Options", "SAMEORIGIN");
      response.setHeader(
        "Content-Security-Policy",
        "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'unsafe-inline'; img-src data:; frame-ancestors 'self'; base-uri 'none'; form-action 'none'",
      );
      return response.end(html);
    }

    if (!document.storagePath) {
      return sendJson(response, 404, { error: "Document not found." });
    }

    const supabase = getSupabaseConfig();
    if (!supabase.ok) {
      return sendJson(response, 503, { error: supabase.error });
    }

    const storagePath = document.storagePath
      .split("/")
      .map(encodeURIComponent)
      .join("/");
    const file = await fetch(
      `${supabase.url}/storage/v1/object/authenticated/impact-documents/${storagePath}`,
      {
        headers: supabase.headers,
      },
    );

    if (!file.ok) {
      console.error("Impact document fetch failed", file.status, await file.text());
      return sendJson(response, file.status === 404 ? 404 : 502, { error: "Document unavailable." });
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    response.statusCode = 200;
    response.setHeader("Content-Type", file.headers.get("content-type") || "application/octet-stream");
    response.setHeader("Content-Disposition", `attachment; filename="${safeFilename(document.filename)}"`);
    response.setHeader("Cache-Control", "private, no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    return response.end(bytes);
  } catch (error) {
    console.error("Impact document endpoint failed", error);
    return sendJson(response, 503, { error: "Document access is not configured yet." });
  }
};
