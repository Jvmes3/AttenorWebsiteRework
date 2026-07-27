function getSupabaseConfig() {
  const rawUrl = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!rawUrl || !key) {
    return {
      ok: false,
      error: "Supabase is not configured. Add SUPABASE_URL and SUPABASE_SECRET_KEY to .env.local.",
    };
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    return { ok: false, error: "SUPABASE_URL is not a valid URL." };
  }

  const isProjectApiUrl =
    parsedUrl.protocol === "https:" &&
    parsedUrl.hostname.endsWith(".supabase.co") &&
    (parsedUrl.pathname === "/" || parsedUrl.pathname === "");
  if (!isProjectApiUrl) {
    return {
      ok: false,
      error: "SUPABASE_URL must be the project API URL: https://YOUR-PROJECT-REF.supabase.co",
    };
  }

  const headers = { apikey: key };
  if (!key.startsWith("sb_secret_")) {
    headers.Authorization = `Bearer ${key}`;
  }

  return { ok: true, url: parsedUrl.origin, key, headers };
}

module.exports = { getSupabaseConfig };
