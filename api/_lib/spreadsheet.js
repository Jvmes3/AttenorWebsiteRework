async function mirrorLeadToSpreadsheet(lead) {
  const webhookUrl = process.env.LEAD_SPREADSHEET_WEBHOOK_URL;
  if (!webhookUrl) return { mirrored: false, reason: "not_configured" };

  const url = new URL(webhookUrl);
  if (url.protocol !== "https:") {
    throw new Error("LEAD_SPREADSHEET_WEBHOOK_URL must use HTTPS.");
  }

  const result = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...lead, submitted_at: new Date().toISOString() }),
  });

  if (!result.ok) {
    const details = (await result.text()).slice(0, 500);
    throw new Error(`Lead spreadsheet webhook failed (${result.status}): ${details}`);
  }

  return { mirrored: true };
}

module.exports = { mirrorLeadToSpreadsheet };
