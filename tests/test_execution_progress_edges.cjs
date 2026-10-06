/* Independently authored synthetic ledger edge and cash-conservation cases.
* No market history, real account data, IO or broker connection.
*/
'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const L=require('../execution/task-ledger.js');
const MON='2026-10-05T14:00:00.000Z', NEXT='2026-10-12T14:00:00.000Z';
const make=(over={
})=>L.createTask({
  instrumentId:'ARCX:TEST',accountId:'one',side:'buy',marketCalendar:'XNYS',totalRemaining:1000,weeklyRemaining:600,at:MON,...over
});
const mutate=(s,fn,p={
})=>L[fn](s,{
  eventId:'event-'+(s.revision+1),at:MON,expectedRevision:s.revision,...p
});
const snap=(s,at=MON)=>L.snapshot(s,at);
test('buy limits reserve only outstanding quantity; price improvement returns cash',()=>{
  let s=make();
  const initial=s;
  s=mutate(s,'addOrder',{
    orderId:'A',quantity:6,limitPrice:100
  });
  assert.equal(snap(s).freeWeekly,0);
  s=mutate(s,'recordFill',{
    tradeId:'T',orderId:'A',quantity:2,price:90
  });
  const p=snap(s);
  assert.equal(p.totalRemaining,820);
  assert.equal(p.weeklyRemaining,420);
  assert.equal(p.reservedCash,400);
  assert.equal(p.freeWeekly,20);
  assert.equal(p.averageFillPrice,90);
  assert.equal(snap(initial).reservedCash,0);
});
test('cancel request retains reserve; late pre-confirm fill never releases a second reserve',()=>{
  let s=make();
  s=mutate(s,'addOrder',{
    orderId:'A',quantity:6,limitPrice:100
  });
  s=mutate(s,'requestCancel',{
    orderId:'A',at:'2026-10-05T14:01:00Z'
  });
  assert.equal(snap(s,'2026-10-05T14:01:00Z').reservedCash,600);
  s=mutate(s,'recordFill',{
    tradeId:'T1',orderId:'A',quantity:2,price:90,executedAt:'2026-10-05T14:00:30Z',at:'2026-10-05T14:02:00Z'
  });
  s=mutate(s,'confirmCancel',{
    orderId:'A',at:'2026-10-05T14:03:00Z'
  });
  let p=snap(s,'2026-10-05T14:03:00Z');
  assert.equal(p.reservedCash,0);
  assert.equal(p.freeWeekly,420);
  s=mutate(s,'recordFill',{
    tradeId:'T2',orderId:'A',quantity:1,price:90,executedAt:'2026-10-05T14:02:30Z',at:'2026-10-05T14:04:00Z'
  });
  p=snap(s,'2026-10-05T14:04:00Z');
  assert.equal(p.reservedCash,0);
  assert.equal(p.freeWeekly,330);
  assert.equal(p.orders[0].remainingQuantity,3);
  assert.throws(()=>mutate(s,'recordFill',{
    tradeId:'T3',orderId:'A',quantity:1,price:90,executedAt:'2026-10-05T14:03:01Z',at:'2026-10-05T14:05:00Z'
  }),/lifetime/);
});
test('new week never copies residual cap and carries outstanding cash reservation',()=>{
  let s=make();
  s=mutate(s,'addOrder',{
    orderId:'A',quantity:4,limitPrice:100
  });
  const p=snap(s,NEXT);
  assert.equal(p.totalRemaining,1000);
  assert.equal(p.reservedCash,400);
  assert.equal(p.weeklyCap,null);
  assert.equal(p.planningCapacity,0);
  assert.equal(p.needsWeekConfirmation,true);
  s=mutate(s,'beginWeek',{
    weeklyCap:500,at:NEXT
  });
  assert.equal(snap(s,NEXT).freeWeekly,100);
  assert.equal(snap(s,NEXT).freeTotal,600);
});
test('prior week breach persists after confirmation and late report uses execution week',()=>{
  let s=make();
  s=mutate(s,'recordFill',{
    tradeId:'T',quantity:7,price:100
  });
  assert.equal(snap(s).totalFilled,700);
  assert.equal(snap(s).breaches.weekly,true);
  s=mutate(s,'beginWeek',{
    weeklyCap:300,at:NEXT
  });
  assert.equal(snap(s,NEXT).breaches.weekly,true);
  assert.equal(snap(s,NEXT).weeklyFilled,0);
  assert.equal(snap(s,NEXT).planningCapacity,0);
  let q=make();
  q=mutate(q,'beginWeek',{
    weeklyCap:500,at:NEXT
  });
  q=mutate(q,'recordFill',{
    tradeId:'late',quantity:7,price:100,executedAt:MON,at:'2026-10-12T14:01:00Z'
  });
  const p=snap(q,'2026-10-12T14:01:00Z');
  assert.equal(p.weeklyFilled,0);
  assert.equal(p.weeklyBreaches[0].weekKey,'2026-10-05');
  assert.equal(p.planningBlocked,true);
});
test('total cap breach records true fills and blocks new orders',()=>{
  let s=make();
  s=mutate(s,'recordFill',{
    tradeId:'T',quantity:15,price:100
  });
  const p=snap(s);
  assert.equal(p.totalFilled,1500);
  assert.equal(p.totalRemaining,0);
  assert.equal(p.breaches.total,true);
  assert.equal(p.freeTotal,0);
  s=mutate(s,'recordWorkingOrder',{
    orderId:'x',quantity:1,limitPrice:1
  });
  assert.equal(snap(s).reservedQuantity,1);
  assert.equal(snap(s).planningBlocked,true);
});
test('sell reservations consume units and actual notional only determines weighted price',()=>{
  let s=make({
    side:'sell',totalRemaining:20,weeklyRemaining:10
  });
  s=mutate(s,'addOrder',{
    orderId:'A',quantity:8,limitPrice:100
  });
  s=mutate(s,'recordFill',{
    tradeId:'T',orderId:'A',quantity:3,price:110
  });
  const p=snap(s);
  assert.equal(p.totalFilled,3);
  assert.equal(p.totalRemaining,17);
  assert.equal(p.freeWeekly,2);
  assert.equal(p.reservedQuantity,5);
  assert.equal(p.averageFillPrice,110);
});
test('duplicate trade is idempotent; altered same trade and stale revision fail closed',()=>{
  let s=make();
  const p={
    tradeId:'T',quantity:1,price:100
  };
  s=mutate(s,'recordFill',p);
  assert.equal(L.recordFill(s,{
    ...p,eventId:'retry',at:MON,expectedRevision:0
  }),s);
  assert.throws(()=>L.recordFill(s,{
    ...p,price:101,eventId:'retry',at:MON,expectedRevision:0
  }),/Conflicting trade/);
  assert.throws(()=>L.addOrder(s,{
    orderId:'A',quantity:1,limitPrice:100,eventId:'e2',at:MON,expectedRevision:0
  }),/Stale/);
});
test('saved-state replay rejects unsupported, malformed, fake revision, negative and invalid execution dates',()=>{
  let s=make();
  s=mutate(s,'addOrder',{
    orderId:'A',quantity:2,limitPrice:100
  });
  s=mutate(s,'recordFill',{
    tradeId:'T',orderId:'A',quantity:1,price:90
  });
  assert.deepEqual(snap(L.decode(L.serialize(s))),snap(s));
  for(const edit of [r=>r.schemaVersion=2,r=>r.revision++,r=>r.events[0].quantity=-1,r=>r.events[1].executedAt='2026-02-30T14:00:00.000Z',r=>r.events[0].quantity=0,r=>r.extra='secret',r=>r.key='wrong',r=>r.events[1].tradeId='']){
    let r=JSON.parse(L.serialize(s));
    edit(r);
    assert.throws(()=>L.decode(r));
  }
  for(const raw of ['bad','null','[]','{"__proto__":{"x":1}}'])assert.throws(()=>L.decode(raw));
});
test('input identities must match; old immutable state and frozen views cannot corrupt next action',()=>{
  let s=make();
  assert.throws(()=>mutate(s,'recordFill',{
    instrumentId:'WRONG',tradeId:'T',quantity:1,price:1
  }),/does not match/);
  assert.throws(()=>{
    s.initialTotalRemaining=100000
  });
  let next=mutate(s,'addOrder',{
    orderId:'A',quantity:1,limitPrice:100
  });
  const p=snap(next);
  assert.throws(()=>p.orders[0].quantity=10000);
  assert.equal(snap(next).reservedCash,100);
  assert.equal(snap(s).reservedCash,0);
});
test('week boundary follows NY rather than UTC; crypto follows UTC',()=>{
  assert.equal(L.weekKey('XNYS','2026-10-12T02:00:00Z'),'2026-10-05');
  assert.equal(L.weekKey('24X7','2026-10-12T02:00:00Z'),'2026-10-12');
});
test('numeric and timestamp bounds fail closed, no synthetic fills from deadline',()=>{
  for(const x of [NaN,Infinity,-1,Number.MAX_SAFE_INTEGER+1,'10'])assert.throws(()=>make({
    totalRemaining:x
  }));
  for(const at of ['2026-02-30T00:00:00Z','1899-01-01T00:00:00Z','2026-01-01T00:00:00+00:00'])assert.throws(()=>make({
    at
  }));
  const s=make({
    deadlineDate:'2026-10-05'
  }),p=snap(s,NEXT);
  assert.equal(p.deadlinePassed,true);
  assert.equal(p.totalFilled,0);
  assert.equal(p.totalRemaining,1000);
});
test('exhaustive small buy cash ledgers conserve total for fill/cancel sequences',()=>{
  for(let qty=1;
  qty<=9;
  qty++)for(let filled=0;
  filled<=qty;
  filled++)for(let price=1;
  price<=7;
  price++){
    let s=make();
    s=mutate(s,'addOrder',{
      orderId:'A',quantity:qty,limitPrice:10
    });
    if(filled)s=mutate(s,'recordFill',{
      tradeId:'T',orderId:'A',quantity:filled,price
    });
    let p=snap(s);
    assert.equal(p.totalFilled+p.reservedCash+p.freeTotal,1000);
    assert.equal(p.weeklyFilled+p.reservedCash+p.freeWeekly,600);
    if(filled<qty){
      s=mutate(s,'confirmCancel',{
        orderId:'A'
      });
      p=snap(s);
      assert.equal(p.reservedCash,0);
      assert.equal(p.totalFilled+p.freeTotal,1000)
    }
  }
});
test('already-working orders above caps or before new-week confirmation stay truthful and block new plans',()=>{
  let s=make();
  s=mutate(s,'recordWorkingOrder',{
    orderId:'over',quantity:11,limitPrice:100
  });
  let p=snap(s);
  assert.equal(p.reservedCash,1100);
  assert.equal(p.reservationOverTotal,true);
  assert.equal(p.reservationOverWeekly,true);
  assert.equal(p.planningCapacity,0);
  s=mutate(s,'recordWorkingOrder',{
    orderId:'newweek',quantity:1,limitPrice:50,at:NEXT
  });
  p=snap(s,NEXT);
  assert.equal(p.needsWeekConfirmation,true);
  assert.equal(p.reservedCash,1150);
  assert.equal(p.planningBlocked,true);
  assert.deepEqual(snap(L.decode(L.serialize(s)),NEXT),p);
});
