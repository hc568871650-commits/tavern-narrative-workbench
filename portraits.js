// Presentation assets only. No plot, inventory or relationship state is stored here.
export const PORTRAIT_KEY = 'narrativeWorkbenchPeopleV1';
export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
export const MAX_PACK_BYTES = 15 * 1024 * 1024;
const MIME_FORMATS = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const fail = message => { throw new Error(message); };
const text = (value, label, max, empty = false) => typeof value === 'string' && value.length <= max && (empty || value.length > 0)
    ? value : fail(`${label}须为${empty ? ' 0' : ' 1'}–${max} 字符`);

export function emptyLibrary() { return { version: 1, profiles: [] }; }

export function validateImageBytes(bytes, mime) {
    if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.byteLength > MAX_IMAGE_BYTES) fail('图片须为 1 字节至 3 MiB');
    if (!Object.hasOwn(MIME_FORMATS, mime)) fail('图片仅支持 PNG、JPEG、WebP');
    const png = bytes.length >= 24 && [137,80,78,71,13,10,26,10].every((v, i) => bytes[i] === v)
        && String.fromCharCode(...bytes.subarray(12, 16)) === 'IHDR';
    const jpeg = bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    const webp = bytes.length >= 16 && String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF'
        && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP'
        && ['VP8 ', 'VP8L', 'VP8X'].includes(String.fromCharCode(...bytes.subarray(12, 16)));
    if (!({ 'image/png': png, 'image/jpeg': jpeg, 'image/webp': webp })[mime]) fail('图片内容与 PNG/JPEG/WebP 类型不符');
    return MIME_FORMATS[mime];
}

export function bytesToDataURL(bytes, mime) {
    validateImageBytes(bytes, mime);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 16384) binary += String.fromCharCode(...bytes.subarray(i, i + 16384));
    return `data:${mime};base64,${btoa(binary)}`;
}

export function decodePortraitDataURL(value) {
    if (typeof value !== 'string' || value.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 40) fail('图片超过 3 MiB');
    const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
    if (!match || match[2].length % 4 !== 0) fail('图片 data URL 无效，仅支持 PNG、JPEG、WebP');
    let binary;
    try { binary = atob(match[2]); } catch { fail('图片 base64 数据无效'); }
    // Require canonical base64 rather than accepting trailing bits or ambiguous encodings.
    if (btoa(binary) !== match[2]) fail('图片 base64 编码不规范');
    const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
    const format = validateImageBytes(bytes, match[1]);
    return { bytes, mime: match[1], format, base64: match[2] };
}

