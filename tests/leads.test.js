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
