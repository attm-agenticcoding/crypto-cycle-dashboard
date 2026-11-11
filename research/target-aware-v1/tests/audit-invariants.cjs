'use strict';
// Independent review tests. No network, historical observations, or broker actions.
const test = require('node:test');
const assert = require('node:assert/strict');
const k = require('../kernel.cjs');
const rules = {quantityStep: 1, priceTick: .01, minQuantity: 1, minNotional: 0, maxQuantity: 0, maxNotional: 0};
const t0 = Date.parse('2026-10-05T13:36:00Z');
const book = (extra = {}) => k.createBook({position: 0, target: 100, cash: 20000, startAt: t0, rules, ...extra});
const intent = (extra = {}) => ({side: 'buy', quantity: 100, limitPrice: 100, feeBps: 10, kind: 'passive_limit', ...extra});
const windows = k.sessionWindows('2026-10-05', '2026-10-09', 'XNYS');
const end = windows.at(-1).end;
const config = (extra = {}) => ({strategy: 'paced_passive', deadlineAt: end, passiveFeeBps: 1, aggressiveFeeBps: 5, aggressiveSlippageBps: 2, ...extra});
const history = Array.from({length: 21}, (_, i) => ({observedAt: t0 - (21-i)*k.DAY, availableAt: t0 - (21-i)*k.DAY, price: 100}));
const market = (now = t0, extra = {}) => ({now, nextReviewAt: now + 60*k.MINUTE, windows, history, quote: {at: now, availableAt: now, mid: 100, bid: 99.99, ask: 100.01}, ...extra});

test('audit: partial fills preserve buy cash and target reservations, including cancel-pending fills', () => {
  let b = k.submit(book(), intent(), 'o1', t0);
  assert.ok(Math.abs(k.reserves(b).cash - 10010) < 1e-8);
  b = k.applyFill(b, {id: 'f1', orderId: 'o1', quantity: 30, price: 99, feeBps: 5, at: t0+1});
  assert.equal(b.positionLots, 30);
  assert.ok(Math.abs(b.cash - (20000 - 30*99*1.0005)) < 1e-8);
  assert.equal(k.reserves(b).targetLots, 70);
  assert.ok(Math.abs(k.reserves(b).cash - 7007) < 1e-8);
  b = k.cancelRequest(b, 'o1', t0+2);
  assert.equal(k.reserves(b).targetLots, 70);
  b = k.applyFill(b, {id: 'f2', orderId: 'o1', quantity: 20, price: 100, feeBps: 10, at: t0+3});
  assert.equal(k.reserves(b).targetLots, 50);
  assert.throws(() => k.submit(b, intent({quantity: 1}), 'o2', t0+4), /target/);
  b = k.cancelAck(b, 'o1', t0+4);
  assert.equal(k.reserves(b).cash, 0);
  assert.equal(k.reserves(b).targetLots, 0);
  assert.equal(b.positionLots, 50);
});

test('audit: duplicate fill replay is idempotent and conflicting replay fails without mutation', () => {
  const b = k.submit(book(), intent(), 'o', t0);
  const f = {id: 'f', orderId: 'o', quantity: 10, price: 99, feeBps: 1, at: t0+1};
  const filled = k.applyFill(b, f);
  assert.deepEqual(k.applyFill(filled, f), filled);
  const before = structuredClone(filled);
  assert.throws(() => k.applyFill(filled, {...f, quantity: 11}), /conflicting/);
  assert.deepEqual(filled, before);
});

test('audit: sell partial-fill proceeds, inventory and target remain exactly conserved', () => {
  let b = k.submit(book({position: 130, target: 30, cash: 0}), intent({side: 'sell'}), 's', t0);
  for (let i=0; i<10; i++) {
    b = k.applyFill(b, {id: `f${i}`, orderId: 's', quantity: 10, price: 101, feeBps: 10, at: t0+i+1});
    assert.equal(b.positionLots, 120-10*i);
    assert.equal(k.reserves(b).inventoryLots, 90-10*i);
    assert.ok(Math.abs(b.cash - (i+1)*1010*.999) < 1e-7);
    assert.equal(k.invariant(b), true);
  }
  assert.equal(k.metrics(b, 100, 100).completion, 1);
});