export function validatePortraitSource(value, { embedded = true } = {}) {
    if (value === '') return '';
    if (typeof value !== 'string') fail('人物图片地址须为文本');
    if (value.startsWith('data:')) {
        if (!embedded) fail('保存的人物图片须先上传到酒馆');
        decodePortraitDataURL(value); return value;
    }
    if (value.length > 1200 || !value.startsWith('/user/images/') || /[\\?#\x00-\x20\x7f]/.test(value)) fail('图片只能引用酒馆 /user/images/ 下的本地图片');
    let decoded;
    try { decoded = decodeURIComponent(value); } catch { fail('图片路径编码无效'); }
    // Reject repeated encoding as well as encoded delimiters and traversal segments.
    if (/%|[\\?#\x00-\x20\x7f]/.test(decoded) || decoded.split('/').some(s => s === '.' || s === '..')
        || /%2f|%5c/i.test(value) || decoded.includes('//') || !decoded.startsWith('/user/images/')
        || !/\.(png|jpe?g|webp)$/i.test(decoded)) fail('图片路径包含不支持的字符、层级或格式');
    return value;
}

export function validateLibrary(value, { embedded = true } = {}) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== 1 || !Array.isArray(value.profiles)) fail('人物图片配置须为 version:1、profiles 数组');
    if (value.profiles.length > 100) fail('人物图片最多 100 项');
    const seen = new Set();
    const profiles = value.profiles.map(profile => {
        if (!profile || typeof profile !== 'object' || Array.isArray(profile)) fail('人物图片条目无效');
        const id = text(profile.id, '人物 ID', 1000);
        let parts;
        try { parts = JSON.parse(id); } catch { fail('人物 ID 须为实体与主键组成的 JSON 数组'); }
        if (!Array.isArray(parts) || parts.length !== 2 || parts.some(v => typeof v !== 'string' || !v || v.length > 400)
            || JSON.stringify(parts) !== id) fail('人物 ID 须为规范的 [实体 ID, 主键]');
        if (seen.has(id)) fail('人物 ID 重复'); seen.add(id);
        const fit = profile.fit ?? 'cover';
        if (!['cover', 'contain'].includes(fit)) fail('图片适配方式须为 cover 或 contain');
        const position = profile.position ?? { x: 50, y: 30 };
        if (!position || typeof position !== 'object' || ['x', 'y'].some(k => !Number.isFinite(position[k]) || position[k] < 0 || position[k] > 100)) fail('图片位置须为 0–100 的数值');
        return { id, name: text(profile.name, '人物名称', 200), portrait: validatePortraitSource(profile.portrait ?? '', { embedded }),
            fit, position: { x: position.x, y: position.y }, note: text(profile.note ?? '', '公开简介', 1000, true) };
    });
    const result = { version: 1, profiles };
    if (new TextEncoder().encode(JSON.stringify(result)).byteLength > MAX_PACK_BYTES) fail('人物图片包超过 15 MiB');
    return result;
}

export function getProfile(library, itemId) { return validateLibrary(library).profiles.find(p => p.id === itemId) ?? null; }
export function upsertProfile(library, profile) {
    const next = validateLibrary(library); const at = next.profiles.findIndex(p => p.id === profile.id);
    if (at < 0) next.profiles.push(profile); else next.profiles[at] = profile;
    return validateLibrary(next);
}
export function removeProfile(library, id) { const next = validateLibrary(library); next.profiles = next.profiles.filter(p => p.id !== id); return next; }

async function readImageResponse(response) {
    if (!response?.ok) fail(`图片导出失败：HTTP ${response?.status ?? 'unknown'}`);
    if (response.redirected) fail('图片地址发生重定向，停止导出');
    const mime = (response.headers?.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (!Object.hasOwn(MIME_FORMATS, mime)) fail('图片导出返回了不支持的格式');
    const declaredSize = Number(response.headers?.get('content-length') || 0);
    if (declaredSize > MAX_IMAGE_BYTES) fail('图片超过 3 MiB');
    let bytes;
    if (response.body?.getReader) {
        const reader = response.body.getReader(), chunks = []; let size = 0;
        try {
            for (;;) {
                const result = await reader.read(); if (result.done) break;
                size += result.value.byteLength;
                if (size > MAX_IMAGE_BYTES) { await reader.cancel(); fail('图片超过 3 MiB'); }
                chunks.push(result.value);
            }
        } finally { reader.releaseLock(); }
        bytes = new Uint8Array(size); let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    } else bytes = new Uint8Array(await response.arrayBuffer());
    return bytesToDataURL(bytes, mime);
}

export async function makePortableLibrary(library, fetcher = globalThis.fetch) {
    const next = validateLibrary(library), loaded = new Map();
    for (const profile of next.profiles) {
        if (!profile.portrait || profile.portrait.startsWith('data:')) continue;
        const source = validatePortraitSource(profile.portrait, { embedded: false });
        if (!loaded.has(source)) {
            const response = await fetcher(source, { credentials: 'same-origin', cache: 'no-store', redirect: 'error' });
            loaded.set(source, await readImageResponse(response));
        }
        profile.portrait = loaded.get(source);
        // Bound the accumulated pack as each image arrives, not only at the end.
        validateLibrary(next);
    }
    return validateLibrary(next);
}
