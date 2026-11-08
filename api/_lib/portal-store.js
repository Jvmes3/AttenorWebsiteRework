const { getSupabaseConfig } = require("./supabase");

function previewEnabled() {
  return process.env.VERCEL_ENV !== "production" && (
    process.env.ATTENOR_ASSESSMENT_PREVIEW === "1" ||
    (process.env.VERCEL_ENV === "preview" && process.env.VERCEL_GIT_COMMIT_REF === "test-production")
  );
}

function environment() { return process.env.VERCEL_ENV === "production" ? "production" : "test"; }

class PortalStoreError extends Error {
  constructor(message, code) { super(message); this.status = 503; this.code = code; }
}

async function request(path, options = {}) {
  const config = getSupabaseConfig();
  if (!config.ok) throw new PortalStoreError("Portal storage is not connected yet. Please check with your facilitator.");
  if (!/^\/rest\/v1\/portal_[a-z_]+(?:\?|$)/.test(path)) throw new PortalStoreError("The portal storage request is unavailable.");
  let response;
  try {
    response = await fetch(`${config.url}${path}`, {
      ...options,
      headers: { ...config.headers, "Content-Type": "application/json", ...options.headers },
      signal: AbortSignal.timeout(12000),
    });
  } catch { throw new PortalStoreError("Portal storage could not be reached. Keep this page open and try again."); }
  if (!response.ok) throw new PortalStoreError("Portal storage could not complete this request. Please try again.", response.status);
  if (response.status === 204) return null;
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { throw new PortalStoreError("Portal storage returned an incomplete response. Please try again."); }
}

module.exports = { request, environment, previewEnabled, PortalStoreError };
