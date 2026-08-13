const RESEND_ENDPOINT = "https://api.resend.com/emails";

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function firstName(fullName) {
  return String(fullName || "").trim().split(/\s+/)[0] || "there";
}

async function sendLeadConfirmation(lead) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.LEAD_CONFIRMATION_FROM;

  if (!apiKey || !from) {
    return { sent: false, reason: "not_configured" };
  }

  const name = escapeHtml(firstName(lead.full_name));
  const interest = escapeHtml(lead.interest || "Learning more about Attenor Collaborative");
  const schedulerUrl = process.env.ATTENOR_SCHEDULER_URL || "https://calendly.com/attenorcollab";

  const result = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [lead.email],
      reply_to: "info@attenorcollab.com",
      subject: "We received your interest in Attenor Collaborative",
      text: [
        `Hello ${firstName(lead.full_name)},`,
        "",
        "Thank you for reaching out to Attenor Collaborative. We received your information and will follow up with the right next step.",
        `Your interest: ${lead.interest || "Learning more about Attenor Collaborative"}`,
        "",
        `If you would like to choose a time now, visit ${schedulerUrl}`,
        "",
        "Warmly,",
        "Dr. Ronetta Wards",
        "Attenor Collaborative",
      ].join("\n"),
      html: `
        <div style="background:#fbf7ef;padding:32px 16px;color:#17211d;font-family:Arial,sans-serif;line-height:1.6">
          <div style="max-width:600px;margin:0 auto;background:#fffdf8;border:1px solid #e2d9ca;padding:36px">
            <p style="margin:0 0 20px;color:#a0522d;font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase">Attenor Collaborative</p>
            <h1 style="margin:0 0 20px;font-family:Georgia,serif;font-size:28px;line-height:1.2">Thank you for reaching out, ${name}.</h1>
            <p>We received your information and will follow up with the right next step.</p>
            <p style="margin:24px 0;padding:16px;border-left:3px solid #b66f4f;background:#f0e7d8"><strong>Your interest</strong><br>${interest}</p>
            <p>If you would like to choose a time now, you can view Dr. Ward's availability below.</p>
            <p style="margin:28px 0"><a href="${escapeHtml(schedulerUrl)}" style="display:inline-block;background:#a0522d;color:#fffdf8;padding:12px 18px;text-decoration:none;font-weight:700">View availability</a></p>
            <p style="margin-bottom:0">Warmly,<br><strong>Dr. Ronetta Wards</strong><br>Attenor Collaborative</p>
          </div>
        </div>`,
    }),
  });

  if (!result.ok) {
    const details = (await result.text()).slice(0, 500);
    throw new Error(`Resend confirmation failed (${result.status}): ${details}`);
  }

  return { sent: true };
}

module.exports = { sendLeadConfirmation };
