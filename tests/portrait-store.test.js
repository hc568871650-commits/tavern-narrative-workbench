import test from 'node:test';
import assert from 'node:assert/strict';
import { createPortraitStore } from '../portrait-store.js';
import { PORTRAIT_KEY, emptyLibrary, bytesToDataURL, MAX_IMAGE_BYTES } from '../portraits.js';

const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6mrkAAAAASUVORK5CYII=', 'base64'));
const profile = { id: '["people","zhou"]', name: '周宁', portrait: '/user/images/narrative-workbench/zhou.png', fit: 'cover', position: { x: 50, y: 30 }, note: '值夜班的人' };
const wanted = () => ({ version: 1, profiles: [structuredClone(profile)] });
const response = data => ({ ok: true, status: 200, json: async () => structuredClone(data) });
function deferred() { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; }
function fixture() {
    const characters = ['world-a.png', 'world-b.png'].map(avatar => ({ avatar, data: { extensions: { other: 'preserve' } }, json_data: JSON.stringify({ data: { extensions: { other: 'preserve' } } }) }));
    const state = { characterId: 0, groupId: null, chatId: 'first-chat', characters };
    const disks = new Map(characters.map(c => [c.avatar, structuredClone(c)])), calls = [];
    const getContext = () => ({ ...state, getRequestHeaders: () => ({ 'X-CSRF-Test': 'token' }) });
    const handler = async (url, options) => {
        const body = options.body ? JSON.parse(options.body) : null; calls.push({ url, options, body });
        assert.equal(options.credentials, 'same-origin');
        if (url.startsWith('/api/')) assert.equal(options.headers['X-CSRF-Test'], 'token');
        if (url === '/api/characters/get') return response(disks.get(body.avatar_url));
        if (url === '/api/characters/merge-attributes') {
            disks.get(body.avatar).data.extensions[PORTRAIT_KEY] = body.data.extensions[PORTRAIT_KEY];
            return response({});
        }
        if (url === '/api/images/upload') return response({ path: `user/images/narrative-workbench/${body.filename}.${body.format}` });
        if (url.startsWith('/user/images/')) return new Response(png, { headers: { 'Content-Type': 'image/png' } });
        throw new Error(`Unexpected endpoint ${url}`);
    };
    const create = (fetcher = handler) => createPortraitStore(getContext, { fetcher, randomUUID: () => 'fixture-uuid' });
    return { state, disks, calls, getContext, handler, create };
}

test('保存为角色卡JSON字符串并回读，多个聊天复用，另一世界卡保持隔离', async () => {
    const f = fixture(), store = f.create(); assert.deepEqual(store.read(), emptyLibrary());
    assert.equal(store.scope(), 'world-a.png');
    const result = await store.save(wanted());
    assert.deepEqual(result, wanted()); assert.deepEqual(store.read(), wanted());
    assert.deepEqual(f.calls.map(c => c.url), ['/api/characters/get', '/api/characters/merge-attributes', '/api/characters/get']);
    assert.equal(typeof f.calls[1].body.data.extensions[PORTRAIT_KEY], 'string');
    assert.equal(f.state.characters[0].data.extensions.other, 'preserve');
    assert.equal(JSON.parse(f.state.characters[0].json_data).data.extensions.other, 'preserve');
    f.state.chatId = 'second-chat'; assert.deepEqual(store.read(), wanted());
    f.state.characterId = 1; assert.deepEqual(store.read(), emptyLibrary());
    assert.equal(f.state.characters[1].data.extensions[PORTRAIT_KEY], undefined);
});

test('被删除的profile从磁盘完全消失，不因对象深合并残留', async () => {
    const f = fixture(), store = f.create(); await store.save(wanted()); await store.save(emptyLibrary());
    assert.deepEqual(JSON.parse(f.disks.get('world-a.png').data.extensions[PORTRAIT_KEY]), emptyLibrary());
});

test('损坏的初始库不会被自动当空库覆盖', async () => {
    for (const raw of ['{broken', null, { version: 7, profiles: [] }, JSON.stringify({ version: 1, profiles: [{ ...profile, portrait: 'https://evil/x.png' }] })]) {
        const f = fixture(); f.state.characters[0].data.extensions[PORTRAIT_KEY] = raw; const store = f.create();
        assert.throws(() => store.read()); await assert.rejects(store.save(emptyLibrary())); assert.equal(f.calls.length, 0);
    }
});

test('HTTP保存失败不污染当前卡内存；服务端回读失败不伪装保存成功', async () => {
    const f = fixture(), before = structuredClone(f.state);
    const store = f.create(async (url, options) => url.endsWith('/merge-attributes') ? { ok: false, status: 503 } : f.handler(url, options));
    await assert.rejects(store.save(wanted()), /503/); assert.deepEqual(f.state, before);
    const g = fixture(); let reads = 0;
    const missing = g.create(async (url, options) => url.endsWith('/get') && ++reads === 2 ? { ok: false, status: 502 } : g.handler(url, options));
    await assert.rejects(missing.save(wanted()), e => e.committed === true && e.savedAvatar === 'world-a.png');
    assert.equal(g.state.characters[0].data.extensions[PORTRAIT_KEY], undefined);
    assert.ok(g.disks.get('world-a.png').data.extensions[PORTRAIT_KEY]);
});

test('保存前发现磁盘已更新时拒绝覆盖', async () => {
    const f = fixture(); f.disks.get('world-a.png').data.extensions[PORTRAIT_KEY] = JSON.stringify(wanted());
    await assert.rejects(f.create().save(emptyLibrary()), /磁盘.*已变化/);
    assert.equal(f.calls.filter(c => c.url.endsWith('/merge-attributes')).length, 0);
});

