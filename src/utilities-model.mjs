export function scalar(value){
  const text=String(value).trim().replace(/^U\+/i,'');
  if(!/^[0-9a-f]{1,6}$/i.test(text))throw new Error('Enter a hexadecimal Unicode code point, such as U+03B1.');
  const point=parseInt(text,16);if(point>0x10ffff||(point>=0xd800&&point<=0xdfff)||point===0)throw new Error('Choose a non-NUL Unicode scalar value.');return String.fromCodePoint(point);
}
export function characterInfo(text){return [...text].slice(0,256).map(character=>({character,code:`U+${character.codePointAt(0).toString(16).toUpperCase().padStart(4,'0')}`,units:character.length,bytes:[...new TextEncoder().encode(character)].map(byte=>byte.toString(16).padStart(2,'0')).join(' ')}));}
