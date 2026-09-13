const fs = require('node:fs/promises');
const { setTimeout: delay } = require('node:timers/promises');
async function replaceFile(temp, target, check = async()=>{}, io = {rename:fs.rename,delay,platform:process.platform}) {
  for (let attempt=0;;attempt++) {
    await check();
    try { await io.rename(temp,target); return; }
    catch (error) {
      // Windows indexers and readers can briefly deny replacement after the writer has closed its handle.
      if (io.platform !== 'win32' || !['EPERM','EACCES','EBUSY'].includes(error.code) || attempt===5) throw error;
      await io.delay(20 * 2**attempt);
    }
  }
}
module.exports = { replaceFile };