for (const kind of ['character', 'chat']) test(`保存前读取期间切换${kind}拒绝提交`, async () => {
    const f = fixture(), wait = deferred(), started = deferred();
    const store = f.create(async (url, options) => { const result = await f.handler(url, options); if (url.endsWith('/get')) { started.resolve(); await wait.promise; } return result; });
    const save = store.save(wanted()); await started.promise;
    if (kind === 'character') f.state.characterId = 1; else f.state.chatId = 'other-chat';
    wait.resolve(); await assert.rejects(save, e => e.committed === false && /未写入/.test(e.message));
    assert.equal(f.calls.length, 1); assert.equal(f.disks.get('world-a.png').data.extensions[PORTRAIT_KEY], undefined);
});

test('提交后切卡仍回读原卡并明确已写入，不污染新卡', async () => {
    const f = fixture(), wait = deferred(), started = deferred();
    const store = f.create(async (url, options) => {
        const result = await f.handler(url, options);
        if (url.endsWith('/merge-attributes')) { started.resolve(); await wait.promise; }
        return result;
    });
    const save = store.save(wanted()); await started.promise; f.state.characterId = 1; wait.resolve();
    await assert.rejects(save, e => e.committed === true && e.savedAvatar === 'world-a.png' && /原角色卡/.test(e.message));
    assert.deepEqual(store.read(), emptyLibrary()); assert.deepEqual(JSON.parse(f.state.characters[0].data.extensions[PORTRAIT_KEY]), wanted());
    assert.equal(f.calls.at(-1).body.avatar_url, 'world-a.png');
});

test('回读内容不一致时不更新内存，标注可能已提交', async () => {
    const f = fixture(), initial = structuredClone(f.state); let reads = 0;
    const store = f.create(async (url, options) => url.endsWith('/get') && ++reads === 2 ? response({ avatar: 'world-a.png', data: { extensions: {} } }) : f.handler(url, options));
    await assert.rejects(store.save(wanted()), e => e.committed === true && /回读不一致/.test(e.message));
    assert.deepEqual(f.state, initial);
});

test('导入内嵌图先上传，去重后只把本地路径写进角色卡', async () => {
    const f = fixture(), pack = wanted(); pack.profiles[0].portrait = bytesToDataURL(png, 'image/png');
    pack.profiles.push({ ...pack.profiles[0], id: '["people","chen"]', name: '陈岚' });
    const original = structuredClone(pack), result = await f.create().save(pack);
    assert.deepEqual(pack, original);
    assert.equal(f.calls.filter(c => c.url === '/api/images/upload').length, 1);
    assert.ok(result.profiles.every(p => p.portrait === '/user/images/narrative-workbench/nw-fixture-uuid.png'));
    const commit = f.calls.find(c => c.url.endsWith('/merge-attributes'));
    assert.ok(!commit.options.body.includes('data:image'));
});

test('上传期间切卡会留下未绑定资源但不会提交或绑到新卡', async () => {
    const f = fixture(), pack = wanted(), wait = deferred(), started = deferred(); pack.profiles[0].portrait = bytesToDataURL(png, 'image/png');
    const store = f.create(async (url, options) => { const result = await f.handler(url, options); if (url.endsWith('/upload')) { started.resolve(); await wait.promise; } return result; });
    const pending = store.save(pack); await started.promise; f.state.characterId = 1; wait.resolve();
    await assert.rejects(pending, /未写入/); assert.equal(f.calls.filter(c => c.url.endsWith('/merge-attributes')).length, 0);
    assert.deepEqual(store.read(), emptyLibrary());
});

test('上传拒绝SVG、伪装PNG、超限文件和不安全服务端路径', async () => {
    const f = fixture(), store = f.create();
    await assert.rejects(store.upload(new Blob(['<svg/>'], { type: 'image/svg+xml' })), /PNG/);
    await assert.rejects(store.upload(new Blob(['<html/>'], { type: 'image/png' })), /内容/);
    await assert.rejects(store.upload({ size: MAX_IMAGE_BYTES + 1, arrayBuffer() { throw new Error('must not read'); } }), /3 MiB/);
    assert.equal(f.calls.length, 0);
    const unsafe = f.create(async () => response({ path: 'https://evil.test/portrait.png' }));
    await assert.rejects(unsafe.upload(new Blob([png], { type: 'image/png' })), /本地图片/);
});

test('导出从保存的库读取图片，导出过程不写入角色或数据库', async () => {
    const f = fixture(), store = f.create(); await store.save(wanted()); f.calls.length = 0;
    const portable = await store.exportPortable();
    assert.ok(portable.profiles[0].portrait.startsWith('data:image/png;base64,'));
    assert.deepEqual(f.calls.map(c => c.url), ['/api/characters/get', '/user/images/narrative-workbench/zhou.png']);
});

test('导出图片期间切卡丢弃结果，防止UI把上张卡资源当作当前卡', async () => {
    const f = fixture(); await f.create().save(wanted()); const wait = deferred(), started = deferred();
    const store = f.create(async (url, options) => { if (url.startsWith('/user/images/')) { started.resolve(); await wait.promise; } return f.handler(url, options); });
    const exporting = store.exportPortable(); await started.promise; f.state.characterId = 1; wait.resolve();
    await assert.rejects(exporting, /切换/);
});

test('同一store不允许两次保存交叉覆盖', async () => {
    const f = fixture(), wait = deferred(), started = deferred(); let reads = 0;
    const store = f.create(async (url, options) => { if (url.endsWith('/get') && ++reads === 1) { started.resolve(); await wait.promise; } return f.handler(url, options); });
    const first = store.save(wanted()); await started.promise;
    await assert.rejects(store.save(emptyLibrary()), /正在保存/); wait.resolve(); await first;
    assert.deepEqual(store.read(), wanted());
});
