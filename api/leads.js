const { readJson, sendJson } = require("./_lib/http");
const { getSupabaseConfig } = require("./_lib/supabase");

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

module.exports = async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return sendJson(response, 405, { error: "Method not allowed." });
  }

  try {
    const { fullName, email, phone, source } = await readJson(request);
    const lead = {
      full_name: String(fullName || "").trim().slice(0, 160),
      email: String(email || "").trim().toLowerCase().slice(0, 254),
      phone: String(phone || "").trim().slice(0, 40),
      source: String(source || "website").trim().slice(0, 80),
    };

    if (!lead.full_name || !EMAIL_PATTERN.test(lead.email) || lead.phone.length < 7) {
      return sendJson(response, 400, { error: "Please enter a valid name, email, and phone number." });
    }

    const supabase = getSupabaseConfig();
    if (!supabase) {
      return sendJson(response, 503, { error: "Lead storage is not configured yet." });
    }

    const result = await fetch(`${supabase.url}/rest/v1/interest_leads`, {
      method: "POST",
      headers: {
        ...supabase.headers,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(lead),
    });

    if (!result.ok) {
      console.error("Supabase lead insert failed", result.status, await result.text());
      return sendJson(response, 502, { error: "We could not save your information right now." });
    }

    return sendJson(response, 201, { saved: true });
  } catch (error) {
    console.error("Lead endpoint failed", error);
    return sendJson(response, 400, { error: "Invalid request." });
  }
};
