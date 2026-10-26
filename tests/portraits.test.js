import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyLibrary, validateLibrary, validatePortraitSource, getProfile, upsertProfile, removeProfile,
    makePortableLibrary, bytesToDataURL, decodePortraitDataURL, MAX_IMAGE_BYTES, MAX_PACK_BYTES } from '../portraits.js';

const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6mrkAAAAASUVORK5CYII=', 'base64'));
const profile = (id = 'zhou') => ({ id: JSON.stringify(['people', id]), name: '周宁', portrait: '/user/images/narrative-workbench/zhou.webp', fit: 'cover', position: { x: 50, y: 30 }, note: '值夜班的人' });
const library = () => ({ version: 1, profiles: [profile()] });
const imageResponse = (bytes = png, type = 'image/png') => new Response(bytes, { headers: { 'Content-Type': type } });

test('人物以实体与主键绑定，重名不串图；修改与删除不改原库', () => {
    const original = library(), other = { ...profile('chen'), name: '周宁', portrait: '' };
    const added = upsertProfile(original, other);
    assert.equal(original.profiles.length, 1); assert.equal(added.profiles.length, 2);
    assert.equal(getProfile(added, other.id).portrait, '');
    const renamed = upsertProfile(added, { ...other, name: '陈岚' });
    assert.equal(renamed.profiles.length, 2); assert.equal(getProfile(renamed, other.id).name, '陈岚');
    assert.equal(removeProfile(renamed, other.id).profiles.length, 1); assert.equal(renamed.profiles.length, 2);
});

test('人物ID必须规范化，避免同一实体出现多个字符串身份', () => {
    assert.throws(() => validateLibrary({ version: 1, profiles: [{ id: ' ["people","zhou"]', name: '周宁' }] }), /规范/);
});

test('空图片配置支持只保存公开简介', () => {
    const result = validateLibrary({ version: 1, profiles: [{ id: '["people","zhou"]', name: '周宁', note: '公开简介' }] });
    assert.equal(result.profiles[0].portrait, ''); assert.equal(result.profiles[0].fit, 'cover');
    assert.deepEqual(result.profiles[0].position, { x: 50, y: 30 });
    assert.deepEqual(emptyLibrary(), { version: 1, profiles: [] });
});

for (const url of ['https://example.com/p.png', '//evil.test/x.png', 'javascript:alert(1)', 'data:image/svg+xml;base64,PHN2Zz4=',
    '/user/images/../other.png', '/user/images/%2e%2e/other.png', '/user/images/%252e%252e/other.png', '/user/images/a%2fb.png',
    '/user/images/a\\b.png', '/user/images/a%5cb.png', '/user/images/a.png?next=https://evil', '/user/images/a.svg',
    '/user/images/a.png#hash', '/user/images//a.png', '/user/images/a%00.png']) {
    test(`拒绝越界或可执行图片地址 ${url.slice(0, 55)}`, () => assert.throws(() => validatePortraitSource(url)));
}

test('不可信名称和简介作为文本保留，原型和未知字段不进入规范结果', () => {
    const malicious = JSON.parse('{"version":1,"profiles":[],"__proto__":{"polluted":true}}');
    malicious.profiles.push({ ...profile(), name: '<img src=x onerror=alert(1)>', note: '<script>alert(1)</script>', unexpected: 'discard' });
    const result = validateLibrary(malicious);
    assert.equal(result.profiles[0].name, malicious.profiles[0].name);
    assert.equal(result.profiles[0].unexpected, undefined); assert.equal({}.polluted, undefined);
});

test('重复ID、过多人物、无效定位和过长说明都拒绝', () => {
    for (const change of [
        x => x.profiles.push(profile()),
        x => x.profiles = Array.from({ length: 101 }, (_, i) => profile(String(i))),
        x => x.profiles[0].position.x = Infinity,
        x => x.profiles[0].position.y = -1,
        x => x.profiles[0].fit = 'fill',
        x => x.profiles[0].note = 'x'.repeat(1001),
        x => x.profiles[0].id = '["people",""]',
    ]) { const value = library(); change(value); assert.throws(() => validateLibrary(value)); }
});

test('嵌入图片验证MIME、文件头和编码，持久化库不接受dataURL', () => {
    const url = bytesToDataURL(png, 'image/png');
    assert.deepEqual(decodePortraitDataURL(url).bytes, png);
    assert.throws(() => decodePortraitDataURL(url.replace('image/png', 'image/jpeg')), /内容/);
    assert.throws(() => decodePortraitDataURL('data:image/png;base64,PHN2Zz4='), /内容/);
    assert.throws(() => validatePortraitSource(url, { embedded: false }), /先上传/);
    assert.throws(() => bytesToDataURL(new Uint8Array(MAX_IMAGE_BYTES + 1), 'image/png'), /3 MiB/);
});

test('总包按UTF8实际字节限制，不能通过多张合法大图绕过', () => {
    const bytes = new Uint8Array(MAX_IMAGE_BYTES); bytes.set(png);
    const url = bytesToDataURL(bytes, 'image/png');
    const pack = { version: 1, profiles: Array.from({ length: 4 }, (_, i) => ({ ...profile(String(i)), portrait: url })) };
    assert.ok(new TextEncoder().encode(JSON.stringify(pack)).byteLength > MAX_PACK_BYTES);
    assert.throws(() => validateLibrary(pack), /15 MiB/);
});

test('便携导出逐图读取本地资源，去重读取并内嵌，源配置不变', async () => {
    const initial = library(); initial.profiles.push(profile('chen')); const calls = [];
    const result = await makePortableLibrary(initial, async (url, options) => { calls.push(url); assert.equal(options.redirect, 'error'); return imageResponse(); });
    assert.equal(calls.length, 1); assert.ok(result.profiles.every(p => p.portrait.startsWith('data:image/png;base64,')));
    assert.equal(initial.profiles[0].portrait, '/user/images/narrative-workbench/zhou.webp');
});

test('缺失资源、重定向、HTML伪装和过大响应使整个导出失败，不产生缺图包', async () => {
    await assert.rejects(makePortableLibrary(library(), async () => new Response('missing', { status: 404 })), /404/);
    await assert.rejects(makePortableLibrary(library(), async () => ({ ok: true, redirected: true })), /重定向/);
    await assert.rejects(makePortableLibrary(library(), async () => imageResponse(png, 'text/html')), /格式/);
    await assert.rejects(makePortableLibrary(library(), async () => imageResponse(new TextEncoder().encode('<html>'), 'image/png')), /内容/);
    await assert.rejects(makePortableLibrary(library(), async () => new Response(png, { headers: { 'Content-Type': 'image/png', 'Content-Length': String(MAX_IMAGE_BYTES + 1) } })), /3 MiB/);
});
