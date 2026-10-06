/* Independent synthetic DOM/VM integration tests. No network or browser profile.
* These test state/storage callbacks, not native HTML validation or visual layout;
* the separate opt-in Chromium suite covers real browser behavior.
*/
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
const root=require('node:path').join(__dirname, '../execution/');
class Element{
  constructor(id=''){
    this.id=id;
    this.value='';
    this.hidden=false;
    this.disabled=false;
    this.textContent='';
    this.listeners={
    };
    this.children=[];
    this.options=[];
    this.dataset={
    }
  }addEventListener(t,f){
    (this.listeners[t]??=[]).push(f)
  }append(...a){
    this.children.push(...a)
  }replaceChildren(...a){
    this.children=a;
    this.options=a;
    this.value=a[0]?.value||''
  }add(x){
    this.options.push(x)
  }focus(){
  }closest(){
    return this.detail ??= new Element("details")
  }reset(){
    if(this.id==='progress-fill-form')for(const k of ['id','qty','price','at','order'])this.env.el('progress-fill-'+k).value='';
    if(this.id==='progress-order-form')for(const k of ['id','qty','price'])this.env.el('progress-order-'+k).value=''
  }async fire(t='click',target=this){
    for(const f of this.listeners[t]||[])await f({
      target,preventDefault(){
      }
    })
  }
}
function sharedStorage(){
  const store=new Map();
  return {
    store,reads:[],writes:[],failWrite:false,failRead:false,getItem(k){
      this.reads.push(k);
      if(this.failRead)throw Error('blocked');
      return this.store.get(k)??null
    },setItem(k,v){
      if(this.failWrite)throw Error('full');
      this.writes.push({
        k,v
      });
      this.store.set(k,v)
    },removeItem(k){
      if(this.failWrite)throw Error('blocked');
      this.writes.push({
        k,remove:true
      });
      this.store.delete(k)
    }
  }
}
function env({
  storage=sharedStorage(),locks=true
}={
}){
  const els=new Map(),events={
  },state={
    time:'2026-10-05T14:00:00.000Z',side:'buy',instrumentId:'ARCX:T',clearCount:0
  };
  const el=id=>{
    if(!els.has(id)){
      const e=new Element(id);
      e.env={
        el
      };
      els.set(id,e)
    }return els.get(id)
  };
  el('progress-account').value='one';
  for(const k of ['one','two'])for(const id of ['weekly-'+k,'capital-'+k,'sell-weekly-'+k,'sell-total-'+k,'sell-held-'+k,'sell-reserved-'+k])el(id).value='';
  el('weekly-one').value='100';
  el('capital-one').value='1000';
  el('weekly-two').value='0';
  const context=vm.createContext({
    console,URL,Blob,Storage:undefined,crypto:{
      randomUUID:()=>`uuid-${Math.random()}`
    },document:{
      getElementById:el,createElement:()=>new Element()
    },navigator:{
      locks:locks?{
        request:async(n,o,f)=>f()
      }:undefined
    },localStorage:storage,Option:class extends Element{
      constructor(t,v){
        super();
        this.textContent=t;
        this.value=v
      }
    },setTimeout:()=>{
    },addEventListener:(t,f)=>(events[t]??=[]).push(f),state
  });
  vm.runInContext(`window=globalThis; const RD=Date; Date=class extends RD{constructor(...args){super(...(args.length?args:[state.time]))}static now(){return RD.parse(state.time)}};`,context);
  for(const f of ['market-calendar.js','execution-core.js','task-ledger.js','task-ledger-ui.js'])vm.runInContext(fs.readFileSync(root+f,'utf8'),context,{
    filename:f
  });
  const params=()=>({
    instrument_id:state.instrumentId,symbol:'TEST',currency:'USD',base_asset:'shares',market_calendar:'XNYS',quantity_step:1,price_tick:.01,first_offset_pct:.5,spacing_pct:1,lookback_sessions:5,expected_rungs_per_session:1,trade_side:state.side
  });
  const host={
    context:()=>({
      instrumentId:state.instrumentId,side:state.side,params:params()
    }),clearResults:()=>state.clearCount++,amountFields:account=>({
      weekly:el(state.side==='buy'?'weekly-'+account:'sell-weekly-'+account),total:el(state.side==='buy'?'capital-'+account:'sell-total-'+account)
    })
  };
  context.ExecutionProgressUI.init(host);
  return {
    context,el,state,storage,params,events,async open(){
      await el('progress-enable').fire()
    },async create(){
      await el('progress-create-button').fire()
    },async use(){
      await el('progress-use').fire()
    },async order(q,p,id='O'){
      el('progress-order-qty').value=String(q);
      el('progress-order-price').value=String(p);
      el('progress-order-id').value=id;
      await el('progress-order-form').fire('submit')
    },async fill(q,p,id='F',order=''){
      el('progress-fill-qty').value=String(q);
      el('progress-fill-price').value=String(p);
      el('progress-fill-id').value=id;
      el('progress-fill-order').value=order;
      await el('progress-fill-form').fire('submit')
    },ledger(){
      return JSON.parse(storage.store.get('execution-progress-v1')||'null')
    },plan(horizon=1){
      const input={
        weekly:el(state.side==='buy'?'weekly-one':'sell-weekly-one').value,total:el(state.side==='buy'?'capital-one':'sell-total-one').value,reference:10,weekSessions:5,horizon,params:params(),held:el('sell-held-one').value,reserved:el('sell-reserved-one').value
      };
      const raw=context.ExecutionCore[state.side==='buy'?'buyPlan':'sellPlan'](input);
      return {
        raw,clipped:context.ExecutionProgressUI.capPlan('one',raw)
      }
    }
  }
}
test('OFF init no financial storage read/write; open only reads; explicit creation persists',async()=>{
  const e=env();
  assert.equal(e.storage.reads.length,0);
  assert.equal(e.storage.writes.length,0);
  await e.open();
  assert.equal(e.storage.writes.length,0);
  await e.create();
  assert.equal(e.ledger().tasks.length,1);
  assert.equal(e.ledger().tasks[0].initialTotalRemaining,1000)
});
test('buy free funds bind; deadline hard cap clips without altering strategy prices',async()=>{
  const e=env();
  await e.open();
  await e.create();
  await e.order(3,10);
  await e.use();
  assert.equal(e.el('weekly-one').value,70);
  assert.equal(e.el('capital-one').value,970);
  const {
    raw,clipped
  }=e.plan();
  assert.ok(raw.orders.reduce((s,o)=>s+o.notional,0)>70);
  assert.ok(clipped.orders.reduce((s,o)=>s+o.notional,0)<=70);
  for(const o of clipped.orders)assert.equal(o.price,raw.orders.find(x=>x.rung===o.rung).price);
  await e.el('calculator-form').fire('input',e.el('deadline'));
  assert.ok(e.plan().clipped.progressNote);
  await e.el('calculator-form').fire('input',e.el('reference-price'));
  assert.ok(e.plan().clipped.progressNote);
  e.el('weekly-one').value='200';
  await e.el('calculator-form').fire('input',e.el('weekly-one'));
  assert.equal(e.plan().clipped.progressNote,undefined);
  assert.match(e.el('progress-binding').textContent,/Manual mode/)
});
test('SELL gross targets with all manual reservations subtract once and cap deadline',async()=>{
  const e=env();
  e.state.side='sell';
  e.el('sell-weekly-one').value='100';
  e.el('sell-total-one').value='500';
  e.el('sell-held-one').value='500';
  e.el('sell-reserved-one').value='20';
  e.context.ExecutionProgressUI.contextChanged();
  await e.open();
  await e.create();
  await e.order(10,10);
  await e.use();
  assert.equal(e.el('sell-weekly-one').value,100);
  assert.equal(e.el('sell-total-one').value,500);
  const {
    clipped
  }=e.plan();
  assert.equal(clipped.orderQuantity,80);
  assert.ok(clipped.orders.reduce((a,o)=>a+o.shares,0)<=80);
});
test('SELL rejects missing holdings or total reserved below known ledger quantity',async()=>{
  const e=env();
  e.state.side='sell';
  e.el('sell-weekly-one').value='100';
  e.el('sell-total-one').value='500';
  await e.open();
  await e.create();
  await e.order(10,10);
  await e.use();
  assert.match(e.el('progress-error').textContent,/holdings/);
  e.el('sell-held-one').value='500';
  e.el('sell-reserved-one').value='9';
  await e.use();
  assert.match(e.el('progress-error').textContent,/holdings/)
});
test('malformed and unsupported storage fail closed with zero overwrite',async()=>{
  for(const raw of ['{','null','{"storageVersion":2,"revision":0,"tasks":[]}']){
    const storage=sharedStorage();
    storage.store.set('execution-progress-v1',raw);
    const e=env({
      storage
    });
    await e.open();
    assert.equal(e.el('progress-create').hidden,true);
    await e.create();
    assert.equal(storage.store.get('execution-progress-v1'),raw);
    assert.equal(storage.writes.length,0);
    assert.ok(e.el('progress-error').textContent)
  }
});
test('quota failure and absent Web Locks do not claim success or persist',async()=>{
  for(const opts of [{
    locks:false
  },{
  }]){
    const e=env(opts);
    await e.open();
    if(opts.locks!==false)e.storage.failWrite=true;
    await e.create();
    assert.equal(e.storage.writes.length,0);
    assert.equal(e.ledger(),null);
    assert.match(e.el('progress-error').textContent,opts.locks===false?/coordinate/:/could not save/);
    assert.doesNotMatch(e.el('progress-message').textContent,/Starting amounts confirmed/)
  }
});
test('two loaded tabs reject stale writes and old bound plans',async()=>{
  const storage=sharedStorage(),a=env({
    storage
  }),b=env({
    storage
  });
  await a.open();
  await a.create();
  await b.open();
  await b.use();
  await a.fill(1,10);
  await b.fill(2,10);
  assert.match(b.el('progress-error').textContent,/changed|Reload/);
  assert.equal(a.ledger().tasks[0].events.length,1);
  assert.throws(()=>b.plan(),/changed|bound/)
});
test('clear confirmation cancel is no-op and confirmed clear removes only ledger',async()=>{
  const e=env();
  e.storage.store.set('unrelated','keep');
  await e.open();
  await e.create();
  await e.el('progress-reset').fire();
  assert.equal(e.el('progress-confirm').hidden,false);
  await e.el('progress-confirm-no').fire();
  assert.equal(e.ledger().tasks.length,1);
  await e.el('progress-reset').fire();
  await e.el('progress-confirm-yes').fire();
  assert.equal(e.ledger(),null);
  assert.equal(e.storage.store.get('unrelated'),'keep')
});
test('instrument or account switch clears pending drafts and confirmation, preserves separate records',async()=>{
  const e=env();
  await e.open();
  await e.create();
  e.el('progress-fill-qty').value='999';
  e.el('progress-order-qty').value='999';
  await e.el('progress-reset').fire();
  e.state.instrumentId='ARCX:OTHER';
  e.context.ExecutionProgressUI.contextChanged();
  assert.equal(e.el('progress-fill-qty').value,'');
  assert.equal(e.el('progress-order-qty').value,'');
  assert.equal(e.el('progress-confirm').hidden,true);
  assert.equal(e.el('progress-task').hidden,true);
  e.el('progress-fill-qty').value='999';
  e.el('progress-account').value='two';
  await e.el('progress-account').fire('change');
  assert.equal(e.el('progress-fill-qty').value,'');
  assert.equal(e.ledger().tasks.length,1)
});
test('new week invalidates binding until explicit cap; total and orders persist',async()=>{
  const e=env();
  await e.open();
  await e.create();
  await e.order(3,10);
  await e.use();
  e.state.time='2026-10-12T14:00:00Z';
  e.context.ExecutionProgressUI.refresh();
  assert.equal(e.el('progress-use').disabled,true);
  assert.throws(()=>e.plan(),/week|bound/);
  assert.equal(e.ledger().tasks[0].events.length,1);
  e.el('progress-week-cap').value='200';
  await e.el('progress-confirm-week').fire();
  await e.use();
  assert.equal(e.el('weekly-one').value,170);
  assert.equal(e.el('capital-one').value,970)
});
test('linked overfill reports explicit error and does not claim recorded',async()=>{
  const e=env();
  await e.open();
  await e.create();
  await e.order(3,10);
  const message=e.el('progress-message').textContent;
  await e.fill(4,9,'F','O');
  assert.match(e.el('progress-error').textContent,/individual order quantity/);
  assert.doesNotMatch(e.el('progress-message').textContent,/Actual fill recorded/);
  assert.equal(e.ledger().tasks[0].events.length,1)
});
test('full storage after binding must invalidate old bound plan until reload/manual detach',async()=>{
  const e=env();
  await e.open();
  await e.create();
  await e.use();
  e.storage.failWrite=true;
  await e.fill(1,10);
  assert.match(e.el('progress-error').textContent,/could not save/);
  assert.throws(()=>e.plan(),/save|storage|bound|reload|Reload/);
});
test('lost storage read clears displayed bound result immediately on focus',async()=>{
  const e=env();
  await e.open();
  await e.create();
  await e.use();
  const prior=e.state.clearCount;
  e.storage.failRead=true;
  for(const f of e.events.focus||[])f();
  assert.ok(e.state.clearCount>prior,'bound result cleared after failed read');
  assert.throws(()=>e.plan(),/storage|bound|reload|Reload/);
  e.el('weekly-one').value='50';
  await e.el('calculator-form').fire('input',e.el('weekly-one'));
  assert.doesNotThrow(()=>e.plan());
});
test('different failed event forms cannot erase unresolved actual-fill gate',async()=>{
  const e=env();
  await e.open();
  await e.create();
  await e.order(3,10,'O');
  await e.use();
  await e.fill(4,9,'F','O');
  assert.equal(e.el('progress-use').disabled,true);
  await e.order(1,10,'O');
  await e.order(1,10,'O2');
  await e.el('progress-reload').fire();
  assert.equal(e.el('progress-use').disabled,true,'failed linked fill still needs reconciliation after another order is saved');
});
test('overcommitted actual working order remains recordable and disables planning',async()=>{
  const e=env();
  await e.open();
  await e.create();
  await e.order(20,10,'over');
  assert.equal(e.ledger().tasks[0].events.length,1);
  assert.equal(e.el('progress-use').disabled,true);
  assert.equal(e.el('progress-order-save').disabled,false);
  await e.order(1,10,'more');
  assert.equal(e.ledger().tasks[0].events.length,2);
  assert.equal(e.el('progress-use').disabled,true)
});
test('navigation warning is limited to unresolved actual-event drafts and survives record reload', async () => {
  const e = env();
  function warned() {
    const event = { defaultPrevented: false, returnValue: undefined,
      preventDefault() { this.defaultPrevented = true; } };
    for (const listener of e.events.beforeunload || []) listener(event);
    if (event.defaultPrevented) assert.equal(event.returnValue, '');
    return event.defaultPrevented;
  }
  assert.equal(warned(), false, 'optional feature off does not warn');
  await e.open();
  await e.create();
  await e.order(3, 10, 'O');
  assert.equal(warned(), false, 'fully saved records do not warn');
  await e.fill(4, 9, 'F', 'O');
  assert.equal(warned(), true, 'failed real-event entry warns');
  assert.match(e.el('progress-error').textContent, /full page refresh.*lose the unsaved draft/i);
  await e.el('progress-reload').fire();
  assert.equal(warned(), true, 'same-page reload retains pending entry');
  await e.fill(2, 9, 'F', 'O');
  assert.equal(warned(), false, 'corrected and saved event clears warning');
});
