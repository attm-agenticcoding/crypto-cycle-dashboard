#!/usr/bin/env python3
"""Build auditable single-order monthly sessions from public minute archives."""
import argparse
import hashlib
import json
import math
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import prepare_execution_v2 as source
from execution_registry import load_registry
from update_execution_params import parse_zip, request_bytes

ROOT = Path(__file__).resolve().parents[1]
NY = ZoneInfo('America/New_York')
UTC = timezone.utc


def monthly_rows(bars, instrument, start, end):
    source.validate_research_contract(instrument)
    for bar in bars:
        if not all(isinstance(v, (int, float)) and math.isfinite(v) for v in (bar.low, bar.close, bar.high)) or not 0 < bar.low <= bar.close <= bar.high:
            raise ValueError('Invalid minute OHLC, including the reference minute')
    market = instrument['market_calendar']
    built = source.build_research_sessions(bars, market, start, end)
    # Each UTC spot reference has a NY month. Truncate only the last UTC
    # session of a NY month, so touches after midnight cannot use old slots.
    boundary = {}
    if market == '24X7':
        for b in bars:
            utc_day = b.opened_at.date()
            anchor_month = datetime.combine(utc_day, datetime.min.time(), UTC).astimezone(NY).strftime('%Y-%m')
            if b.opened_at.astimezone(NY).strftime('%Y-%m') == anchor_month and b.opened_at.hour * 60 + b.opened_at.minute > 0:
                values = boundary.setdefault(utc_day.isoformat(), [float('inf'), None, None])
                values[0] = min(values[0], b.low)
                if values[2] is None or b.opened_at > values[2]:
                    values[1], values[2] = b.close, b.opened_at
    for row in built['sessions']:
        day = date.fromisoformat(row['date'])
        review = datetime.combine(day, datetime.min.time(), UTC) if market == '24X7' else datetime(day.year, day.month, day.day, 9, 36, tzinfo=NY)
        row['review_month'] = review.astimezone(NY).strftime('%Y-%m')
        row['review_date_ny'] = review.astimezone(NY).date().isoformat()
        row['monthly_low'] = boundary[row['date']][0] if market == '24X7' else row['low']
        row['monthly_close_price'] = boundary[row['date']][1] if market == '24X7' else row['close_price']
    if market != '24X7' and built['sessions']:
        factor = instrument['default_reference_price'] / built['sessions'][0]['reference']
        for row in built['sessions']:
            for field in ('reference','low','high','pre_closeout_low','pre_closeout_high','closeout_reference','close_price','next_reference','monthly_low','monthly_close_price'):
                if row[field] is not None:
                    row[field] *= factor
        built['proxy_index_factor'] = factor
    built['instrument'] = instrument
    built['price_source'] = 'direct_spot' if market == '24X7' else 'indexed_spot_proxy_NOT_ETF_quotes'
    return built


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--protocol', type=Path, default=ROOT/'research/execution-monthly-protocol.json')
    p.add_argument('--output', type=Path, default=ROOT/'.research/monthly-sessions.json')
    p.add_argument('--cache', type=Path, default=ROOT/'.research/archives')
    a = p.parse_args()
    if not all(x.resolve().is_relative_to(ROOT/'.research') for x in (a.output,a.cache)):
        p.error('Raw archives and sessions must remain in ignored .research/')
    protocol_raw = a.protocol.read_bytes()
    protocol = json.loads(protocol_raw)
    start,end = date.fromisoformat(protocol['start']),date.fromisoformat(protocol['as_of'])
    raw_registry = (ROOT/'data/execution_instruments.json').read_bytes()
    instruments = [x for x in load_registry(ROOT/'data/execution_instruments.json')['instruments'] if x['enabled']]
    a.cache.mkdir(parents=True,exist_ok=True)
    result = dict(schema_version=2,protocol_sha256=hashlib.sha256(protocol_raw).hexdigest(),registry_sha256=hashlib.sha256(raw_registry).hexdigest(),archives=[],instruments=[],start=str(start),as_of=str(end))
    def fetch(spec):
        name,url=spec
        path=a.cache/name
        payload=path.read_bytes() if path.exists() else request_bytes(url,timeout=45)
        bars=parse_zip(payload)
        if not bars: raise ValueError('Empty archive: '+name)
        if not path.exists(): path.write_bytes(payload)
        return bars,dict(name=name,url=url,bytes=len(payload),sha256=hashlib.sha256(payload).hexdigest())
    for symbol in sorted({x['scaling_source']['symbol'] for x in instruments}):
        bars=[]
        with ThreadPoolExecutor(max_workers=2) as pool:
            for downloaded,manifest in pool.map(fetch,source.archive_specs(symbol,start,end)):
                bars.extend(b for b in downloaded if start <= b.opened_at.date() <= end)
                result['archives'].append(manifest)
                print('Read',manifest['name'],flush=True)
        bars.sort(key=lambda b:b.opened_at)
        for instrument in instruments:
            if instrument['scaling_source']['symbol']==symbol:
                built=monthly_rows(bars,instrument,start,end)
                result['instruments'].append(built)
                print(instrument['instrument_id'],built['quality'],flush=True)
    a.output.parent.mkdir(parents=True,exist_ok=True)
    a.output.write_text(json.dumps(result,separators=(',',':'))+'\n')
    print('Saved',a.output,flush=True)

if __name__=='__main__': main()
