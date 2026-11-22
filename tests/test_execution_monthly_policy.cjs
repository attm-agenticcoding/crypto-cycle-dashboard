'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const policy=require('../execution/monthly-policy.js'),core=require('../execution/execution-core.js');
const candidate={id:'monthly-10-1-1',lookback:10,fill_intensity:1,allocation_scale:1};
const samples=Array.from({length:10},(_,i)=>({date:`2026-09-${String(i+10).padStart(2,'0')}`,drawdown_pct:.1+i*.2}));
const input={samples,sessionDate:'2026-10-05',remainingDays:20,slots:5,candidate};
test('fit lookup uses the exact cap and rejects invalid or future-trained profiles',()=>{
  const report=require('../data/execution_monthly_dynamic_params.json');
  assert.ok(policy.profile(report,'ARCX:BTC',5));
  assert.equal(policy.profile(report,'ARCX:BTC',32),null);
  assert.equal(policy.profile({...report,status:'research_only'},'ARCX:BTC',5),null);
  const changed=structuredClone(report);
  changed.instruments['ARCX:BTC'].profiles['5'].latest_training_months=['2099-01'];
  assert.equal(policy.profile(changed,'ARCX:BTC',5),null);
  changed.instruments['ARCX:BTC'].profiles['5'].latest_training_months=['2026-09'];
  changed.instruments['ARCX:BTC'].profiles['5'].candidate.allocation_scale=100;
  assert.equal(policy.profile(changed,'ARCX:BTC',5),null);
});
test('monthly state counts listed holidays, weekends, half-day cutoff, and next-month preview',()=>{
  const at=x=>policy.monthState({marketCalendar:'XNYS',at:new Date(x)});
  assert.equal(at('2026-10-05T14:00:00Z').remainingDays,20);
  assert.deepEqual([at('2026-11-26T15:00:00Z').planningDate,at('2026-11-26T15:00:00Z').remainingDays],['2026-11-27',2]);
  assert.equal(at('2026-11-27T17:59:00Z').remainingDays,2);
  assert.equal(at('2026-11-27T18:00:00Z').remainingDays,1);
  assert.equal(at('2026-10-30T20:00:00Z').month,'2026-11');
  assert.throws(()=>at('2029-01-01T15:00:00Z'),/calendar/);
});
test('crypto monthly allowance follows New York midnight including daylight saving',()=>{
  const at=x=>policy.monthState({marketCalendar:'24X7',at:new Date(x)});
  for(const [before,after]of [['2026-04-01T03:59:00Z','2026-04-01T04:00:00Z'],['2026-12-01T04:59:00Z','2026-12-01T05:00:00Z']]){
    assert.equal(at(before).remainingDays,1);
    assert.notEqual(at(before).month,at(after).month);
    assert.ok(at(after).remainingDays>=28);
  }
});
test('days, free slots, price opportunity and fitted allocation affect one reviewed buy',()=>{
  const early=policy.decision(input),late=policy.decision({...input,remainingDays:2});
  assert.ok(early.offset>late.offset);
  assert.notEqual(early.fraction,late.fraction);
  assert.ok(early.fraction>0&&early.fraction<=.75);
  assert.notEqual(policy.decision({...input,slots:2}).fraction,early.fraction);
  assert.ok(policy.decision({...input,remainingDays:1}).offset>=.0005,'no forced market buy at month end');
  assert.equal(policy.decision({...input,slots:0}).fraction,0);
  assert.equal(policy.decision({...input,remainingDays:0}).fraction,0);
});
test('same-day and future excursions cannot influence the plan; invalid history fails closed',()=>{
  const original=policy.decision(input);
  assert.deepEqual(policy.decision({...input,samples:[...samples,{date:'2026-10-05',drawdown_pct:1000},{date:'2027-01-01',drawdown_pct:9999}]}),original);
  assert.throws(()=>policy.decision({...input,samples:samples.slice(1)}),/completed prior/);
  assert.throws(()=>policy.decision({...input,samples:[...samples,samples[0]]}),/duplicate/);
  assert.throws(()=>policy.decision({...input,remainingDays:1.5}),/whole/);
  assert.throws(()=>policy.decision({...input,candidate:{...candidate,allocation_scale:Infinity}}),/fitted/);
});
test('monthly buy respects cash caps and exchange filters and reprices with current input',()=>{
  const params={market_calendar:'XNYS',trade_side:'buy',first_offset_pct:.25,spacing_pct:.8,lookback_sessions:10,expected_rungs_per_session:1.5,session_samples:samples};
  const args={deployment:10000,capital:8000,reference:100,params,accumulation:{limit:5,used:0,working:0},monthly:{candidate,remainingDays:20,sessionDate:'2026-10-05'}};
  const p=core.buyPlan(args),q=core.buyPlan({...args,reference:120});
  assert.equal(p.orders.length,1);assert.equal(p.controller.budget,8000);
  assert.ok(p.monthly.orderBudget<8000&&p.monthly.retainedCapital>0);
  assert.ok(p.orders[0].notional<=p.monthly.orderBudget);
  assert.ok(q.orders[0].price>p.orders[0].price);
  assert.equal(q.first,p.first);
  const hold=core.buyPlan({...args,accumulation:{limit:5,used:5,working:0}});
  assert.equal(hold.orders.length,0);assert.equal(hold.monthly.orderBudget,0);
  assert.equal(core.buyPlan({...args,monthly:{...args.monthly,remainingDays:0}}).orders.length,0);
  const partial=core.buyPlan({...args,params:{...params,max_quantity:1}});
  assert.equal(partial.orders[0].shares,1);assert.equal(partial.orders.length,1);
  assert.deepEqual(core.buyPlan(args),p,'recalculation cannot consume a slot');
});
