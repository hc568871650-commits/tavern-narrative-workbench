import { KEY, parseConfig, validateConfig, readView, canonical, contextToken } from './core.js';
import { verifyHostSave } from './host.js';
import { createDock } from './dock.js';

const context = () => window.SillyTavern.getContext();
const api = () => window.AutoCardUpdaterAPI;
const el = (tag, content, cls) => { const n = document.createElement(tag); if (content !== undefined) n.textContent = content; if (cls) n.className = cls; return n; };
const format = value => value === undefined || value === null ? '—' : String(value);
let panel, body, status, select, editor, notice, branchButton;
let epoch = 0, selected = null, view = null, bound = null, editScope = '', refreshTimer;
let initializingRetries = 0;
let dock;
const scope = () => canonical([context().characterId, context().groupId, context().chatId]);
function message(text) { notice.textContent = text; }
function invalidate(label = '状态待核对') { epoch++; view = null; body.replaceChildren(); branchButton.disabled = true; status.textContent = label; dock?.clear(); }
function schedule() { invalidate(); clearTimeout(refreshTimer); refreshTimer = setTimeout(refresh, 150); }
function config() { const value = context().chatMetadata?.[KEY]; return value ? validateConfig(value) : null; }
function download(name, value) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
    const link = el('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function setEditor(value) { editor.value = JSON.stringify(value, null, 2); editScope = scope(); }
async function sample(name) {
    const before = scope();
    const r = await fetch(new URL(`examples/${name}.json`, import.meta.url));
    if (!r.ok) throw new Error('样例配置加载失败');
    const value = validateConfig(await r.json());
    if (scope() !== before) throw new Error('聊天已变化，请重新载入样例');
    setEditor(value); message('样例已载入编辑区。检查表名和列名后，点“应用到本聊天”；不会写入业务表格。');
}
function run(fn) { return async () => { try { await fn(); } catch (e) { message(e.message || String(e)); } }; }
function button(label, fn, parent) { const b = el('button', label); b.type = 'button'; b.addEventListener('click', run(fn)); parent.append(b); return b; }
function renderView(v, cfg) {
    body.replaceChildren();
    const title = el('h3', `${cfg.name} · 第 ${v.index} 楼`); body.append(title);
    const modules = el('div', undefined, 'nw-modules');
    for (const m of cfg.modules) modules.append(el('span', `${m.label} · ${m.enabled ? '开启' : '隐藏'}`));
    body.append(modules);
    for (const group of v.current.groups) {
        body.append(el('h4', group.label));
        if (!group.rows.length) body.append(el('p', '表中暂无记录。'));
        for (const row of group.rows) {
            const card = el('section', undefined, 'nw-card'); card.append(el('strong', row.key));
            const dl = el('dl');
            for (const f of row.fields) {
                const label = f.label.split('/').at(-1);
                dl.append(el('dt', `${f.group ? `${f.group} · ` : ''}${label}`));
                const dd = el('dd', `${format(f.value)}${f.missing ? '' : f.unit}${f.error ? ` ⚠ ${f.error}` : ''}`);
                dd.title = `来源：${f.source}`; dl.append(dd);
            }
            card.append(dl); body.append(card);
        }
    }
    body.append(el('h4', v.initial ? '初始记录（不是本轮结算）' : '与前一楼状态的差异'));
    if (v.baselineIssues.length || v.current.issues.length) body.append(el('p', '映射或校验存在问题，已停止计算差异；修正后重新读取。', 'nw-warning'));
    else if (!v.changes.length) body.append(el('p', '所选字段无变化。仅说明表格未变，不能证明填表任务已经完成。'));
    for (const c of v.changes) body.append(el('p', `${c.kind} · ${c.label}：${format(c.before)} → ${format(c.after)}`, 'nw-change'));
    if (v.current.issues.length || v.baselineIssues.length) {
        body.append(el('h4', '规则与映射诊断（只检查，不改写底座）'));
        for (const issue of v.current.issues) body.append(el('p', issue, 'nw-warning'));
        for (const issue of v.baselineIssues) body.append(el('p', `前一楼：${issue}`, 'nw-warning'));
    }
}
async function refresh() {
    invalidate('正在读取底座的消息存储帧…'); const ticket = epoch;
    try {
        bindBackend();
        const ctx = context(), cfg = config();
        if (editScope !== scope()) { editScope = scope(); editor.value = cfg ? JSON.stringify(cfg, null, 2) : ''; }
        select.replaceChildren();
        const live = el('option', '当前状态'); live.value = ''; select.append(live);
        ctx.chat.forEach((m, i) => { const o = el('option', `第 ${i} 楼 · ${m.is_user ? '用户' : '角色'} · ${String(m.mes || '').slice(0, 26)}`); o.value = String(i); select.append(o); });
        if (selected !== null && selected >= ctx.chat.length) selected = null;
        select.value = selected === null ? '' : String(selected);
        if (!cfg) throw new Error('本聊天未配置。请在“卡片适配”中载入样例或导入配置。');
        const result = await readView(context, api(), cfg, selected);
        if (ticket !== epoch) return;
        view = result;
        status.textContent = result.persisted ? '已读取底座消息帧 · 磁盘保存由宿主负责' : '运行时与消息帧不同 · 下方显示已记录历史，未确认本轮完成';
        branchButton.disabled = !result.persisted || !!ctx.groupId;
        renderView(result, cfg);
        dock?.update(result,cfg,{historical:selected!==null});
    } catch (e) { if (ticket === epoch) {
        view = null; status.textContent = e.message;
        dock?.clear(e.message.includes('多 swipe')?'多回复 · 暂不可操作':'请在工作台配置或核对状态');
        if (e.message.includes('host_unavailable') && initializingRetries++ < 20) {
            status.textContent = '底座正在初始化，稍后自动重新读取…';
            clearTimeout(refreshTimer); refreshTimer = setTimeout(refresh, 500);
        }
    } }
}
function bindBackend() {
    const next = api(); if (!next || next === bound) return;
    if (bound?.unregisterTableUpdateCallback) bound.unregisterTableUpdateCallback(onUpdate);
    bound = next; bound.registerTableUpdateCallback?.(onUpdate);
    // No public unregister for fill-start; register once per API instance, with identity guard.
    bound.registerTableFillStartCallback?.(() => { if (bound === next) invalidate('底座开始填表 · 完成与保存尚未确认'); });
}
function onUpdate(_data, meta) {
    schedule();
    if (meta?.persisted === false) message('收到仅运行时更新：尚未写入消息存储帧，不计为已保存状态。');
}
async function applyConfig() {
    if (!context().chatId || !context().chat.length) throw new Error('请先打开含开场消息的聊天');
    if (editScope !== scope()) throw new Error('编辑期间聊天已切换，请重新载入配置');
    const value = parseConfig(editor.value), ctx = context(), owner = scope();
    ctx.chatMetadata[KEY] = value;
    await ctx.saveMetadata();
    if (scope() !== owner) throw new Error('保存期间聊天已切换，请回原聊天核查配置');
    await verifyHostSave(context);
    message('配置已应用，并已从宿主聊天文件回读核对。');
    await refresh();
}
async function initializeExample() {
    const cfg = config(), names = { 'academy-visitor-demo': 'academy', 'starship-resource-demo': 'starship', 'journey-ui-demo':'journey' };
    const name = cfg && names[cfg.id];
    if (!name) throw new Error('先载入并应用一套样例配置。自定义卡请使用数据库编辑器设置其表结构。');
    const ctx = context(), token = contextToken(ctx);
    const empty = () => ctx.chat.length === 1 && !ctx.chat[0].is_user
        && !ctx.chat.some(m => Object.values(m.TavernDB_ACU_IsolatedData || {}).some(s => s?.storageFrame))
        && !Object.values(api()?.exportTableAsJson() || {}).some(s => s?.content?.length > 1);
    if (!empty()) throw new Error('只允许在一条开场消息、无已存表格数据的新聊天初始化；已有存档请在数据库编辑器中管理。');
    if (typeof api()?.importTemplateFromData !== 'function') throw new Error('底座尚未就绪');
    if (!window.confirm('为本空白聊天建立所选样例的数据库表和初值？仅用于演示，不改全局模板，不调用模型。')) return;
    const response = await fetch(new URL(`examples/${name}.tables.json`, import.meta.url));
    if (!response.ok) throw new Error('样例表格文件读取失败');
    const tables = await response.json();
    if (contextToken(context()) !== token || !empty()) throw new Error('准备期间聊天或数据已变化，未执行初始化');
    const result = await api().importTemplateFromData(tables, { scope: 'chat', dataMode: 'replace', presetName: cfg.name });
    if (!result?.success || result.runtimeReady === false) throw new Error(result?.message || '底座未确认初始化成功');
    if (scope() !== canonical([ctx.characterId, ctx.groupId, ctx.chatId])) throw new Error('初始化期间聊天已切换，请回原聊天核对；不继续写入');
    // Template success alone can leave no formal full checkpoint on a new chat.
    // Commit the backend's normalized current data through its own persistence API.
    const initialData=structuredClone(api().exportTableAsJson());
    for(const [key,sheet] of Object.entries(initialData))if(key.startsWith('sheet_')){
        const supplied=Object.values(tables).filter(t=>t?.name===sheet.name && t?.content);
        if(supplied.length!==1)throw new Error('样例表结构匹配不唯一，未提交初值');
        sheet.content=structuredClone(supplied[0].content);delete sheet.seedRows;
    }
    if(await api().importTableAsJson(JSON.stringify(initialData))!==true)throw new Error('模板已建立，但初值持久化失败，请在数据库编辑器中检查后重试');
    await verifyHostSave(context);
    message('样例表结构和初值已交由数据库创建。可用数据库编辑器修改；规则诊断与历史只读。');
    await refresh();
}
async function branch() {
    if (!view || !view.persisted || context().groupId) throw new Error('当前不满足单角色聊天分支条件');
    if (contextToken(context()) !== view.token) throw new Error('状态已变化，请刷新后再创建分支');
    const cfg = config(), target = view.index, expected = canonical(view.data);
    if (!window.confirm(`从第 ${target} 楼创建并打开新分支？覆盖范围仅为聊天正文、消息中的数据库帧与本聊天适配配置。世界书、外部记忆和其他插件状态不在恢复范围。原聊天保留。`)) return;
    const module = await import('/scripts/bookmarks.js');
    if (contextToken(context()) !== view?.token) throw new Error('准备分支时状态已变化，请重试');
    await verifyHostSave(context);
    if (contextToken(context()) !== view?.token) throw new Error('保存核对期间状态已变化，请重新读取');
    const name = await module.branchChat(target);
    if (!name) throw new Error('宿主没有返回新分支名称');
    selected = null;
    const result = await readView(context, api(), cfg, target);
    if (canonical(result.data) !== expected) throw new Error('分支已创建，但表格校验不一致。请停留检查，不继续结算。');
    if (canonical(config()) !== canonical(cfg)) throw new Error('分支已创建，但适配配置未继承，请导入原配置。');
    await verifyHostSave(context);
    message(`已创建分支 ${name}；目标楼层表格回放一致。外部世界书/记忆未验证。`);
    await refresh();
}
function init() {
    if (document.getElementById('narrative-workbench')) return;
    panel = el('aside'); panel.id = 'narrative-workbench'; panel.hidden = true;
    const header = el('header'); header.append(el('strong', '叙事工作台'), el('small', 'v0.3.1 · 单一状态来源'));
    button('关闭', () => { panel.hidden = true; }, header); panel.append(header);
    status = el('p', '等待连接', 'nw-status'); panel.append(status);
    const controls = el('div', undefined, 'nw-controls');
    select = el('select'); select.id = 'nw-history'; select.setAttribute('aria-label', '查看楼层'); select.addEventListener('change', () => { selected = select.value === '' ? null : Number(select.value); refresh(); }); controls.append(select);
    button('刷新', refresh, controls);
    button('核对磁盘保存', async () => { const r = await verifyHostSave(context); message(`回读一致：${r.messageCount} 条正文/回复版本、数据库消息帧和适配配置。范围不含世界书或外部记忆。`); }, controls);
    button('数据库编辑器', async () => { if (!api()?.openVisualizer || await api().openVisualizer() === false) throw new Error('数据库编辑器尚未就绪'); }, controls);
    branchButton = button('从此楼创建分支', branch, controls); branchButton.id = 'nw-branch'; branchButton.disabled = true;
    panel.append(controls);
    notice = el('p', '状态写入者：shujuku。工作台只读业务状态；不自动调用模型或结算资源。', 'nw-notice'); panel.append(notice);
    body = el('main'); body.id = 'nw-state'; panel.append(body);
    const details = el('details'); details.id = 'nw-config'; details.append(el('summary', '卡片适配 · 显示、字段、模块与检查规则'));
    details.append(el('p', '按聊天保存。改名称、单位、分组、modules.enabled、字段映射及 min/max/enum/required 即可适配；规则仅诊断，强制约束仍由底座负责。'));
    const actions = el('div', undefined, 'nw-controls');
    button('学院样例', () => sample('academy'), actions); button('星际样例', () => sample('starship'), actions);
    button('操作栏样例',()=>sample('journey'),actions);
    button('导出现用配置', () => { const cfg = config(); if (!cfg) throw new Error('尚无现用配置'); download(`${cfg.id}.json`, cfg); }, actions);
    const file = el('input'); file.type = 'file'; file.accept = '.json,application/json'; file.id = 'nw-import'; file.setAttribute('aria-label', '导入适配配置');
    file.addEventListener('change', run(async () => { const owner = scope(); const f = file.files[0]; if (!f) return; if (f.size > 200000) throw new Error('配置超过 200 KB'); const cfg = parseConfig(await f.text()); if (owner !== scope()) throw new Error('读取文件时聊天已变化'); setEditor(cfg); message('导入成功，尚未应用。'); file.value = ''; }));
    actions.append(file); details.append(actions);
    editor = el('textarea'); editor.id = 'nw-editor'; editor.spellcheck = false; editor.setAttribute('aria-label', '适配配置 JSON'); details.append(editor);
    button('应用到本聊天', applyConfig, details);
    button('为空白聊天建立样例表', initializeExample, details);
    button('查看底座表名与列名', () => {
        const data = api()?.exportTableAsJson(); if (!data) throw new Error('底座未连接');
        const tables = Object.entries(data).filter(([k]) => k.startsWith('sheet_')).map(([key, s]) => ({ key, name: s.name, columns: s.content?.[0] }));
        message(JSON.stringify(tables, null, 2));
    }, details);
    panel.append(details); document.body.append(panel);
    const toggle = el('button', '叙事工作台'); toggle.id = 'nw-open'; toggle.type = 'button'; toggle.addEventListener('click', () => { panel.hidden = !panel.hidden; if (!panel.hidden) refresh(); }); document.body.append(toggle);
    dock=createDock({getContext:context,getApi:api,openWorkbench:()=>{panel.hidden=false;refresh();},refresh});
    const ctx = context();
    for (const name of ['CHAT_CHANGED', 'CHAT_LOADED', 'MESSAGE_SWIPED', 'MESSAGE_SWIPE_DELETED', 'MESSAGE_RECEIVED', 'MESSAGE_EDITED', 'MESSAGE_DELETED', 'MESSAGE_UPDATED', 'GENERATION_ENDED', 'GENERATION_STOPPED']) {
        if (ctx.eventTypes[name]) ctx.eventSource.on(ctx.eventTypes[name], () => { if (name === 'CHAT_CHANGED') { selected = null; message('已切换聊天，重新读取本聊天配置和状态。'); } schedule(); });
    }
    if (ctx.eventTypes.GENERATION_STARTED) ctx.eventSource.on(ctx.eventTypes.GENERATION_STARTED, () => {dock?.setBusy(true);invalidate('正文生成中 · 状态尚未确认');});
    for(const name of ['GENERATION_ENDED','GENERATION_STOPPED','CHAT_CHANGED'])if(ctx.eventTypes[name])ctx.eventSource.on(ctx.eventTypes[name],()=>dock?.setBusy(false));
    bindBackend();
    // Bounded API discovery; does not poll model or business state.
    let attempts = 0; const timer = setInterval(() => { bindBackend(); if (bound || ++attempts >= 60) clearInterval(timer); }, 1000);
    refresh();
}
if (window.SillyTavern?.getContext) init();
else console.error('[叙事工作台] SillyTavern context unavailable');
