/* Price-priority monthly BUY policy: one reviewed order, cash may carry. */
(function(root,factory){
  const calendar = typeof module === 'object' && module.exports ? require('./market-calendar.js') : root.ExecutionCalendar;
  const api=factory(calendar);
  if(typeof module==='object'&&module.exports)module.exports=api;else root.ExecutionMonthlyPolicy=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(Calendar){
  'use strict';
  const VERSION='monthly-dynamic-v1';
  const clamp=(x,lo,hi)=>Math.max(lo,Math.min(hi,x));
  function quantile(values,p){
    const sorted=values.slice().sort((a,b)=>a-b), at=(sorted.length-1)*p, lo=Math.floor(at);
    return sorted[lo]+(sorted[Math.min(lo+1,sorted.length-1)]-sorted[lo])*(at-lo);
  }
  function validCandidate(c){
    return c && typeof c.id==='string' && [10,20,40,60].includes(c.lookback)
      && [.5,1,2].includes(c.fill_intensity) && [.5,1,1.5].includes(c.allocation_scale);
  }
  function decision({samples,sessionDate,remainingDays,slots,candidate}){
    if(!validCandidate(candidate))throw Error('A fitted monthly pricing candidate is required.');
    if(!Number.isInteger(remainingDays)||remainingDays<0||!Number.isSafeInteger(slots)||slots<0)
      throw Error('Monthly days and free trade slots must be nonnegative whole numbers.');
    if(!Calendar.dateKey(sessionDate))throw Error('A valid pricing session date is required.');
    if(!slots||!remainingDays)return {offset:0,fraction:0,quantile:null,sampleCount:0,opportunities:0};
    const prior=(samples||[]).filter(s=>Calendar.dateKey(s.date)&&s.date<sessionDate
      &&Number.isFinite(s.drawdown_pct)&&s.drawdown_pct>=0).slice().sort((a,b)=>a.date.localeCompare(b.date));
    if(new Set(prior.map(s=>s.date)).size!==prior.length)throw Error('Monthly price history contains duplicate sessions.');
    const history=prior.slice(-candidate.lookback);
    if(history.length<candidate.lookback)throw Error(`Monthly pricing needs ${candidate.lookback} completed prior sessions; only ${history.length} are available.`);
    const moves=history.map(s=>s.drawdown_pct/100),opportunities=Math.min(slots,remainingDays);
    const q=clamp(1-candidate.fill_intensity*opportunities/remainingDays,.25,.9);
    const offset=clamp(quantile(moves,q),.0005,.05);
    const median=Math.max(.0005,quantile(moves,.5));
    const edge=clamp(Math.sqrt(offset/median),.5,2);
    const fraction=clamp(candidate.allocation_scale/opportunities*edge,.05,opportunities>1?.75:1);
    return {offset,fraction,quantile:q,sampleCount:history.length,opportunities,historyThrough:history.at(-1).date};
  }
  function monthState({marketCalendar,at=new Date()}){
    const crypto=marketCalendar==='24X7';
    const local=Calendar.calendarParts({market_calendar:'XNYS'},at);
    const window=crypto?null:Calendar.planningWindow(local);
    const day=crypto?local.date:window.planningDate;
    if(!day)throw Error('Monthly planning needs a supported exchange calendar date.');
    const end=new Date(Date.UTC(day.getUTCFullYear(),day.getUTCMonth()+1,0));
    let remainingDays=0;
    for(let cursor=new Date(day);cursor<=end;cursor.setUTCDate(cursor.getUTCDate()+1)){
      if(!crypto&&!Calendar.isSupportedDate(cursor))throw Error('The month extends beyond the verified exchange calendar.');
      if(crypto||Calendar.isSession(cursor))remainingDays++;
    }
    return {month:Calendar.dateKey(day).slice(0,7),remainingDays,lastCalendarDate:Calendar.dateKey(end),
      sessionDate:crypto?Calendar.dateKey(Calendar.calendarParts({market_calendar:'24X7'},at).date):Calendar.dateKey(day),
      planningDate:Calendar.dateKey(day),preview:crypto?false:window.preview};
  }
  function profile(bundle,instrumentId,limit){
    if(bundle?.schema_version!==1||bundle.policy_version!==VERSION||bundle.status!=='fitted_candidate_unproven')return null;
    const instrument=bundle.instruments?.[instrumentId],selected=instrument?.profiles?.[String(limit)];
    if(!selected||selected.monthly_limit!==limit||!validCandidate(selected.candidate)
      ||!Array.isArray(selected.oos_months)||typeof instrument.data_as_of!=='string'
      ||!Array.isArray(selected.latest_training_months)||!selected.latest_training_months.length
      ||!selected.latest_training_months.every(m=>typeof m==='string'&&/^\d{4}-\d{2}$/.test(m)&&m<instrument.data_as_of.slice(0,7)))return null;
    return {instrument,selected};
  }
  let bundle=null,failed=false;
  function current(instrumentId,limit){return profile(bundle,instrumentId,limit);}
  async function load(onChange){
    try{const response=await fetch('../data/execution_monthly_dynamic_params.json',{cache:'no-store'});if(!response.ok)throw Error('No monthly fit');bundle=await response.json();}
    catch(_){bundle=null;failed=true;}
    onChange();
  }
  function status(){return {loaded:!!bundle,failed};}
  return Object.freeze({VERSION,decision,monthState,profile,current,load,status,validCandidate});
});
