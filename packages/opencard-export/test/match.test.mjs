// Tests for name normalization, issuer aliases, and fuzzy matching.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeText,
  normalizeIssuer,
  nameTokens,
  scoreMatch,
  matchCard,
} from '../lib/match.mjs';

test('normalizeText strips trademark marks, punctuation, and case', () => {
  assert.equal(normalizeText('Chase Sapphire Preferred®'), 'chase sapphire preferred');
  assert.equal(normalizeText('American Express Cobalt™ Card'), 'american express cobalt card');
});

test('normalizeIssuer folds aliases', () => {
  assert.deepEqual(normalizeIssuer('American Express'), ['amex']);
  assert.deepEqual(normalizeIssuer('AMEX'), ['amex']);
  assert.deepEqual(normalizeIssuer('Bank of America'), ['boa']);
  assert.deepEqual(normalizeIssuer('BofA'), ['boa']);
  assert.deepEqual(normalizeIssuer('JPMorgan Chase'), ['chase']);
});

test('nameTokens drops stopwords like card/credit/visa', () => {
  assert.deepEqual(nameTokens('Chase Sapphire Preferred Card'), ['chase', 'sapphire', 'preferred']);
  assert.deepEqual(nameTokens('The Platinum Card'), ['platinum']);
});

test('scoreMatch rewards name overlap + shared issuer', () => {
  const wallet = { name: 'Sapphire Preferred', issuer: 'Chase' };
  const good = { name: 'Chase Sapphire Preferred® Card', issuer: 'Chase' };
  const bad = { name: 'Venture X Rewards', issuer: 'Capital One' };
  assert.ok(scoreMatch(wallet, good) > scoreMatch(wallet, bad));
  assert.ok(scoreMatch(wallet, good) >= 0.5);
});

test('matchCard picks the best DB card above threshold', () => {
  const db = [
    { id: 'us-chase-sapphire-preferred', name: 'Chase Sapphire Preferred® Card', issuer: 'Chase' },
    { id: 'us-amex-gold', name: 'American Express® Gold Card', issuer: 'American Express' },
    { id: 'us-capital-one-venture', name: 'Capital One Venture Rewards', issuer: 'Capital One' },
  ];
  const m = matchCard({ name: 'Amex Gold', issuer: 'Amex' }, db);
  assert.ok(m);
  assert.equal(m.card.id, 'us-amex-gold');
});

test('matchCard returns null when nothing clears threshold', () => {
  const db = [{ id: 'us-chase-sapphire-preferred', name: 'Chase Sapphire Preferred', issuer: 'Chase' }];
  const m = matchCard({ name: 'Totally Unrelated Store Loyalty', issuer: 'Some Shop' }, db);
  assert.equal(m, null);
});

test('matchCard tolerates empty / missing DB gracefully', () => {
  assert.equal(matchCard({ name: 'X', issuer: 'Y' }, []), null);
  assert.equal(matchCard({ name: 'X', issuer: 'Y' }, null), null);
});

test('sibling products: Gold Card does not match Business Gold', () => {
  const db = [
    { id: 'us-amex-business-gold', name: 'American Express Business Gold Card', issuer: 'American Express' },
    { id: 'us-amex-gold', name: 'American Express® Gold Card', issuer: 'American Express' },
  ];
  const personal = matchCard({ name: 'Gold Card', issuer: 'American Express' }, db);
  assert.ok(personal);
  assert.equal(personal.card.id, 'us-amex-gold');

  const biz = matchCard({ name: 'Business Gold', issuer: 'American Express' }, db);
  assert.ok(biz);
  assert.equal(biz.card.id, 'us-amex-business-gold');
});

test('sibling products: Sapphire Preferred vs Reserve', () => {
  const db = [
    { id: 'us-chase-sapphire-preferred', name: 'Chase Sapphire Preferred® Card', issuer: 'Chase' },
    { id: 'us-chase-sapphire-reserve', name: 'Chase Sapphire Reserve®', issuer: 'Chase' },
  ];
  const pref = matchCard({ name: 'Sapphire Preferred', issuer: 'Chase' }, db);
  assert.equal(pref.card.id, 'us-chase-sapphire-preferred');
  const res = matchCard({ name: 'Sapphire Reserve', issuer: 'Chase' }, db);
  assert.equal(res.card.id, 'us-chase-sapphire-reserve');
});
