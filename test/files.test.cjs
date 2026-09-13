const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { decode, encode, writeDocument } = require('../src/files.cjs');
for (const content of ['', 'hello\n世界 🌱\n', '\uFEFFhello\r\nworld\r\n']) {
  test(`round trip ${JSON.stringify(content)}`, () => {
    const bytes = Buffer.from(content);
    const doc = decode(bytes);
    assert.deepEqual(encode(doc.text, doc), bytes);
  });
}
test('reject unsupported input without silently damaging text', () => {
  for (const bytes of [Buffer.from([0xff]), Buffer.from('a\0b'), Buffer.from([0xff,0xfe,0x01])]) assert.throws(() => decode(bytes));
});
test('save detects external edits and leaves original bytes intact', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'openpad-test-'));
  try {
    const file = path.join(dir, 'test.txt');
    await fs.writeFile(file, 'original');
    const doc = decode(await fs.readFile(file));
    await fs.writeFile(file, 'external edit');
    await assert.rejects(writeDocument(file, 'my edit', doc, doc.hash), /changed on disk/);
    assert.equal(await fs.readFile(file, 'utf8'), 'external edit');
    assert.deepEqual(await fs.readdir(dir), ['test.txt']);
  } finally { await fs.rm(dir, { recursive: true }); }
});
test('save replaces an existing file and preserves BOM / CRLF', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'openpad-test-'));
  try {
    const file = path.join(dir, 'test.txt');
    await fs.writeFile(file, '\uFEFFold\r\n');
    const doc = decode(await fs.readFile(file));
    await writeDocument(file, 'new\n世界', doc, doc.hash);
    assert.deepEqual(await fs.readFile(file), Buffer.from('\uFEFFnew\r\n世界'));
    assert.deepEqual(await fs.readdir(dir), ['test.txt']);
  } finally { await fs.rm(dir, { recursive: true }); }
});
