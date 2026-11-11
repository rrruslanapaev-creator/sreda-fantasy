const test=require('node:test');
const assert=require('node:assert/strict');
const {validPrice}=require('../api/market');
test('accepts positive player prices with 0.1 precision',()=>{
 assert.equal(validPrice(0.1),0.1);
 assert.equal(validPrice(5.5),5.5);
 assert.equal(validPrice(50),50);
});
test('rejects invalid player prices',()=>{
 for(const price of [0,-1,50.1,1.25,'NaN',null,undefined,100])
  assert.throws(()=>validPrice(price));
});