test('audit: exact deadline close is reported as overdue even when market is closed', () => {
  const p = k.plan(book(), config(), market(end));
  assert.equal(p.reason, 'deadline_elapsed');
  assert.equal(p.manualCloseoutRequired, true);
});

test('audit: valid weekend task start does not become missing calendar coverage', () => {
  const b = book({startAt: Date.parse('2026-10-04T12:00:00Z')});
  const p = k.plan(b, config(), market(t0, {windows: k.sessionWindows('2026-10-04', '2026-10-09', 'XNYS')}));
  assert.equal(p.reason, 'research_plan');
  assert.ok(p.allocated > 0);
});

test('audit: calendar range must cover the complete task start even when start is closed', () => {
  const b = book({startAt: Date.parse('2026-10-04T12:00:00Z')});
  assert.throws(() => k.plan(b, config(), market()), /coverage/);
});

test('audit: calendar metadata cannot hide a missing eligible session', () => {
  const missing = structuredClone(windows);
  missing.splice(1, 1);
  assert.throws(() => k.plan(book(), config(), market(t0, {windows: missing})), /calendar|session|coverage/i);
});

test('audit: same-timestamp target revision starts a clean accounting episode', () => {
  let b = k.submit(book(), intent({feeBps: 0}), 'old', t0);
  b = k.applyFill(b, {id: 'oldfill', orderId: 'old', quantity: 100, price: 100, feeBps: 0, at: t0+1});
  b = k.reviseTarget(b, 200, t0+1);
  const m = k.metrics(b, 100, 100);
  assert.equal(m.completion, 0);
  assert.equal(m.passiveCompletion, 0);
  assert.equal(m.aggressiveFraction, 0);
  assert.equal(m.costBps, 0);
});

test('audit: invalid civil dates fail closed for both calendars', () => {
  for (const c of ['XNYS', '24X7']) assert.throws(() => k.sessionWindows('2026-02-30', '2026-03-03', c), /invalid|date/i);
});

test('audit: a target fitting one valid minimum-sized passive order is not labelled infeasible', () => {
  const b = book({target: 2, rules: {...rules, minQuantity: 2}});
  const c = config({deadlineAt: null, weeklyQuantity: 2, weekStartAt: t0-k.DAY, weekEndAt: end});
  const p = k.plan(b, c, market());
  assert.equal(p.allocated, 2);
  assert.equal(p.unallocatedDue, 0);
});

test('audit: schedule is cumulative from task origin after partial fill and replan', () => {
  const c = config({strategy: 'same_horizon_twap'});
  const p1 = k.plan(book(), c, market(t0, {nextReviewAt: windows[0].end}));
  assert.equal(p1.allocated, 20);
  let b = k.submit(book(), p1.intents[0], 'a', t0);
  b = k.applyFill(b, {id: 'af', orderId: 'a', quantity: 10, price: p1.intents[0].limitPrice, feeBps: 5, at: t0+1});
  const p2 = k.plan(b, c, market(windows[1].start, {nextReviewAt: windows[1].end}));
  assert.equal(p2.allocated, 20); // 40 cumulative - 10 filled - 10 still reserved
  assert.equal(p2.reserved, 10);
});

test('audit: no-deadline week rollover retains existing-order allowance', () => {
  const c = config({deadlineAt: null, weeklyQuantity: 60, weekStartAt: t0-k.DAY, weekEndAt: end});
  const p1 = k.plan(book(), c, market());
  assert.equal(p1.allocated, 60);
  let b = book();
  p1.intents.forEach((o,i) => {b=k.submit(b,o,`w${i}`,t0);});
  const nextWindows = k.sessionWindows('2026-10-12','2026-10-16','XNYS'), next = nextWindows[0].start;
  const p2 = k.plan(b, {...c,weekStartAt:next-k.DAY,weekEndAt:nextWindows.at(-1).end}, market(next,{windows:nextWindows}));
  assert.equal(p2.allocated,0);
  assert.equal(p2.reserved,60);
});

test('audit: manual closeout waits for outstanding cancel acknowledgement', () => {
  const now = end - 15*k.MINUTE;
  let b = k.submit(book(), intent({quantity: 50}), 'old', now-10*k.MINUTE);
  b = k.cancelRequest(b, 'old', now-1);
  const p = k.plan(b, config({manualCloseoutScenario: true}), market(now, {nextReviewAt: end}));
  assert.equal(p.intents.length, 0);
  assert.equal(k.reserves(b).targetLots, 50);
});

