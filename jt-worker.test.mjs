import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import worker from './cloudflare-worker.js';

const env = {
  JT_ACCESS_TOKEN: 'test-access',
  JT_API_BASE: 'https://ylopenapi.jtexpress.co.th',
  JT_23_API_ACCOUNT: 'test-account-23', JT_23_PRIVATE_KEY: 'test-key-23', JT_23_BUSINESS_PASSWORD: 'TEST-BUSINESS-23',
  JT_24_API_ACCOUNT: 'test-account-24', JT_24_PRIVATE_KEY: 'test-key-24', JT_24_BUSINESS_PASSWORD: 'TEST-BUSINESS-24',
};
const realFetch = globalThis.fetch;
let calls = 0;
globalThis.fetch = async (url, options) => {
  calls++;
  assert.equal(new URL(url).hostname, 'ylopenapi.jtexpress.co.th');
  const form = new URLSearchParams(options.body);
  assert.deepEqual([...form.keys()], ['bizContent']);
  const biz = form.get('bizContent');
  const customerCode = JSON.parse(biz).customerCode;
  const suffix = customerCode === 'VIP8530310123' ? '23' : customerCode === 'VIP8530310124' ? '24' : null;
  assert.ok(suffix, 'Only configured VIP accounts may be sent to J&T');
  assert.equal(options.headers.digest, createHash('md5').update(biz + env[`JT_${suffix}_PRIVATE_KEY`]).digest('base64'));
  assert.equal(options.headers.apiAccount, env[`JT_${suffix}_API_ACCOUNT`]);
  assert.match(options.headers.timestamp, /^\d{13}$/);
  assert.equal(JSON.parse(biz).password, env[`JT_${suffix}_BUSINESS_PASSWORD`]);
  assert.equal(JSON.parse(biz).environment, undefined);
  const data = { billCode: 'TEST-AWB', txlogisticId: 'TEST-ORDER', base64EncodeContent: Buffer.from('%PDF-1.4\n').toString('base64') };
  return Response.json({ code: 1, msg: 'success', data });
};
const party = { name: 'Test', postCode: '10110', mobile: '0800000000', city: 'Test', prov: 'Test', address: 'Test' };
const payload = { environment: 'production', customerCode: 'VIP8530310123', txlogisticId: 'TEST-ORDER', billCode: 'TEST-AWB', reason: 'test', sender: party, receiver: party, packageInfo: { weight: 1 }, type: 1 };
const request = (endpoint, auth = true, body = payload) => new Request(`https://example.test/jt-api/${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer test-access' } : {}) }, body: JSON.stringify(body) });
try {
  assert.equal((await worker.fetch(request('create', false), env)).status, 401);
  assert.equal(calls, 0);
  assert.equal((await worker.fetch(request('create'), {})).status, 503);
  assert.equal((await worker.fetch(request('create', true, { ...payload, environment: undefined }), env)).status, 409);
  assert.equal((await worker.fetch(request('create'), { ...env, JT_API_BASE: 'https://demoopenapi.jtexpress.co.th' })).status, 409);
  assert.equal(calls, 0);
  for (const endpoint of ['create', 'cancel', 'label']) {
    const res = await worker.fetch(request(endpoint), env);
    assert.equal((await res.json()).code, 1);
  }
  const tracking24 = await worker.fetch(request('tracking', true, { customerCode: 'VIP8530310124', txlogisticId: 'TEST-ORDER' }), env);
  assert.equal((await tracking24.json()).code, 1);
  const pdf = await worker.fetch(request('label', true, { ...payload, asPdf: true }), env);
  assert.equal(pdf.headers.get('Content-Type'), 'application/pdf');
  assert.match(await pdf.text(), /^%PDF/);
  assert.equal((await worker.fetch(request('label', true, { ...payload, type: 99 }), env)).status, 400);
  assert.equal((await worker.fetch(request('create', true, { ...payload, packageInfo: { weight: -1 } }), env)).status, 400);
  console.log('PASS: access control, both VIP credentials, J&T headers/signature, create/cancel/tracking/label, PDF decode, label size validation. No external requests.');
} finally { globalThis.fetch = realFetch; }
