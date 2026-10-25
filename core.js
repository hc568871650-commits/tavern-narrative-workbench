// Own integration code. No backend implementation is vendored here.
import { validateActionUI } from './actions.js';
export const KEY = 'narrativeWorkbenchV1';
const fail = message => { throw new Error(message); };
const text = (v, label) => typeof v === 'string' && v.length > 0 && v.length <= 200 ? v : fail(`${label}须为 1–200 字符`);
const unique = (items, label) => { if (new Set(items).size !== items.length) fail(`${label}重复`); };
export function validateConfig(value) {
    if (!value || value.version !== 1 || value.backend !== 'shujuku') fail('仅支持 version:1、backend:shujuku');
    text(value.id, '配置 id'); text(value.name, '名称');
    if (!Array.isArray(value.modules) || value.modules.length > 30) fail('modules 必须为数组（最多 30 项）');
    value.modules.forEach(m => { text(m.id, '模块 id'); text(m.label, '模块名称'); if (typeof m.enabled !== 'boolean') fail('enabled 必须为布尔值'); });
    unique(value.modules.map(m => m.id), '模块 id');
    if (!Array.isArray(value.entities) || !value.entities.length || value.entities.length > 30) fail('entities 须为 1–30 项');
    unique(value.entities.map(e => e.id), '实体 id');
    value.entities.forEach(e => {
        text(e.id, '实体 id'); text(e.label, '实体名称'); text(e.keyColumn, '主键列');
        if (!value.modules.some(m => m.id === e.module)) fail(`未知模块：${e.module}`);
        if (!e.sheet || !!e.sheet.key === !!e.sheet.name) fail('sheet 必须且只能指定 key 或 name');
        text(e.sheet.key || e.sheet.name, '表名/键');
        if (!Array.isArray(e.fields) || !e.fields.length || e.fields.length > 80) fail('fields 须为 1–80 项');
        unique(e.fields.map(f => f.id), '字段 id');
        e.fields.forEach(f => {
            text(f.id, '字段 id'); text(f.column, '列名'); text(f.label, '字段名称');
            if (!['text', 'number', 'boolean'].includes(f.type)) fail('type 仅支持 text/number/boolean');
            for (const k of ['min', 'max']) if (f[k] !== undefined && (typeof f[k] !== 'number' || !Number.isFinite(f[k]))) fail(`${k} 须为有限数值`);
            if (f.min !== undefined && f.max !== undefined && f.min > f.max) fail('min 不得大于 max');
            if (f.enum !== undefined && (!Array.isArray(f.enum) || f.enum.length > 100 || f.enum.some(v => !['string', 'number', 'boolean'].includes(typeof v)))) fail('enum 须为标量数组');
            if (f.unit !== undefined && typeof f.unit !== 'string') fail('unit 须为文本');
            if (f.group !== undefined && typeof f.group !== 'string') fail('group 须为文本');
            if (f.required !== undefined && typeof f.required !== 'boolean') fail('required 须为布尔值');
        });
    });
    // Config is declarative only: never eval/import script content.
    validateActionUI(value);
    return structuredClone(value);
}
export function parseConfig(raw) {
    if (raw.length > 200000) fail('配置超过 200 KB');
    return validateConfig(JSON.parse(raw));
}
export function canonical(value) {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
    return JSON.stringify(value);
}
// seedRows are initialization hints reattached by the backend's template projection,
// not the committed content rows. Exclude only this documented runtime decoration.
export function committedState(value) {
    const copy = structuredClone(value);
    for (const [key, sheet] of Object.entries(copy || {})) if (key.startsWith('sheet_') && sheet) delete sheet.seedRows;
    return canonical(copy);
}
export function project(data, config) {
    const cells = [], issues = [], groups = [];
    for (const entity of config.entities) {
        if (!config.modules.find(m => m.id === entity.module)?.enabled) continue;
        const matches = Object.entries(data || {}).filter(([k, v]) => k.startsWith('sheet_') && (entity.sheet.key ? k === entity.sheet.key : v?.name === entity.sheet.name));
        if (matches.length !== 1) { issues.push(`${entity.label}：表匹配 ${matches.length} 项，需要唯一匹配`); continue; }
        const [sheetKey, sheet] = matches[0];
        if (!Array.isArray(sheet.content) || !Array.isArray(sheet.content[0])) { issues.push(`${entity.label}：没有表头`); continue; }
        const [headers, ...rows] = sheet.content;
        if (new Set(headers).size !== headers.length) { issues.push(`${entity.label}：表头重复，拒绝猜测列`); continue; }
        const keyIndex = headers.indexOf(entity.keyColumn);
        if (keyIndex < 0) { issues.push(`${entity.label}：缺少主键列 ${entity.keyColumn}`); continue; }
        const keys = rows.map(row => String(row[keyIndex] ?? ''));
        if (keys.some(k => !k) || new Set(keys).size !== keys.length) { issues.push(`${entity.label}：主键为空或重复，不能可靠计算差异`); continue; }
        const group = { entityId: entity.id, label: entity.label, rows: [] }; groups.push(group);
        rows.forEach((row, i) => {
            const out = { key: keys[i], fields: [] }; group.rows.push(out);
            for (const field of entity.fields) {
                const ci = headers.indexOf(field.column);
                const raw = ci < 0 ? undefined : row[ci];
                const missing = raw === undefined || raw === null || raw === '';
                let value = raw, error = '';
                if (ci < 0) error = '映射列不存在';
                else if (missing && field.required) error = '必填值缺失';
                else if (!missing && field.type === 'number') {
                    if (!['string', 'number'].includes(typeof raw) || String(raw).trim() === '' || !Number.isFinite(Number(raw))) error = '不是有效数字';
                    else {
                        value = Number(raw);
                        if (field.min !== undefined && value < field.min) error = `低于下限 ${field.min}`;
                        if (field.max !== undefined && value > field.max) error = `高于上限 ${field.max}`;
                    }
                } else if (!missing && field.type === 'boolean') {
                    if (![true, false, 'true', 'false'].includes(raw)) error = '布尔值须为 true/false';
                    else value = raw === true || raw === 'true';
                }
                if (!missing && field.enum && !field.enum.includes(value)) error = '不在允许值列表';
                if (error) issues.push(`${entity.label}/${keys[i]}/${field.label}：${error}`);
                const cell = { id: JSON.stringify([entity.id, keys[i], field.id]), label: `${entity.label}/${keys[i]}/${field.label}`, value, missing, error, unit: field.unit || '', group: field.group || '', source: `${sheetKey}[${keys[i]}].${field.column}` };
                cells.push(cell); out.fields.push(cell);
            }
        });
    }
    return { cells, groups, issues };
}
export function changes(before, after) {
    if (before.issues?.length || after.issues?.length) return [];
    const old = new Map(before.cells.map(c => [c.id, c]));
    const next = new Map(after.cells.map(c => [c.id, c]));
    const result = [];
    for (const id of new Set([...old.keys(), ...next.keys()])) {
        const a = old.get(id), b = next.get(id);
        if (canonical(a?.value) !== canonical(b?.value) || Boolean(a) !== Boolean(b)) result.push({ id, label: (b || a).label, before: a?.value, after: b?.value, kind: !a ? '新增' : !b ? '移除' : '改变' });
    }
    return result;
}
export function assertSupportedTimeline(chat, end) {
    if (!Number.isSafeInteger(end) || end < 0 || end >= chat.length) fail('当前没有可读取的聊天楼层');
    if (chat.slice(0, end + 1).some(m => (m.swipes?.length || 0) > 1 || (m.swipe_id || 0) !== 0)) fail('检测到多 swipe：此底座未证明按回复版本隔离状态，已停止展示和分支。请从重生成之前的单版本楼层创建新聊天分支。');
}
export function contextToken(ctx) {
    return canonical([ctx.characterId, ctx.groupId, ctx.chatId, ctx.chat?.map(m => [m.mes, m.swipe_id, m.swipes, m.TavernDB_ACU_IsolatedData])]);
}
export async function readView(getContext, api, config, selected = null) {
    const ctx = getContext(), chat = ctx.chat;
    if (!ctx.chatId) fail('请先选择角色卡和聊天');
    const index = selected === null ? chat.length - 1 : selected;
    assertSupportedTimeline(chat, index);
    if (typeof api?.exportTableSnapshotsAtMessages !== 'function') fail('缺少已验证的数据库历史接口，请加载锁定版本 shujuku');
    const token = contextToken(ctx), indices = index > 0 ? [index - 1, index] : [index];
    const reply = await api.exportTableSnapshotsAtMessages(indices);
    if (contextToken(getContext()) !== token || getContext().chat !== chat) fail('读取期间聊天、正文或回复版本已变化；旧结果已丢弃');
    if (!reply?.success) fail(`历史读取失败：${reply?.code || 'unknown'} · ${reply?.error || '没有成功回执'}`);
    if (!Array.isArray(reply.snapshots) || indices.some(i => reply.snapshots.filter(s => s.messageIndex === i && s.data).length !== 1)) fail('历史接口未完整、唯一返回请求楼层，拒绝计算差异');
    const data = structuredClone(reply.snapshots.find(s => s.messageIndex === index)?.data);
    if (!data) fail('历史接口未返回所选楼层');
    const current = project(data, config);
    const previousData = index > 0 ? reply.snapshots.find(s => s.messageIndex === index - 1)?.data : null;
    const previous = previousData ? project(previousData, config) : { cells: [], issues: [] };
    const runtime = selected === null ? structuredClone(api.exportTableAsJson()) : null;
    return { index, token, data, current, changes: previous.issues.length || current.issues.length ? [] : changes(previous, current), baselineIssues: previous.issues,
        persisted: selected !== null || committedState(runtime) === committedState(data), initial: index === 0 };
}
