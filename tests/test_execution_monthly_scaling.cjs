'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {profile}=require('../execution/monthly-scaling.js');
const report=require('../data/execution_monthly_params.json');
test('monthly profiles match the exact instrument and user-set cap without changing live parameters',()=>{
  for(const id of Object.keys(report.instruments)) for(const limit of [1,4,5,12,31]) {
    const p=profile(report,id,limit);
    assert.equal(p.selected.monthly_limit,limit);
    assert.equal(p.selected.production_promoted,false);
    assert.equal(p.instrument.instrument_id,id);
  }
  for(const cap of [0,32,-1,NaN])assert.equal(profile(report,'ARCX:BTC',cap),null);
  assert.equal(profile(report,'UNKNOWN',5),null);
  assert.equal(profile({...report,policy_version:'old'},'ARCX:BTC',5),null);
});

test('malformed research cannot break the calculator render loop',()=>{
  for(const changed of [{candidate:null},{next_offset_pct:NaN},{oos:{nominal:{mean_completion:NaN}}}]) {
    const bad=structuredClone(report);
    Object.assign(bad.instruments['ARCX:BTC'].profiles['5'],changed);
    assert.equal(profile(bad,'ARCX:BTC',5),null);
  }
});
