"""Download only public Binance Vision archives; cache immutable originals."""
import concurrent.futures, hashlib, json, urllib.request
from pathlib import Path
ROOT=Path(__file__).resolve().parent
CACHE=ROOT/'cache'
CACHE.mkdir(exist_ok=True)
urls=[]
for y,m in [(2025,m) for m in range(10,13)]+[(2026,m) for m in range(1,10)]:
    urls.append(f'https://data.binance.vision/data/spot/monthly/klines/BTCUSDT/1m/BTCUSDT-1m-{y}-{m:02}.zip')
for d in range(1,20):
    urls.append(f'https://data.binance.vision/data/spot/daily/klines/BTCUSDT/1m/BTCUSDT-1m-2026-10-{d:02}.zip')
def get(url):
    p=CACHE/url.rsplit('/',1)[1]
    try:
        if not p.exists():
            with urllib.request.urlopen(url,timeout=60) as r: b=r.read()
            p.write_bytes(b)
        b=p.read_bytes()
        return dict(url=url,file=p.name,bytes=len(b),sha256=hashlib.sha256(b).hexdigest())
    except Exception as e:
        return dict(url=url,error=str(e))
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    results=[]
    for row in pool.map(get,urls):
        results.append(row); print(row,flush=True)
(ROOT/'input_manifest.json').write_text(json.dumps(results,indent=2)+'\n')
if any('error' in r for r in results): raise SystemExit('Incomplete archives')
