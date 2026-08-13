const test = require("node:test");
const assert = require("node:assert/strict");

const leads = require("../api/leads");

process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";

function responseMock() {
  return {
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
    },
    end(body) {
      this.body = body;
    },
  };
}

test("valid lead details are inserted into the retained Supabase table", async (context) => {
  const originalFetch = global.fetch;
  context.after(() => (global.fetch = originalFetch));
  let requestUrl;
  let requestOptions;
  global.fetch = async (url, options) => {
    requestUrl = url;
    requestOptions = options;
    return new Response(null, { status: 201 });
  };

  const response = responseMock();
  await leads(
    {
      method: "POST",
      headers: {},
      body: {
        fullName: "Test Person",
        email: "Test@Example.com",
        phone: "904-555-0100",
        interest: "Schedule an inquiry call",
        notes: "Interested in discussing the next phase.",
        source: "website-booking",
      },
    },
    response,
  );

  assert.equal(response.statusCode, 201);
  assert.equal(requestUrl, "https://example.supabase.co/rest/v1/interest_leads");
  assert.deepEqual(JSON.parse(requestOptions.body), {
    full_name: "Test Person",
    email: "test@example.com",
    phone: "904-555-0100",
    interest: "Schedule an inquiry call",
    notes: "Interested in discussing the next phase.",
    source: "website-booking",
  });
  assert.equal(requestOptions.headers.Authorization, "Bearer test-service-role-key");
});

test("recommended Supabase secret keys are sent only through the apikey header", async (context) => {
  const originalFetch = global.fetch;
  const originalSecret = process.env.SUPABASE_SECRET_KEY;
  context.after(() => {
    global.fetch = originalFetch;
    if (originalSecret === undefined) delete process.env.SUPABASE_SECRET_KEY;
    else process.env.SUPABASE_SECRET_KEY = originalSecret;
  });
  process.env.SUPABASE_SECRET_KEY = "sb_secret_test-key";
  let requestOptions;
  global.fetch = async (_url, options) => {
    requestOptions = options;
    return new Response(null, { status: 201 });
  };

  const response = responseMock();
  await leads(
    {
      method: "POST",
      headers: {},
      body: {
        fullName: "Test Person",
        email: "test@example.com",
        phone: "904-555-0100",
      },
    },
    response,
  );

  assert.equal(requestOptions.headers.apikey, "sb_secret_test-key");
  assert.equal(requestOptions.headers.Authorization, undefined);
});

test("invalid lead details never reach the database", async (context) => {
  const originalFetch = global.fetch;
  context.after(() => (global.fetch = originalFetch));
  global.fetch = async () => {
    throw new Error("fetch should not be called");
  };

  const response = responseMock();
  await leads(
    {
      method: "POST",
      headers: {},
      body: { fullName: "", email: "invalid", phone: "1" },
    },
    response,
  );

  assert.equal(response.statusCode, 400);
});

test("a confirmation email is sent after the lead is saved", async (context) => {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.RESEND_API_KEY;
  const originalFrom = process.env.LEAD_CONFIRMATION_FROM;
  context.after(() => {
    global.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = originalApiKey;
    if (originalFrom === undefined) delete process.env.LEAD_CONFIRMATION_FROM;
    else process.env.LEAD_CONFIRMATION_FROM = originalFrom;
  });
  process.env.RESEND_API_KEY = "re_test_key";
  process.env.LEAD_CONFIRMATION_FROM = "Attenor <hello@attenorcollab.com>";

  const requests = [];
  global.fetch = async (url, options) => {
    requests.push({ url, options });
    return url.includes("supabase.co")
      ? new Response(null, { status: 201 })
      : new Response(JSON.stringify({ id: "email_123" }), { status: 200 });
  };

  const response = responseMock();
  await leads(
    {
      method: "POST",
      headers: {},
      body: {
        fullName: "Taylor Example",
        email: "taylor@example.com",
        phone: "904-555-0100",
        interest: "Schedule an inquiry call",
      },
    },
    response,
  );

  assert.equal(requests.length, 2);
  assert.equal(requests[1].url, "https://api.resend.com/emails");
  assert.equal(requests[1].options.headers.Authorization, "Bearer re_test_key");
  assert.deepEqual(JSON.parse(requests[1].options.body).to, ["taylor@example.com"]);
  assert.equal(JSON.parse(response.body).confirmationEmailSent, true);
});

test("a saved lead is mirrored to the configured spreadsheet webhook", async (context) => {
  const originalFetch = global.fetch;
  const originalWebhook = process.env.LEAD_SPREADSHEET_WEBHOOK_URL;
  context.after(() => {
    global.fetch = originalFetch;
    if (originalWebhook === undefined) delete process.env.LEAD_SPREADSHEET_WEBHOOK_URL;
    else process.env.LEAD_SPREADSHEET_WEBHOOK_URL = originalWebhook;
  });
  process.env.LEAD_SPREADSHEET_WEBHOOK_URL =
    "https://script.google.com/macros/s/test-deployment/exec";

  const requests = [];
  global.fetch = async (url, options) => {
    requests.push({ url: String(url), options });
    return new Response(null, { status: url.toString().includes("supabase.co") ? 201 : 200 });
  };

  const response = responseMock();
  await leads(
    {
      method: "POST",
      headers: {},
      body: {
        fullName: "Morgan Example",
        email: "morgan@example.com",
        phone: "904-555-0101",
        interest: "Discuss strategic foresight",
        notes: "Please follow up next week.",
      },
    },
    response,
  );

  assert.equal(requests.length, 2);
  assert.equal(requests[1].url, process.env.LEAD_SPREADSHEET_WEBHOOK_URL);
  const payload = JSON.parse(requests[1].options.body);
  assert.equal(payload.full_name, "Morgan Example");
  assert.equal(payload.email, "morgan@example.com");
  assert.match(payload.submitted_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(JSON.parse(response.body).spreadsheetMirrored, true);
});

test("dashboard URLs return a concise Supabase configuration error", async (context) => {
  const originalUrl = process.env.SUPABASE_URL;
  context.after(() => (process.env.SUPABASE_URL = originalUrl));
  process.env.SUPABASE_URL = "https://supabase.com/dashboard/project/example";

  const response = responseMock();
  await leads(
    {
      method: "POST",
      headers: {},
      body: {
        fullName: "Test Person",
        email: "test@example.com",
        phone: "904-555-0100",
      },
    },
    response,
  );

  assert.equal(response.statusCode, 503);
  assert.match(JSON.parse(response.body).error, /project API URL/);
});
