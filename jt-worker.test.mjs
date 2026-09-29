import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import worker from './cloudflare-worker.js';

const env = { JT_ACCESS_TOKEN: 'test-access', JT_API_ACCOUNT: 'test-account', JT_PRIVATE_KEY: 'test-key', JT_BUSINESS_PASSWORD: 'TEST-BUSINESS', JT_CUSTOMER_CODE: 'TEST-CUSTOMER' };
const realFetch = globalThis.fetch;
let calls = 0;
globalThis.fetch = async (url, options) => {
  calls++;
  assert.equal(new URL(url).hostname, 'demoopenapi.jtexpress.co.th');
  const form = new URLSearchParams(options.body);
  assert.deepEqual([...form.keys()], ['bizContent']);
  const biz = form.get('bizContent');
  assert.equal(options.headers.digest, createHash('md5').update(biz + env.JT_PRIVATE_KEY).digest('base64'));
  assert.equal(options.headers.apiAccount, env.JT_API_ACCOUNT);
  assert.match(options.headers.timestamp, /^\d{13}$/);
  assert.equal(JSON.parse(biz).password, env.JT_BUSINESS_PASSWORD);
  assert.equal(JSON.parse(biz).customerCode, env.JT_CUSTOMER_CODE);
  const data = { billCode: 'TEST-AWB', txlogisticId: 'TEST-ORDER', base64EncodeContent: Buffer.from('%PDF-1.4\n').toString('base64') };
  return Response.json({ code: 1, msg: 'success', data });
};
const party = { name: 'Test', postCode: '10110', mobile: '0800000000', city: 'Test', prov: 'Test', address: 'Test' };
const payload = { customerCode: 'client-value', txlogisticId: 'TEST-ORDER', billCode: 'TEST-AWB', reason: 'test', sender: party, receiver: party, packageInfo: { weight: 1 }, type: 1 };
const request = (endpoint, auth = true, body = payload) => new Request(`https://example.test/jt-api/${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer test-access' } : {}) }, body: JSON.stringify(body) });
try {
  assert.equal((await worker.fetch(request('create', false), env)).status, 401);
  assert.equal(calls, 0);
  assert.equal((await worker.fetch(request('create'), {})).status, 503);
  for (const endpoint of ['create', 'cancel', 'label']) {
    const res = await worker.fetch(request(endpoint), env);
    assert.equal((await res.json()).code, 1);
  }
  const pdf = await worker.fetch(request('label', true, { ...payload, asPdf: true }), env);
  assert.equal(pdf.headers.get('Content-Type'), 'application/pdf');
  assert.match(await pdf.text(), /^%PDF/);
  assert.equal((await worker.fetch(request('label', true, { ...payload, type: 99 }), env)).status, 400);
  assert.equal((await worker.fetch(request('create', true, { ...payload, packageInfo: { weight: -1 } }), env)).status, 400);
  console.log('PASS: access control, J&T headers/signature, create/cancel/label, PDF decode, label size validation. No external requests.');
} finally { globalThis.fetch = realFetch; }
