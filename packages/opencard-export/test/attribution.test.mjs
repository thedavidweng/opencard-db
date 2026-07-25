// Tests for attribution messaging.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { attributionLine, attributionNotice } from '../lib/attribution.mjs';

test('attributionLine formats issuer copyright', () => {
  assert.equal(attributionLine('Chase'), '© Chase (Apple Pay digital card art)');
});

test('attributionLine falls back to "Issuer" when missing', () => {
  assert.equal(attributionLine(''), '© Issuer (Apple Pay digital card art)');
  assert.equal(attributionLine(null), '© Issuer (Apple Pay digital card art)');
  assert.equal(attributionLine(undefined), '© Issuer (Apple Pay digital card art)');
});

test('attributionNotice mentions copyright, takedown, and the suggested line', () => {
  const notice = attributionNotice('Sample Bank');
  assert.match(notice, /copyright of the issuing bank/i);
  assert.match(notice, /takedown/i);
  assert.match(notice, /SECURITY\.md/);
  assert.match(notice, /© Sample Bank \(Apple Pay digital card art\)/);
});

test('attributionNotice is English-only (no CJK)', () => {
  const notice = attributionNotice('Sample Bank');
  assert.ok(!/[一-鿿]/.test(notice), 'notice must not contain CJK characters');
});
