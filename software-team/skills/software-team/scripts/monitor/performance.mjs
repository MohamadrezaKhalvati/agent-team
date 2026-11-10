// Reproducible lookup work comparison, independent of machine speed.
// Run: node software-team/skills/software-team/scripts/monitor/performance.mjs
import assert from 'node:assert/strict';
for (const size of [1000, 10000]) {
 const events=Array.from({length:size},(_,i)=>({type:'run.started',runId:`r${i}`}));
 const runs=new Map(events.map(e=>[e.runId,e]));
 let legacyVisits=0,indexLookups=0;
 for (const event of events) {
  const legacy=events.some(e=>{legacyVisits++;return e.runId===event.runId;});
  indexLookups++;
  assert.equal(runs.has(event.runId),legacy);
 }
 assert.equal(legacyVisits,size*(size+1)/2);
 assert.equal(indexLookups,size);
 console.log(JSON.stringify({runs:size,legacyVisits,indexLookups,replayVisits:size}));
}
