const MAX_TEXT = 32 * 1024 * 1024;
const MAX_MATCHES = 100000;
function expand(template, match, text) {
  return template.replace(/\$(\$|&|`|'|<[^>]*>|\d{1,2})/g, (token, key) => {
    if (key === '$') return '$';
    if (key === '&') return match[0];
    if (key === '`') return text.slice(0, match.index);
    if (key === "'") return text.slice(match.index + match[0].length);
    if (key.startsWith('<')) return match.groups ? match.groups[key.slice(1,-1)] || '' : token;
    const n = Number(key);
    if (n > 0 && n < match.length) return match[n] || '';
    const first = Number(key[0]);
    return key.length === 2 && first > 0 && first < match.length ? (match[first] || '') + key[1] : token;
  });
}
function replacements(text, options) {
  const { query, replacement = '', regex = false, caseSensitive = true, wholeWord = false, dotAll = false } = options;
  if (typeof text !== 'string' || text.length > MAX_TEXT) throw new Error('Buffer exceeds the 32 MiB preview limit.');
  if (typeof query !== 'string' || !query || typeof replacement !== 'string') throw new Error('Enter a find expression and replacement text.');
  const expression = new RegExp(regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), `gmu${caseSensitive ? '' : 'i'}${dotAll ? 's' : ''}`);
  const changes = [];
  let count = 0, size = text.length, match;
  const word = char => /[\p{L}\p{N}_]/u.test(char || '');
  while ((match = expression.exec(text))) {
    const from = match.index, to = from + match[0].length;
    const before = Array.from(text.slice(Math.max(0,from-2),from)).at(-1);
    const after = String.fromCodePoint(text.codePointAt(to) || 0);
    if (!wholeWord || (!word(before) && !word(after))) {
      if (++count > MAX_MATCHES) throw new Error('More than 100,000 matches. Narrow the search.');
      const insert = regex ? expand(replacement, match, text) : replacement;
      size += insert.length - (to-from);
      if (size > MAX_TEXT) throw new Error('Replacement exceeds the 32 MiB output limit.');
      if (insert !== match[0]) changes.push({from,to,insert});
    }
    if (!match[0].length) expression.lastIndex += text.codePointAt(expression.lastIndex) > 0xffff ? 2 : 1;
  }
  const pieces = []; let offset = 0;
  for (const change of changes) { pieces.push(text.slice(offset,change.from),change.insert); offset = change.to; }
  pieces.push(text.slice(offset));
  return { before:text, after:pieces.join(''), changes, count };
}
module.exports = { replacements, MAX_TEXT };