test('audit: ledger rejects finite inputs whose transaction product overflows', () => {
  assert.throws(() => {
    const b = book({position: 1e308, target: 0, cash: 0, rules: {...rules, quantityStep: 1e308, priceTick: 1}});
    const s = k.submit(b, intent({side: 'sell', quantity: 1e308, feeBps: 0}), 'overflow', t0);
    k.applyFill(s, {id: 'f', orderId: 'overflow', quantity: 1e308, price: 100, feeBps: 0, at: t0+1});
  }, /finite|overflow|invalid/i);
});

test('audit: exactly funded fee-inclusive fill tolerates documented machine roundoff only', () => {
  let b = book({target:3,cash:69.99498});
  b = k.submit(b,intent({quantity:3,limitPrice:23.32,feeBps:5}),'exact',t0);
  assert.ok(Math.abs(k.reserves(b).cash-b.cash)<1e-12);
  b = k.applyFill(b,{id:'f',orderId:'exact',quantity:3,price:23.32,feeBps:5,at:t0+1});
  assert.equal(b.positionLots,3);
  assert.ok(Math.abs(b.cash)<1e-10);
  assert.equal(k.invariant(b),true);
  assert.throws(()=>k.invariant({...b,cash:-.001}),/cash|negative|invalid/i);
});

test('audit: new order cannot be backdated behind another order fill', () => {
  let b = k.submit(book(), intent({quantity: 40}), 'a', t0);
  b = k.applyFill(b, {id: 'f', orderId: 'a', quantity: 40, price: 100, feeBps: 1, at: t0+100});
  assert.throws(() => k.submit(b, intent({quantity: 20}), 'backdated', t0+50), /event|before|predate|order|clock/i);
});

test('audit: target revision cannot be backdated behind a cancel acknowledgement', () => {
  let b = k.submit(book(), intent({quantity: 40}), 'a', t0);
  b = k.cancelRequest(b, 'a', t0+99);
  b = k.cancelAck(b, 'a', t0+100);
  assert.throws(() => k.reviseTarget(b, 50, t0+50), /event|before|predate|order|clock/i);
});

test('audit: deterministic randomized partial-fill/cancel ledgers conserve both sides and fractional lots', () => {
  let seed = 1729;
  const random = () => ((seed = (1664525*seed+1013904223) >>> 0) / 2**32);
  for (const step of [1, .1, .00001]) for (const side of ['buy', 'sell']) for (let episode=0; episode<25; episode++) {
    const initialLots = side === 'buy' ? 30 : 130, targetLots = side === 'buy' ? 130 : 30;
    const initialCash = 20000*step;
    let b = book({position: initialLots*step, target: targetLots*step, cash: initialCash, rules: {...rules,quantityStep:step,minQuantity:step}});
    let serial = 0, event = t0;
    for (let round=0; round<30 && k.residualLots(b)>0; round++) {
      const n = Math.max(1, Math.floor(random()*k.residualLots(b))), id = `o${serial++}`;
      b = k.submit(b, intent({side,quantity:k.units(b,n)}), id, ++event);
      const done = Math.max(1, Math.floor(random()*n));
      const p = side === 'buy' ? 99.99 : 100.01;
      b = k.applyFill(b,{id:`f${serial}`,orderId:id,quantity:k.units(b,done),price:p,feeBps:5,at:++event});
      if (done<n) {
        b = k.cancelRequest(b,id,++event);
        b = k.cancelAck(b,id,++event);
      }
      const fillLots = b.fills.reduce((s,f)=>s+k.lots(f.quantity,step),0);
      const expectedCash = b.fills.reduce((s,f)=>s+(side==='buy' ? -1.0005 : .9995)*f.quantity*f.price,initialCash);
      assert.equal(b.positionLots,initialLots+(side==='buy'?1:-1)*fillLots);
      assert.equal(k.residualLots(b),100-fillLots);
      assert.ok(Math.abs(b.cash-expectedCash)<1e-7);
      assert.equal(k.reserves(b).targetLots,0);
      assert.equal(k.invariant(b),true);
    }
  }
});
