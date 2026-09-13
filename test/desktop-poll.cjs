const assert=require('node:assert/strict');
async function pollDesktop(page,predicate,timeout=15000){
  const deadline=Date.now()+timeout;
  do{if(await page.evaluate(predicate))return;await new Promise(resolve=>setTimeout(resolve,25));}while(Date.now()<deadline);
  assert.fail('Desktop predicate did not become true within '+timeout+' ms.');
}
module.exports={pollDesktop};
