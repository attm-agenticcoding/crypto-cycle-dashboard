'use strict';
// Include the isolated, synthetic-only prototype tests in existing regression CI.
// This adds no workflow, market-data fetch, publication step, or live-policy import.
for (const file of ['audit-invariants.cjs', 'audit-replay.cjs', 'kernel.test.cjs', 'replay.test.cjs'])
  require(`../research/target-aware-v1/tests/${file}`);
