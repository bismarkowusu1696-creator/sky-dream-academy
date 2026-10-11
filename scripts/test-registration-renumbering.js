'use strict';
const assert = require('node:assert/strict');
const {
  planCompaction,applyCompaction,matchesRegistration,nextFreeRegistration
} = require('../functions/registration-number-compaction');
const student=(id,sequence,extras={})=>({
  id, course:'cosmetology', intakeStart:'2026-10-03',
  regNumber:'SDCO'+String(sequence).padStart(3,'0')+'/10/2026',
  status:'Registered', feePaid:0,payments:[],mobile:'024000000'+sequence,...extras
});
function run(){
  const initial=[student('a',1),student('b',2),student('c',3),
    student('otherIntake',1,{intakeStart:'2026-09-26',regNumber:'SDCO001/09/2026'}),
    student('otherCourse',1,{course:'accounting',regNumber:'SDAC001/10/2026'})];
  const plan=planCompaction(initial,'a');
  assert.equal(plan.reason,'');
  assert.deepEqual(plan.changes.map(c=>({id:c.id,from:c.from,to:c.to})),[
    {id:'b',from:'SDCO002/10/2026',to:'SDCO001/10/2026'},
    {id:'c',from:'SDCO003/10/2026',to:'SDCO002/10/2026'}
  ]);
  const survivors=structuredClone(initial.filter(s=>s.id!=='a'));
  applyCompaction(survivors,plan.changes);
  assert.equal(survivors.find(s=>s.id==='b').regNumber,'SDCO001/10/2026');
  assert.equal(survivors.find(s=>s.id==='c').regNumber,'SDCO002/10/2026');
  assert.equal(survivors.find(s=>s.id==='otherIntake').regNumber,'SDCO001/09/2026');
  assert.equal(survivors.find(s=>s.id==='otherCourse').regNumber,'SDAC001/10/2026');
  assert.equal(matchesRegistration(survivors[0],'SDCO002/10/2026'),true);
  assert.equal(matchesRegistration(survivors[1],'SDCO003/10/2026'),true);
  assert.equal(matchesRegistration(survivors[0],'SDCO003/10/2026'),false);
  assert.equal(planCompaction([student('a',1),student('b',2,{feePaid:50}),student('c',3)],'a').changes.length,0);
  assert.equal(planCompaction([student('a',1),student('b',2,{payments:[{amount:0}]}),student('c',3)],'a').changes.length,0);
  assert.equal(planCompaction([student('a',1,{feePaid:20}),student('b',2)],'a').changes.length,0);
  assert.equal(planCompaction([student('a',1),student('b',2,{status:'Active'}),student('c',3)],'a').changes.length,0);
  assert.equal(planCompaction([student('a',1),student('b',2),student('c',3)],'a',new Set(['c'])).changes.length,0);
  assert.equal(planCompaction([student('a',1),student('b',1)],'a').changes.length,0);
  assert.equal(planCompaction([student('a',1),student('b',2,{regNumber:'BAD'})],'a').changes.length,0);
  assert.equal(planCompaction([
    student('a',1),student('b',2),student('c',3),
    student('other',2,{intakeStart:'2026-10-20'})
  ],'a').changes.length,0,'Do not collide with another intake in the same month.');
  assert.equal(planCompaction([
    student('a',1),
    student('b',2,{mobile:'0242222222'}),
    student('c',3),
    student('other',8,{intakeStart:'2026-10-20',mobile:'+233 24 222 2222',
      previousRegNumbers:['SDCO002/10/2026']})
  ],'a').changes.length,0,'Do not break previous portal numbers using formatted Ghana phone numbers.');
  assert.equal(planCompaction([student('a',3),student('b',1),student('c',2)],'a').changes.length,0);
  assert.equal(nextFreeRegistration(survivors,student('a',1)),'SDCO003/10/2026');
  const number=nextFreeRegistration([student('a',1),student('b',2)],student('old',2));
  assert.equal(number,'SDCO003/10/2026');
  applyCompaction(survivors,[{id:'c',from:'SDCO002/10/2026',to:'SDCO004/10/2026'}]);
  assert.deepEqual(survivors.find(s=>s.id==='c').previousRegNumbers,[
    'SDCO003/10/2026','SDCO002/10/2026'
  ]);
  console.log('SkyDream safe registration renumbering: 18 scenarios passed.');
}
run();
