import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesTracking } from './trackingSearch.js';
test('matches full, partial and pasted tracking numbers', () => {
  assert.equal(matchesTracking('864890856793', ' 864 890 856793\n'), true);
  assert.equal(matchesTracking(864890856793, '856793'), true);
  assert.equal(matchesTracking('864890856793', '864\u200b890856793'), true);
  assert.equal(matchesTracking('TH123ABC', 'th123abc'), true);
});
test('does not match missing or different tracking numbers', () => {
  assert.equal(matchesTracking(null, '864890856793'), false);
  assert.equal(matchesTracking('864890856793', '999999'), false);
  assert.equal(matchesTracking(null, ''), true);
});
