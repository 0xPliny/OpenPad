function createMatcher({query,regex=false,caseSensitive=false,dotAll=false}){
  if(typeof query!=='string'||!query||query.length>32768)throw new Error('Enter a search expression up to 32,768 characters.');
  return new RegExp(regex?query:query.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),`gmu${caseSensitive?'':'i'}${dotAll?'s':''}`);
}
function scanMatches(text,options,limit,onMatch){
  const matcher=createMatcher(options),word=char=>/[\p{L}\p{N}_]/u.test(char||'');let match,count=0,line=1,lineStart=0,lineEnd=text.indexOf('\n');
  while(count<limit&&(match=matcher.exec(text))){
    const from=match.index,to=from+match[0].length;
    if(!options.wholeWord||(!word(Array.from(text.slice(Math.max(0,from-2),from)).at(-1))&&!word(String.fromCodePoint(text.codePointAt(to)||0)))){
      while(lineEnd>=0&&lineEnd<from){line++;lineStart=lineEnd+1;lineEnd=text.indexOf('\n',lineStart);}
      onMatch({from,to,line,column:from-lineStart+1,preview:text.slice(Math.max(lineStart,from-50),Math.min(lineEnd<0?text.length:lineEnd,from+250))});count++;
    }
    if(!match[0].length)matcher.lastIndex+=text.codePointAt(matcher.lastIndex)>0xffff?2:1;
  }
  return count;
}
module.exports={createMatcher,scanMatches};
