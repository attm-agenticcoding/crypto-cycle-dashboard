'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const core = require('../execution/execution-core.js');
const params = {market_calendar:'XNYS', trade_side:'buy', first_offset_pct:.25, spacing_pct:.95, lookback_sessions:10, expected_rungs_per_session:1.7};
const base = {weekly:10000, total:null, reference:35, weekSessions:5, horizon:null, params, accumulation:{used:0,working:0,reserve:0}};
const plan = extra => core.buyPlan({...base,...extra});
test('annual 49 permits one trade; 50, over-limit and committed slots produce HOLD', () => {
  for (const used of [0,49,50,51]) for (const working of [0,1,50]) for (const reserve of [0,1,10]) {
    const p=plan({accumulation:{used,working,reserve}});
    assert.equal(p.orders.length, used+working+reserve<50 ? 1 : 0);
    assert.ok(p.orders.length<=1);
    if(p.orders.length) assert.ok(used+working+reserve+p.orders.length<=50);
  }
});
test('counts must be supplied, nonnegative and integral', () => {
  for(const bad of ['',null,undefined,-1,.5,NaN,Infinity]) for(const field of ['used','working','reserve'])
    if (!(field === 'reserve' && bad === undefined)) assert.throws(()=>plan({accumulation:{used:0,working:0,reserve:0,[field]:bad}}));
  assert.throws(()=>plan({accumulation:{used:0,working:0,reserve:51}}));
});
test('deadline never raises cash or tightens price; explicit zero remains HOLD', () => {
  for(const weekly of [0,10,1000]) for(const total of [null,'',0,500,100000]) for(const horizon of [null,1,30]) {
    const p=plan({weekly,total,horizon});
    const cap=Math.min(weekly,total===null||total===''?weekly:total);
    assert.equal(p.controller.weekly,cap); assert.equal(p.controller.factor,1);
    assert.equal(p.first,.0025); assert.equal(p.spacing,0);
    assert.ok(p.orders.reduce((s,o)=>s+o.notional,0)<=cap);
    if(cap===0) assert.equal(p.orders.length,0);
  }
  assert.equal(plan({weekly:100,total:10000,horizon:1}).behindSchedule,true);
});
test('daily touch estimates do not split or resize an accumulation purchase', () => {
  const p=plan(); assert.equal(p.orders.length,1); assert.equal(p.orders[0].shares,285);
  assert.equal(p.orders[0].price,34.91);
  for(const hits of [.1,12]) for(const weekSessions of [1,5])
    assert.deepEqual(plan({weekSessions,params:{...params,expected_rungs_per_session:hits}}).orders,p.orders);
});
test('crypto order filters yield one bounded order or HOLD, never a second rung', () => {
  const crypto={...params,market_calendar:'24X7',quantity_step:.00001,price_tick:.01,min_quantity:.00001,min_notional:5,min_price:.01,max_price:1000000,max_quantity:9000};
  for(const weekly of [0,1,5,10,1000]) {
    const p=plan({weekly,reference:100000,params:crypto});
    assert.ok(p.orders.length<=1);
    for(const o of p.orders) {assert.ok(o.notional>=5);assert.ok(o.notional<=weekly);assert.ok(Math.abs(o.shares/.00001-Math.round(o.shares/.00001))<1e-8);}
  }
  const capped=plan({params:{...params,max_quantity:100}});
  assert.equal(capped.orders.length,1);assert.equal(capped.orderQuantity,100);assert.equal(capped.unallocated,185);
  const min=plan({params:{...params,min_notional:20000}});assert.equal(min.orders.length,0);
});
test('recalculating is pure and cannot reset or consume actual annual history', () => {
  const accumulation={used:49,working:0,reserve:0};
  assert.deepEqual(plan({accumulation}),plan({accumulation}));
  assert.deepEqual(accumulation,{used:49,working:0,reserve:0});
});
