const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { runInNewContext } = require('node:vm');

test('signed-in portal opens leadership by default and preserves safe deep links', async () => {
  for (const [search, expected] of [['', '/coherence/leadership-demo'], ['?next=%2Ffacilitator', '/facilitator'], ['?next=https://example.com', '/coherence/leadership-demo']]) {
    let destination;
    const content = { addEventListener() {} };
    const year = {};
    runInNewContext(readFileSync(require.resolve('../portal.js'), 'utf8'), {
      window: { location: { hostname: 'preview.example.com', search, replace(value) { destination = value; } } },
      document: { querySelector(selector) { return selector === '#portalContent' ? content : year; } },
      URLSearchParams, AbortSignal, Date,
      fetch: async () => ({ ok: true, json: async () => ({ authenticated: true, role: 'facilitator' }) }),
    });
    await new Promise(setImmediate);
    assert.equal(destination, expected);
  }
});
