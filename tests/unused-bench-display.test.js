const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

// Exercise the frontend's actual badge function without a DOM or external services.
const source=fs.readFileSync(require('node:path').join(__dirname,'..','app.js'),'utf8');
const begin=source.indexOf('const scored=');
const end=source.indexOf('function myLastTourHtml(){');
if(begin<0||end<=begin)throw Error('Cannot locate frontend score display helpers');
const [scoreBadge,displayedPlayerPoints,unusedBench]=
 vm.runInNewContext(source.slice(begin,end)+';[scoreBadge,displayedPlayerPoints,unusedBench]');

test('An unused bench footballer displays RAW points and the not-counted label',()=>{
 const e={slot:'bench1',attended:true,counted:false,points:0,raw_points:17};
 assert.equal(displayedPlayerPoints(e),17);
 assert.equal(unusedBench(e),true);
 const badge=scoreBadge(e);
 assert.match(badge,/\+17/);
 assert.match(badge,/не вышел/);
 assert.match(badge,/не в зачёт/);
 assert.doesNotMatch(badge,/>\+0</);
});

test('A used bench substitute displays credited fantasy points, not an uncounted label',()=>{
 const e={slot:'bench1',attended:true,counted:true,substituted:true,points:11,raw_points:11,multiplier:1};
 const badge=scoreBadge(e);
 assert.equal(displayedPlayerPoints(e),11);
 assert.match(badge,/\+11/);
 assert.match(badge,/замена/);
 assert.doesNotMatch(badge,/не вышел/);
});

test('A captain keeps doubled credited points, an absent player remains at zero',()=>{
 const captain={slot:'starter',attended:true,counted:true,points:34,raw_points:17,multiplier:2};
 const absent={slot:'bench2',attended:false,counted:false,points:0,raw_points:0,multiplier:1};
 assert.match(scoreBadge(captain),/\+34/);
 assert.match(scoreBadge(captain),/×2/);
 assert.match(scoreBadge(absent),/>0<small>не играл/);
});

test('Unused bench can have negative individual points without impacting team total',()=>{
 const e={slot:'bench2',attended:true,counted:false,points:0,raw_points:-2};
 assert.equal(displayedPlayerPoints(e),-2);
 assert.match(scoreBadge(e),/>-2<small>не вышел/);
 assert.equal(e.points,0);
});
