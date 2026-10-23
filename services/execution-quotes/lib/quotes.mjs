import calendar from './market-calendar.cjs';
export const instruments = Object.freeze({
  'ARCX:BTC': {symbol:'BTC', currency:'USD', crypto:false},
  'ARCX:ETH': {symbol:'ETH', currency:'USD', crypto:false},
  'BINANCE:SPOT:BTCUSDT': {symbol:'BTCUSDT', currency:'USDT', crypto:true},
  'BINANCE:SPOT:ETHUSDT': {symbol:'ETHUSDT', currency:'USDT', crypto:true}
});
export function easternParts(ms) {
  const p=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(ms)).map(p=>[p.type,p.value]));
  return {date:`${p.year}-${p.month}-${p.day}`,hour:+p.hour,minute:+p.minute,second:+p.second};
}
export function easternTimestamp(date,hour,minute,second=0) {
  const target=Date.parse(`${date}T${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}:${String(second).padStart(2,'0')}Z`);
  let value=target;
  for(let i=0;i<3;i++) {const p=easternParts(value); const local=Date.parse(`${p.date}T${String(p.hour).padStart(2,'0')}:${String(p.minute).padStart(2,'0')}:${String(p.second).padStart(2,'0')}Z`);value+=target-local;}
  return value;
}
export function nasdaqTime(text) {
  const m=String(text).match(/(?:Closed at )?([A-Z][a-z]{2}) (\d{1,2}), (\d{4}) (\d{1,2}):(\d{2})(?::(\d{2}))? (AM|PM) ET/);
  if(!m)return null;
  const month=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].indexOf(m[1])+1;
  if(!month)return null;
  return easternTimestamp(`${m[3]}-${String(month).padStart(2,'0')}-${m[2].padStart(2,'0')}`,(+m[4]%12)+(m[7]==='PM'?12:0),+m[5],+(m[6]||0));
}
function positive(value){const n=Number(value);return Number.isFinite(n)&&n>0?n:null;}
export function referenceState(now,crypto=false) {
  const p=easternParts(now), start=easternTimestamp(p.date,9,35);
  const state=!crypto&&!calendar.isSupportedDate(p.date)?'unavailable':!crypto&&!calendar.isSession(p.date)?'no-session':now<start+60000?'pending':'unavailable';
  return {date:p.date,minute:'09:35',timezone:'America/New_York',start,readyAt:new Date(start+60000).toISOString(),status:state,price:null};
}
export function yahooReference(payload,reference,symbol) {
  const r=payload?.chart?.result?.[0];
  if(r?.meta?.symbol!==symbol||r?.meta?.currency!=='USD'||r?.meta?.dataGranularity!=='1m')return reference;
  const i=r.timestamp?.findIndex(t=>t*1000===reference.start);
  const price=i>=0?positive(r.indicators?.quote?.[0]?.close?.[i]):null;
  return price?{...reference,status:'ready',price,source:'Yahoo Finance · 1-minute close'}:reference;
}
async function json(url,fetcher) {
  const r=await fetcher(url,{headers:{'User-Agent':'Mozilla/5.0','Accept':'application/json'},signal:AbortSignal.timeout(10000)});
  if(!r.ok)throw Error(`Upstream status ${r.status}`);
  return r.json();
}
export async function getQuote(id,{now=Date.now(),fetcher=fetch,referenceCache=null}={}) {
  const instrument=instruments[id];if(!instrument)throw Error('Unsupported instrument');
  const {symbol,currency,crypto}=instrument;
  let reference=referenceState(now,crypto);
  const key=`https://execution-reference.invalid/${encodeURIComponent(id)}/${reference.date}`;
  const cached=referenceCache&&await referenceCache.match(key);
  if(cached&&reference.status==='unavailable')reference=await cached.json();
  const latestTask=(async()=>{
    if(crypto){
      const rows=await json(`https://data-api.binance.vision/api/v3/trades?symbol=${symbol}&limit=1`,fetcher);
      const row=rows?.[0],price=positive(row?.price),time=positive(row?.time);
      if(!price||!time||time>now+60000)throw Error('Invalid trade');
      return {price,time:new Date(time).toISOString(),source:'Binance Spot',kind:'last-trade',realtime:true,stale:now-time>300000};
    }
    const payload=await json(`https://api.nasdaq.com/api/quote/${symbol}/info?assetclass=etf`,fetcher);
    const d=payload?.data;
    if(d?.symbol!==symbol||d?.assetClass?.toUpperCase()!=='ETF')throw Error('Wrong instrument');
    const row=d.primaryData,price=positive(String(row?.lastSalePrice).replace(/[$,]/g,'')),time=nasdaqTime(row?.lastTradeTimestamp);
    if(!price||!time||time>now+60000)throw Error('Invalid trade');
    return {price,time:new Date(time).toISOString(),source:'Nasdaq website',kind:'last-trade',realtime:row.isRealTime===true,stale:now-time>300000,marketStatus:d.marketStatus};
  })();
  const referenceTask=(async()=>{
    if(reference.status!=='unavailable'||(!crypto&&!calendar.isSupportedDate(reference.date)))return reference;
    if(crypto){
      const rows=await json(`https://data-api.binance.vision/api/v3/klines?symbol=${symbol}&interval=1m&startTime=${reference.start}&endTime=${reference.start+59999}&limit=1`,fetcher);
      const row=rows?.[0],price=positive(row?.[4]);
      if(row?.[0]===reference.start&&row?.[6]===reference.start+59999&&price)reference={...reference,status:'ready',price,source:'Binance Spot · 1-minute close'};
    } else {
      const payload=await json(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1m&range=1d&includePrePost=true`,fetcher);
      reference=yahooReference(payload,reference,symbol);
    }
    if(reference.status==='ready'&&referenceCache)await referenceCache.put(key, new Response(JSON.stringify(reference),{headers:{'Content-Type':'application/json','Cache-Control':'public,max-age=86400'}}));
    return reference;
  })();
  const [latestResult,referenceResult]=await Promise.allSettled([latestTask,referenceTask]);
  return {instrumentId:id,symbol,currency,fetchedAt:new Date(now).toISOString(),latest:latestResult.status==='fulfilled'?latestResult.value:null,reference:referenceResult.status==='fulfilled'?referenceResult.value:reference};
}
