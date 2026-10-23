/* Read-only quotes. Background refresh never changes an established plan input. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ExecutionQuotes=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const endpoint='https://execution-market-quotes.attmgromov.chatgpt.site/api/quote';
  function cryptoReference(now=Date.now()) {
    const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(now)).map(p=>[p.type,p.value]));
    const date=`${parts.year}-${parts.month}-${parts.day}`;
    const zone=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',timeZoneName:'shortOffset'}).formatToParts(new Date(date+'T18:00:00Z')).find(p=>p.type==='timeZoneName').value;
    const offset=Number(zone.replace('GMT',''));
    const start=Date.parse(date+'T09:35:00Z')-offset*3600000;
    return {date,start,status:now<start+60000?'pending':'unavailable',price:null};
  }
  async function directCrypto(id,fetcher=fetch,now=Date.now()) {
    const symbol=id==='BINANCE:SPOT:BTCUSDT'?'BTCUSDT':id==='BINANCE:SPOT:ETHUSDT'?'ETHUSDT':null;
    if(!symbol)throw Error('Unsupported crypto instrument');
    const reference=cryptoReference(now),base='https://data-api.binance.vision/api/v3/';
    const json=async path=>{const r=await fetcher(base+path,{cache:'no-store',signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('Unavailable');return r.json();};
    const [trade,bar]=await Promise.allSettled([
      json(`trades?symbol=${symbol}&limit=1`),
      reference.status==='pending'?Promise.resolve(null):json(`klines?symbol=${symbol}&interval=1m&startTime=${reference.start}&endTime=${reference.start+59999}&limit=1`)
    ]);
    let latest=null;
    if(trade.status==='fulfilled') {const row=trade.value?.[0],price=Number(row?.price),time=Number(row?.time);if(price>0&&Number.isFinite(price)&&time>0&&time<=now+60000)latest={price,time:new Date(time).toISOString(),source:'Binance Spot',realtime:true,stale:now-time>300000};}
    if(bar.status==='fulfilled'&&bar.value) {const row=bar.value[0],price=Number(row?.[4]);if(row?.[0]===reference.start&&row?.[6]===reference.start+59999&&price>0&&Number.isFinite(price))Object.assign(reference,{price,status:'ready',source:'Binance Spot · 1-minute close'});}
    return {instrumentId:id,currency:'USDT',latest,reference};
  }
  function controller({fetchQuote,render,apply,status=()=>{}}) {
    let instrument='',generation=0,edit=0,filled=false,latest=null,reference=null,explicitRequest=0,currency='';
    async function refresh({useLatest=false}={}) {
      // A timer must never supersede an explicit click while its request is pending.
      if(explicitRequest&&!useLatest)return;
      const mine=++generation,version=edit,id=instrument;
      if(useLatest){explicitRequest=mine;status({pending:true,message:'Fetching latest available trade…'});}
      try {
        const payload=await fetchQuote(id);
        if(mine!==generation||id!==instrument)return;
        if(payload.instrumentId!==id)throw Error('Wrong instrument');
        latest=payload.latest;currency=payload.currency;
        if(reference?.status!=="ready" || reference.date!==payload.reference?.date)reference=payload.reference;
        render({...payload,reference});
        const valid=latest&&Number.isFinite(latest.price)&&latest.price>0;
        if(edit===version&&(!filled||useLatest)&&valid&&(useLatest||!latest.stale)){
          filled=true;apply(latest.price);
          if(useLatest)status({pending:false,message:`Reference updated to ${latest.price} ${payload.currency||''}.${latest.stale?' This last trade is older than 5 minutes; check the displayed trade time before using it.':''}`});
        } else if(useLatest)status({pending:false,message:edit!==version?'Your newer manual input was kept.':!valid?'No price returned. Your reference is unchanged; try again or enter it manually.':'Reference unchanged.'});
      } catch(error) {
        if(mine===generation){latest=null;render({instrumentId:id,latest:null,reference,currency,error:true});if(useLatest)status({pending:false,message:'Could not retrieve a price. Your reference is unchanged; try again or enter it manually.'});}
      } finally {if(explicitRequest===mine)explicitRequest=0;}
    }
    return {
      select(id){instrument=id;edit++;filled=false;latest=null;reference=null;explicitRequest=0;status({pending:false,message:''});render({loading:true});return refresh();},
      edited(){edit++;filled=true;}, refresh,
      useReference(){if(reference?.status==='ready'&&reference.price>0){edit++;filled=true;apply(reference.price);status({pending:false,message:'Reference updated to the fixed 09:35 ET minute close.'});}},
    };
  }
  function mount(){
    const input=document.getElementById('reference-price'),latestEl=document.getElementById('latest-quote'),referenceEl=document.getElementById('opening-reference'),useReference=document.getElementById('use-opening-reference');
    const money=(value,currency)=>`${Number(value).toLocaleString('en-US',{maximumFractionDigits:8})} ${currency}`;
    const stamp=value=>new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',month:'short',day:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',timeZoneName:'short'}).format(new Date(value));
    const latestButton=document.getElementById('use-latest-price'),actionStatus=document.getElementById('quote-action-status');
    const c=controller({
      status({pending,message}){latestButton.disabled=pending;latestButton.textContent=pending?'Fetching price…':'Use latest price';actionStatus.textContent=message;},
      fetchQuote:async id=>{if(id==='BINANCE:SPOT:BTCUSDT'||id==='BINANCE:SPOT:ETHUSDT')return directCrypto(id);const r=await fetch(`${endpoint}?instrument=${encodeURIComponent(id)}`,{cache:'no-store',signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('Unavailable');return r.json();},
      render(p){
        const q=p.latest,r=p.reference;
        latestEl.textContent=p.loading?'Loading latest market price…':q?`Latest trade: ${money(q.price,p.currency)} · Last trade time: ${stamp(q.time)} · ${q.source}${q.marketStatus?` · ${q.marketStatus}`:''}${q.stale?' · Older than 5 minutes; use the button explicitly or enter a price manually.':''}${!q.realtime?' · Not marked real-time by source.':''}`:'Latest price unavailable. Enter a reference manually or retry.';
        referenceEl.textContent=p.loading?'09:35 ET minute close: loading…':r?`${r.date} · 09:35 ET minute close: ${r.status==='ready'?`${money(r.price,p.currency)} · ${r.source} · fixed for today`:r.status==='pending'?'Pending — available after 09:36 ET':r.status==='no-session'?'No trading session today':'Unavailable — no substitute price used'}`:'09:35 ET minute close: unavailable';
        useReference.disabled=r?.status!=='ready';
      },
      apply(price){const hadResults=!document.getElementById('result-stack').hidden;input.value=price;input.dispatchEvent(new Event('input',{bubbles:true}));if(hadResults)document.getElementById('calculator-form').requestSubmit();}
    });
    input.addEventListener('input',()=>c.edited());
    latestButton.addEventListener('click',()=>c.refresh({useLatest:true}));
    useReference.addEventListener('click',()=>c.useReference());
    setInterval(()=>{if(!document.hidden)c.refresh();},30000);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)c.refresh();});
    return c;
  }
  return {controller,mount,cryptoReference,directCrypto};
});
