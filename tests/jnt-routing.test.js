import test from "node:test";
import assert from "node:assert/strict";
import worker from "../cloudflare-worker.js";

const env = {
  JT_ACCESS_TOKEN: "test-only-token",
  JT_23_API_ACCOUNT: "api-23",
  JT_23_PRIVATE_KEY: "key-23",
  JT_23_BUSINESS_PASSWORD: "HASH-23",
  JT_24_API_ACCOUNT: "api-24",
  JT_24_PRIVATE_KEY: "key-24",
  JT_24_BUSINESS_PASSWORD: "HASH-24",
};

function request(customerCode) {
  return new Request("https://worker.example/jt-api/tracking", {
    method: "POST",
    headers: { Authorization: "Bearer test-only-token", "Content-Type": "application/json" },
    body: JSON.stringify({ customerCode, txlogisticId: "MT-TEST" }),
  });
}

test("J&T routes each VIP to its own Worker secrets", async () => {
  const originalFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, options) => {
    seen.push({ url, options, body: JSON.parse(new URLSearchParams(options.body).get("bizContent")) });
    return Response.json({ code: 1, data: [] });
  };
  try {
    for (const vip of ["VIP8530310123", "VIP8530310124"]) {
      const response = await worker.fetch(request(vip), env);
      assert.equal(response.status, 200);
      assert.equal((await response.json()).code, 1);
    }
    assert.deepEqual(seen.map(s => s.options.headers.apiAccount), ["api-23", "api-24"]);
    assert.deepEqual(seen.map(s => s.body.password), ["HASH-23", "HASH-24"]);
    assert.deepEqual(seen.map(s => s.body.customerCode), ["VIP8530310123", "VIP8530310124"]);
    assert.ok(seen.every(s => s.url.startsWith("https://demoopenapi.jtexpress.co.th/")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("unknown or unconfigured VIP fails closed", async () => {
  const unknown = await worker.fetch(request("VIP111111761"), env);
  assert.equal((await unknown.json()).code, 400);
  const missing = await worker.fetch(request("VIP8530310124"), { ...env, JT_24_PRIVATE_KEY: "" });
  assert.equal((await missing.json()).code, 503);
});
