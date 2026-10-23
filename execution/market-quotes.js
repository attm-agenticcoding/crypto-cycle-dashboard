/* Read-only quotes. Background refresh never changes an established plan input. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ExecutionQuotes=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const endpoint='https://execution-market-quotes.attmgromov.chatgpt.site/api/quote';
  function controller({fetchQuote,render,apply}) {
    let instrument='',generation=0,edit=0,filled=false,latest=null,reference=null;
    async function refresh({useLatest=false}={}) {
      const mine=++generation,version=edit,id=instrument;
      try {
        const payload=await fetchQuote(id);
        if(mine!==generation||id!==instrument)return;
        if(payload.instrumentId!==id)throw Error('Wrong instrument');
        latest=payload.latest;
        if(reference?.status!=="ready" || reference.date!==payload.reference?.date)reference=payload.reference;
        render({...payload,reference});
        if(edit===version&&(!filled||useLatest)&&latest&&Number.isFinite(latest.price)&&latest.price>0&&!latest.stale){filled=true;apply(latest.price);}
      } catch(error) {if(mine===generation){latest=null;reference=null;render({instrumentId:id,latest:null,reference:null,error:true});}}
    }
    return {
      select(id){instrument=id;edit++;filled=false;latest=null;reference=null;render({loading:true});return refresh();},
      edited(){edit++;filled=true;}, refresh,
      useReference(){if(reference?.status==='ready'&&reference.price>0){edit++;filled=true;apply(reference.price);}},
    };
  }
  function mount(){
    const input=document.getElementById('reference-price'),latestEl=document.getElementById('latest-quote'),referenceEl=document.getElementById('opening-reference'),useReference=document.getElementById('use-opening-reference');
    const money=(value,currency)=>`${Number(value).toLocaleString('en-US',{maximumFractionDigits:8})} ${currency}`;
    const stamp=value=>new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',month:'short',day:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',timeZoneName:'short'}).format(new Date(value));
    const c=controller({
      fetchQuote:async id=>{const r=await fetch(`${endpoint}?instrument=${encodeURIComponent(id)}`,{cache:'no-store',signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('Unavailable');return r.json();},
      render(p){
        const q=p.latest,r=p.reference;
        latestEl.textContent=p.loading?'Loading latest market price…':q?`Latest trade: ${money(q.price,p.currency)} · Last trade time: ${stamp(q.time)} · ${q.source}${q.marketStatus?` · ${q.marketStatus}`:''}${q.stale?' · Older than 5 minutes; enter or confirm a price manually.':''}${!q.realtime?' · Not marked real-time by source.':''}`:'Latest price unavailable. Enter a reference manually or retry.';
        referenceEl.textContent=p.loading?'09:35 ET minute close: loading…':r?`${r.date} · 09:35 ET minute close: ${r.status==='ready'?`${money(r.price,p.currency)} · ${r.source} · fixed for today`:r.status==='pending'?'Pending — available after 09:36 ET':r.status==='no-session'?'No trading session today':'Unavailable — no substitute price used'}`:'09:35 ET minute close: unavailable';
        useReference.disabled=r?.status!=='ready';
      },
      apply(price){const hadResults=!document.getElementById('result-stack').hidden;input.value=price;input.dispatchEvent(new Event('input',{bubbles:true}));if(hadResults)document.getElementById('calculator-form').requestSubmit();}
    });
    input.addEventListener('input',()=>c.edited());
    document.getElementById('use-latest-price').addEventListener('click',()=>c.refresh({useLatest:true}));
    useReference.addEventListener('click',()=>c.useReference());
    setInterval(()=>{if(!document.hidden)c.refresh();},30000);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)c.refresh();});
    return c;
  }
  return {controller,mount};
});
