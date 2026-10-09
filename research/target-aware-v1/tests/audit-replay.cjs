'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {createRequire} = require('node:module');
const replay = require('../replay.cjs');
const spec = require('../spec.json');

test('audit: changing only a future synthetic path suffix leaves every earlier decision identical', () => {
  const sourcePath = require.resolve('../replay.cjs');
  const source = fs.readFileSync(sourcePath, 'utf8');
  const marker = 'return {bars,history,terminal:price};';
  assert.equal(source.split(marker).length, 2, 'audit injection marker must remain unique');
  const altered = source.replace(marker, `
    for (const b of bars) if (b.index >= 12) {
      for (const key of ['open','close','low','high']) b[key] *= 1.4;
    }
    price *= 1.4;
    return {bars,history,terminal:price};
  `);
  const mod = {exports: {}};
  const wrapper = vm.runInThisContext(`(function(require, module, exports, __dirname) {${altered}\n})`, {filename:sourcePath+'.audit-perturbed'});
  wrapper(createRequire(sourcePath), mod, mod.exports, path.dirname(sourcePath));
  for (const side of ['buy','sell']) for (const mode of ['deadline','no_deadline']) for (const policy of spec.policies) {
    const args = {seed:7,family:'volatile',side,mode,policy,scenario:spec.scenarios[1],trace:true};
    const original = replay.simulate(args), changed = mod.exports.simulate(args);
    assert.deepEqual(original.traces.slice(0,12),changed.traces.slice(0,12),`${side}/${mode}/${policy}`);
    assert.notEqual(original.terminal,changed.terminal);
  }
});
