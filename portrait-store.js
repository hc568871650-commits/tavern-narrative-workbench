import { PORTRAIT_KEY, emptyLibrary, validateLibrary, validatePortraitSource, validateImageBytes,
    bytesToDataURL, decodePortraitDataURL, makePortableLibrary, MAX_IMAGE_BYTES } from './portraits.js';

const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function parseStored(character) {
    let data = character?.data;
    if (!data && character?.json_data) {
        try { data = JSON.parse(character.json_data)?.data; } catch { throw new Error('角色资料 JSON 损坏，停止修改人物图片'); }
    }
    const raw = data?.extensions?.[PORTRAIT_KEY];
    if (raw === undefined) return emptyLibrary();
    let value;
    try { value = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { throw new Error('人物图片配置 JSON 损坏，停止修改'); }
    return validateLibrary(value, { embedded: false });
}

/** Card-scoped assets: shared between chats of the same card, isolated from other cards. */
export function createPortraitStore(getContext, { fetcher = globalThis.fetch, randomUUID = () => globalThis.crypto.randomUUID() } = {}) {
    let saving = false;
    function capture() {
        const ctx = getContext(), character = ctx.characters?.[ctx.characterId];
        if (ctx.groupId || !character || typeof character.avatar !== 'string' || !character.avatar) throw new Error('请先打开单角色世界卡的聊天');
        if (typeof ctx.getRequestHeaders !== 'function') throw new Error('宿主请求接口不可用');
        return { character, avatar: character.avatar, chatId: ctx.chatId, characterId: ctx.characterId, headers: { ...ctx.getRequestHeaders() }, baseline: parseStored(character) };
    }
    function stillCurrent(owner) {
        const ctx = getContext();
        return !ctx.groupId && ctx.chatId === owner.chatId && ctx.characters?.[ctx.characterId] === owner.character && owner.character.avatar === owner.avatar;
    }
    function checkOwner(owner, committed = false) {
        if (stillCurrent(owner)) return;
        const error = new Error(committed ? `图片配置已写入原角色卡「${owner.avatar}」，但当前聊天已切换；请回原卡核对。` : '读取或上传期间角色卡/聊天已切换，未写入人物图片配置。');
        error.committed = committed; error.savedAvatar = committed ? owner.avatar : undefined; throw error;
    }
    async function request(owner, url, body) {
        const response = await fetcher(url, { method: 'POST', credentials: 'same-origin', cache: 'no-store',
            headers: { ...owner.headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (!response?.ok) throw new Error(`人物图片请求失败：HTTP ${response?.status ?? 'unknown'}`);
        return response;
    }
    async function readDisk(owner) {
        const response = await request(owner, '/api/characters/get', { avatar_url: owner.avatar });
        const character = await response.json();
        if (!character || character.error || !character.data || typeof character.data !== 'object'
            || (character.avatar && character.avatar !== owner.avatar)) throw new Error('宿主未返回目标角色卡，停止修改');
        return parseStored(character);
    }
    async function uploadBytes(owner, bytes, mime) {
        checkOwner(owner); const format = validateImageBytes(bytes, mime);
        const { base64 } = decodePortraitDataURL(bytesToDataURL(bytes, mime));
        const response = await request(owner, '/api/images/upload', { image: base64, format, filename: `nw-${randomUUID()}`, ch_name: 'narrative-workbench' });
        const result = await response.json(); checkOwner(owner);
        if (typeof result?.path !== 'string') throw new Error('酒馆未返回图片路径');
        // The native upload endpoint returns a user-relative URL without an initial slash.
        const url = result.path.startsWith('user/images/') ? `/${result.path}` : result.path;
        return validatePortraitSource(url, { embedded: false });
    }
    function syncCaptured(owner, library) {
        const value = JSON.stringify(library);
        let json;
        if (owner.character.json_data) {
            json = JSON.parse(owner.character.json_data); json.data ||= {}; json.data.extensions ||= {};
            json.data.extensions[PORTRAIT_KEY] = value;
        }
        owner.character.data ||= {}; owner.character.data.extensions ||= {};
        owner.character.data.extensions[PORTRAIT_KEY] = value;
        if (json) {
            owner.character.json_data = JSON.stringify(json);
            if (stillCurrent(owner)) {
                const editor = globalThis.document?.getElementById('character_json_data');
                if (editor) editor.value = owner.character.json_data;
            }
        }
    }
    return {
        scope() { return capture().avatar; },
        read() { return capture().baseline; },
        async upload(file) {
            const owner = capture();
            if (!file || typeof file.arrayBuffer !== 'function' || !Number.isFinite(file.size) || file.size < 1 || file.size > MAX_IMAGE_BYTES) throw new Error('请选择不超过 3 MiB 的 PNG、JPEG 或 WebP 图片');
            const bytes = new Uint8Array(await file.arrayBuffer()); checkOwner(owner);
            return uploadBytes(owner, bytes, file.type);
        },
        async save(library) {
            if (saving) throw new Error('人物图片正在保存，请等待完成');
            const owner = capture(), next = validateLibrary(library); saving = true; let committed = false;
            try {
                if (owner.character.json_data) {
                    try { JSON.parse(owner.character.json_data); } catch { throw new Error('角色资料 JSON 损坏，停止修改人物图片'); }
                }
                const diskBefore = await readDisk(owner); checkOwner(owner);
                if (!equal(diskBefore, owner.baseline)) throw new Error('磁盘人物图片配置已变化，请重新加载角色卡后再保存');
                const imported = new Map();
                for (const profile of next.profiles) if (profile.portrait.startsWith('data:')) {
                    const source = profile.portrait;
                    if (!imported.has(source)) {
                        const decoded = decodePortraitDataURL(source);
                        imported.set(source, await uploadBytes(owner, decoded.bytes, decoded.mime));
                    }
                    profile.portrait = imported.get(source); checkOwner(owner);
                }
                checkOwner(owner);
                if (!equal(parseStored(owner.character), owner.baseline)) throw new Error('人物图片配置在保存期间已变化，请重新加载后再试');
                const normalized = validateLibrary(next, { embedded: false });
                await request(owner, '/api/characters/merge-attributes', { avatar: owner.avatar, data: { extensions: { [PORTRAIT_KEY]: JSON.stringify(normalized) } } });
                committed = true;
                const persisted = await readDisk(owner);
                if (!equal(persisted, normalized)) throw new Error('图片配置已提交，但磁盘回读不一致，请回原角色卡核对');
                const current = parseStored(owner.character);
                if (!equal(current, owner.baseline) && !equal(current, persisted)) throw new Error('原角色卡的本地配置已变化，已提交的结果未覆盖本地编辑，请重新加载核对');
                syncCaptured(owner, persisted); checkOwner(owner, true);
                return persisted;
            } catch (error) {
                if (committed) { error.committed = true; error.savedAvatar = owner.avatar; }
                throw error;
            } finally { saving = false; }
        },
        async exportPortable() {
            const owner = capture(), disk = await readDisk(owner); checkOwner(owner);
            if (!equal(disk, owner.baseline)) throw new Error('磁盘人物图片配置已变化，请重新加载角色卡后再导出');
            const portable = await makePortableLibrary(owner.baseline, fetcher); checkOwner(owner);
            return portable;
        },
    };
}
