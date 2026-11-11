/* Synthetic engineering comparison. No archived or private dataset is loaded. */
'use strict';
const k = require('./kernel.cjs');
const legacy = require('./frozen/execution-core.js');
const spec = require('./spec.json');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
function rand(seed) { return () => {seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return ((t^t>>>14)>>>0)/4294967296;}; }
function uniform(seed, bar, index) {return rand(seed*104729+bar*1009+index*31)();}
function normal(r) {return Math.sqrt(-2*Math.log(Math.max(1e-12,r())))*Math.cos(2*Math.PI*r());}
const windows = k.sessionWindows('2026-10-05','2026-10-09','XNYS');
const start=windows[0].start, end=windows.at(-1).end;
const rules={quantityStep:1,priceTick:.01,minQuantity:1,minNotional:0,maxQuantity:0,maxNotional:0};
function makePath(seed, family, mode='deadline') {
  const random=rand(seed), bars=[],history=Array.from({length:21},(_,i)=>({observedAt:start-(21-i)*k.DAY,availableAt:start-(21-i)*k.DAY,price:100*Math.exp(.01*(i%2))}));
  let price=100,ix=0;
  for (let d=0;d<windows.length;d++) {
    const w=windows[d],last=d===windows.length-1&&mode==='deadline'?w.end-15*k.MINUTE:w.end;
    for (let j=0;j<4;j++,ix++) {
      const at=w.start+Math.floor((last-w.start)*j/4), until=w.start+Math.floor((last-w.start)*(j+1)/4);
      const drift=family==='rising'?.0012:family==='falling'?-.0012:0;
      const vol=family==='volatile'?.008:.002;
      const close=price*Math.exp(drift+vol*normal(random));
      const excursion=price*vol*(.15+Math.abs(normal(random))*.5);
      bars.push({at,until,open:price,close,low:Math.max(.01,Math.min(price,close)-excursion),high:Math.max(price,close)+excursion,day:d,index:ix});
      price=close;
    }
  }
  return {bars,history,terminal:price};
}
function quote(at,mid){return {at,availableAt:at,mid,bid:mid-.005,ask:mid+.005};}
function legacyIntents(book,scenario,bar,deadline) {
  const side=book.targetLots>=book.positionLots?'buy':'sell',remaining=k.units(book,k.residualLots(book));
  const completed=k.units(book,book.initialTaskLots-k.residualLots(book));
  const weekly=deadline?remaining:Math.max(0,60-completed);
  if (!weekly) return [];
  const params={market_calendar:'XNYS',trade_side:side,lookback_sessions:20,first_offset_pct:.25,spacing_pct:.8,expected_rungs_per_session:1,session_samples:Array.from({length:20},()=>({drawdown_pct:.5,runup_pct:.5}))};
  const args={weekly:side==='buy'?weekly*bar.open:weekly,total:deadline?(side==='buy'?remaining*bar.open:remaining):remaining*(side==='buy'?bar.open:1),held:k.units(book,book.positionLots),reserved:0,reference:bar.open,weekSessions:5-bar.day,horizon:deadline?5-bar.day:null,params};
  const legacyPlan=side==='buy'?legacy.buyPlan(args):legacy.sellPlan(args);
  const out=[];let left=Math.min(remaining,weekly),cash=book.cash;
  for (const o of legacyPlan.orders) {
    let quantity=Math.min(left,o.shares);
    if(side==='buy')quantity=Math.min(quantity,Math.floor(cash/(o.price*(1+scenario.passive_fee_bps/10000))+1e-9));
    if(!quantity)continue;
    out.push({side,quantity,limitPrice:o.price,feeBps:scenario.passive_fee_bps,kind:'passive_limit'});
    left-=quantity;if(side==='buy')cash-=quantity*o.price*(1+scenario.passive_fee_bps/10000);
  }
  return out;
}
function simulate({seed,family,side,mode,scenario,policy,closeout=true,trace=false,pathOverride=null}) {
  const trajectory=pathOverride||makePath(seed,family,mode),deadline=mode==='deadline';
  let book=k.createBook({position:side==='buy'?25:125,target:side==='buy'?125:25,cash:side==='buy'?20000:0,startAt:start,rules});
  const base={strategy:policy,deadlineAt:deadline?end:null,weeklyQuantity:60,weekStartAt:start-k.DAY,weekEndAt:end+k.DAY,comparisonHorizonAt:end,passiveFeeBps:scenario.passive_fee_bps,aggressiveFeeBps:scenario.aggressive_fee_bps,aggressiveSlippageBps:scenario.aggressive_slippage_bps};
  let seq=0,fillseq=0,timeExposure=0,precloseout=100,closeoutQ=0; const traces=[];
  function cancelAll(at){for(const o of k.openOrders(book)){book=k.cancelRequest(book,o.id,at);book=k.cancelAck(book,o.id,at);}}
  function enact(intents,bar,passive=true) {
    let aggressiveCapacity=scenario.aggressive_capacity_units,passiveCapacity=scenario.capacity_units_per_bar; const pendingFills=[];
    for(let i=0;i<intents.length;i++){
      const o=intents[i],id=`o${seq++}`;book=k.submit(book,o,id,bar.at);
      const aggressive=o.kind==='aggressive_scenario';
      let qty=0;
      if(aggressive){qty=Math.min(o.quantity,aggressiveCapacity);aggressiveCapacity-=qty;}
      else if(passive){
        const eligible=side==='buy'?bar.low<=o.limitPrice*(1-scenario.penetration_bps/10000):bar.high>=o.limitPrice*(1+scenario.penetration_bps/10000);
        if(eligible&&uniform(seed,bar.index,i)<scenario.passive_fill_probability){qty=Math.min(Math.floor(o.quantity*scenario.passive_fill_fraction),passiveCapacity);passiveCapacity-=qty;}
      }
      if(qty>0) pendingFills.push({id:`f${fillseq++}`,orderId:id,quantity:qty,price:o.limitPrice,feeBps:o.feeBps,at:aggressive?bar.at:bar.until-1});
    }
    pendingFills.sort((a,b)=>a.at-b.at).forEach(f=>{book=k.applyFill(book,f);});
  }
  for(const bar of trajectory.bars){
    cancelAll(bar.at);
    const availableHistory=[...trajectory.history,...trajectory.bars.filter(x=>x.day<bar.day&&x.index%4===3).map(x=>({observedAt:x.until,availableAt:x.until,price:x.close}))];
    let plan;
    if(policy==='existing_ladder_fixed_synthetic_parameters')plan={intents:legacyIntents(book,scenario,bar,deadline)};
    else plan=k.plan(book,base,{now:bar.at,nextReviewAt:bar.until,windows,history:availableHistory,quote:quote(bar.at,bar.open)});
    const remBefore=k.residualLots(book);enact(plan.intents,bar);
    // Bar fill timing is unknowable. Right-end residual exposure is intentionally not inferred.
    timeExposure+=remBefore*(bar.until-bar.at);
    if(trace)traces.push({at:bar.at,remainingBefore:remBefore,plan,remainingAfter:k.residualLots(book)});
  }
  precloseout=k.residualLots(book);
  let withoutManualCloseout=k.metrics(book,100,trajectory.terminal);
  if(deadline){
    const beforeFinal=structuredClone(book), at=end-15*k.MINUTE;
    const terminalBar={at,until:end,index:20,day:4,open:trajectory.terminal,close:trajectory.terminal,low:trajectory.terminal,high:trajectory.terminal};
    const availableHistory=[...trajectory.history,...trajectory.bars.filter(x=>x.index%4===3).map(x=>({observedAt:x.until,availableAt:x.until,price:x.close}))];
    function finalBranch(manual){
      cancelAll(at);
      let plan;
      if(!manual&&policy==='existing_ladder_fixed_synthetic_parameters')plan={intents:legacyIntents(book,scenario,terminalBar,true)};
      else plan=k.plan(book,{...base,strategy:manual?'paced_passive':policy,manualCloseoutScenario:manual},{now:at,nextReviewAt:end,windows,history:availableHistory,quote:quote(at,trajectory.terminal)});
      const before=k.residualLots(book);enact(plan.intents,terminalBar,true);
      return before-k.residualLots(book);
    }
    finalBranch(false);withoutManualCloseout=k.metrics(book,100,trajectory.terminal);
    if(closeout){book=beforeFinal;closeoutQ=finalBranch(true);}
    timeExposure+=precloseout*15*k.MINUTE;
  }
  // End-of-observation cancellation acknowledgment is a scenario assumption, not an actual cancellation.
  cancelAll(end);
  const metrics=k.metrics(book,100,trajectory.terminal);
  return {seed,family,side,mode,scenario:scenario.name,policy,...metrics,withoutManualCloseout,precloseoutResidual:precloseout,manualCloseoutFraction:closeoutQ/100,
    conservativeBarStartExposureFraction:timeExposure/(100*k.tradingTime(windows,start,end)),
    ...(trace?{traces}:{}),terminal:trajectory.terminal};
}
function mean(xs){return xs.reduce((s,x)=>s+x,0)/xs.length;}
function quantile(xs,q){const s=[...xs].sort((a,b)=>a-b),z=(s.length-1)*q;return s[Math.floor(z)]+(s[Math.ceil(z)]-s[Math.floor(z)])*(z%1);}
function summarize(rows) {
  return {episodes:rows.length,meanWithoutCloseoutCostBps:mean(rows.map(x=>x.withoutManualCloseout.costBps)),p95WithoutCloseoutCostBps:quantile(rows.map(x=>x.withoutManualCloseout.costBps),.95),meanWithoutCloseoutCompletion:mean(rows.map(x=>x.withoutManualCloseout.completion)),p10WithoutCloseoutCompletion:quantile(rows.map(x=>x.withoutManualCloseout.completion),.1),meanCostBps:mean(rows.map(x=>x.costBps)),p95CostBps:quantile(rows.map(x=>x.costBps),.95),worstCostBps:Math.max(...rows.map(x=>x.costBps)),meanCompletion:mean(rows.map(x=>x.completion)),p10Completion:quantile(rows.map(x=>x.completion),.1),worstCompletion:Math.min(...rows.map(x=>x.completion)),meanPassiveCompletion:mean(rows.map(x=>x.passiveCompletion)),meanAggressiveFraction:mean(rows.map(x=>x.aggressiveFraction)),meanPrecloseoutResidual:mean(rows.map(x=>x.precloseoutResidual)),meanManualCloseoutFraction:mean(rows.map(x=>x.manualCloseoutFraction))};
}
function implementationHashes(){return Object.fromEntries(['spec.json','kernel.cjs','replay.cjs','frozen/execution-core.js','frozen/market-calendar.js','frozen/manifest.json'].map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,file))).digest('hex')]));}
function run(seeds=spec.synthetic_evaluation.seeds){
  const implementation=implementationHashes(),runStartedAt=new Date().toISOString();
  const results=[];
  for(const family of spec.synthetic_evaluation.path_families)for(const side of spec.synthetic_evaluation.sides)for(const mode of ['deadline','no_deadline'])for(const scenario of spec.scenarios){
    const cells=[];
    for(const policy of spec.policies){const rows=[];for(let seed=1;seed<=seeds;seed++)rows.push(simulate({seed,family,side,mode,scenario,policy}));cells.push({family,side,mode,scenario:scenario.name,policy,...summarize(rows)});}
    for(const c of cells)c.nondominatedInSyntheticScenario=!cells.some(b=>b!==c&&b.meanCostBps<=c.meanCostBps&&b.meanCompletion>=c.meanCompletion&&(b.meanCostBps<c.meanCostBps||b.meanCompletion>c.meanCompletion));
    for(const c of cells)c.nondominatedWithoutManualCloseout=!cells.some(b=>b!==c&&b.meanWithoutCloseoutCostBps<=c.meanWithoutCloseoutCostBps&&b.meanWithoutCloseoutCompletion>=c.meanWithoutCloseoutCompletion&&(b.meanWithoutCloseoutCostBps<c.meanWithoutCloseoutCostBps||b.meanWithoutCloseoutCompletion>c.meanWithoutCloseoutCompletion));
    results.push(...cells);
  }
  if(JSON.stringify(implementation)!==JSON.stringify(implementationHashes()))throw Error('implementation changed during replay');
  return {implementation,runStartedAt,nodeVersion:process.version,specSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'spec.json'))).digest('hex'),generatedAt:new Date().toISOString(),seeds,episodes:results.reduce((n,x)=>n+x.episodes,0),scope:'Synthetic scenarios only, not empirically calibrated probabilities or evidence of trading edge',assumptions:['all strategies use identical paths, fees, spread assumptions, quantity rules, resource accounting, cancellation acknowledgments and scenario capacity','passive OHLC crossing is eligibility, fill Bernoulli/fraction/capacity are exogenous sensitivity assumptions','immediate means earliest feasible repeated attempts under the same per-checkpoint aggressive capacity','deadline results include explicitly assumed manual closeout; precloseout residual is separately reported','no-deadline weekly cap is 60 of 100; TWAP horizon is a comparison interval and causes no closeout','existing ladder uses exact phase-1 quote-generation functions with declared synthetic parameters, target-unit feasibility adapter and per-review replacement; it is not the old full cash-budget/selector policy','terminal residual is marked at common terminal mid without pretending execution; synthetic mid is held constant through the final 15-minute manual-closeout interval','market impact, actual queue/latency, trading halts and operational errors are not estimated'],results};
}
if(require.main===module){const seeds=process.argv.includes('--smoke')?2:spec.synthetic_evaluation.seeds;const output=run(seeds);fs.writeFileSync(path.join(__dirname,'results',seeds===2?'smoke.json':'synthetic-comparison.json'),JSON.stringify(output,null,2)+'\n');console.log(JSON.stringify({episodes:output.episodes,cells:output.results.length,seeds,specSha256:output.specSha256}));}
module.exports={simulate,run,makePath,summarize,legacyIntents};
