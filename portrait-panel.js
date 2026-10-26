import { bytesToDataURL, getProfile, upsertProfile, validateLibrary, MAX_IMAGE_BYTES, MAX_PACK_BYTES } from './portraits.js';
import { createPortraitStore } from './portrait-store.js';

const make = (tag, text, cls) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (cls) node.className = cls;
    return node;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Author-facing, card-scoped presentation settings. No story or database state is edited. */
export function createPortraitPanel({ getContext, getPeople, onChanged = () => {} }) {
    const store = createPortraitStore(getContext);
    const dialog = make('dialog'); dialog.id = 'nw-portrait-manager'; dialog.setAttribute('aria-labelledby', 'nw-portrait-title');
    const header = make('header', undefined, 'npm-header');
    const titleBlock = make('div'); titleBlock.append(make('small', '世界卡 · 人物展示'), make('h2', '人物图片', 'npm-title'));
    titleBlock.lastChild.id = 'nw-portrait-title'; header.append(titleBlock);
    const closeButton = button('关闭', () => requestLeave(hide), header, 'npm-close');
    const description = make('p', '同一张世界卡的聊天共用图片和公开简介；人物状态仍以各自聊天为准。', 'npm-description');
    const status = make('p', '', 'npm-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const guard = make('div', undefined, 'npm-guard'); guard.hidden = true;
    const tools = make('div', undefined, 'npm-tools');
    const search = make('input'); search.type = 'search'; search.placeholder = '搜索人物'; search.setAttribute('aria-label', '搜索人物图片'); tools.append(search);
    const exportButton = button('导出含图资源包', exportPack, tools);
    const importButton = button('导入资源包', () => requestLeave(() => importInput.click()), tools);
    const importInput = make('input'); importInput.type = 'file'; importInput.accept = '.json,application/json'; importInput.hidden = true; importInput.setAttribute('aria-label', '导入人物图片资源包');
    tools.append(importInput);
    const body = make('div', undefined, 'npm-body');
    const roster = make('nav', undefined, 'npm-roster'); roster.setAttribute('aria-label', '人物图片列表');
    const editor = make('section', undefined, 'npm-editor'); editor.setAttribute('aria-label', '人物图片设置'); body.append(roster, editor);
    dialog.append(header, description, tools, status, guard, body); document.body.append(dialog);

    let library = null, people = [], selected = '', draft = null, cleanDraft = null;
    let owner = '', ownerAvatar = '', ownerName = '', opened = 0, busy = false, stale = false, opener = null, pendingImport = null;
    const controls = () => [...dialog.querySelectorAll('button,input,textarea,select')];
    const dirty = () => draft !== null && !same(draft, cleanDraft);
    function button(label, action, parent, cls) {
        const b = make('button', label, cls); b.type = 'button'; b.addEventListener('click', () => {
            try { Promise.resolve(action()).catch(error => { message(error.message || String(error), true); disable(busy); }); }
            catch (error) { message(error.message || String(error), true); disable(busy); }
        }); parent.append(b); return b;
    }
    function message(text, error = false) { status.textContent = text; status.dataset.error = String(error); }
    function currentScope() {
        const ctx = getContext();
        return JSON.stringify([store.scope(), ctx.chatId, ctx.characterId, ctx.groupId]);
    }
    function checkScope(ticket = opened) {
        if (!dialog.open || ticket !== opened || currentScope() !== owner) {
            stale = true;
            throw new Error('角色卡或聊天已切换。未保存的编辑不会写入新聊天；请关闭后重新打开人物图片。');
        }
    }
    function disable(value) {
        busy = value;
        for (const control of controls()) control.disabled = value || (stale && control !== closeButton) || control.dataset.locked === 'true';
        closeButton.disabled = value;
        if (!library) { exportButton.disabled = true; importButton.disabled = true; search.disabled = true; }
    }
    function hide() {
        if (busy) return;
        opened++; dialog.close(); guard.hidden = true; pendingImport = null; draft = null; cleanDraft = null;
        opener?.focus?.();
    }
    function requestLeave(action) {
        if (busy) { message('正在处理，请等待完成。'); return; }
        if (!dirty()) { guard.hidden = true; action(); return; }
        guard.replaceChildren(make('p', '当前人物有未保存的修改。'));
        button('继续编辑', () => { guard.hidden = true; }, guard);
        button('放弃修改并继续', () => { draft = cleanDraft ? structuredClone(cleanDraft) : null; guard.hidden = true; renderEditor(); action(); }, guard, 'npm-danger');
        guard.hidden = false; guard.scrollIntoView({ block: 'nearest' });
    }
    async function run(task, progress) {
        if (busy || stale) return;
        const ticket = opened;
        try {
            checkScope(ticket); disable(true); message(progress);
            await task(ticket);
        } catch (error) {
            if (error.committed) {
                stale = true;
                const target = error.savedAvatar || ownerAvatar;
                message(`${error.message || String(error)} · 配置已提交到原角色卡「${target}」，但本次回读或界面确认未完成。请重新加载该角色卡核对后再编辑。`, true);
            } else message(error.message || String(error), true);
        } finally { if (ticket === opened) disable(false); }
    }
    function refreshPeople() {
        const current = getPeople(); const visible = Array.isArray(current) ? current : [];
        const map = new Map(visible.filter(p => p && typeof p.id === 'string').map(p => [p.id, { id: p.id, name: String(p.name || ''), present: true }]));
        for (const profile of library?.profiles || []) if (!map.has(profile.id)) map.set(profile.id, { id: profile.id, name: profile.name, present: false });
        people = [...map.values()];
    }
    function renderRoster() {
        roster.replaceChildren();
        const query = search.value.trim().toLocaleLowerCase();
        const shown = people.filter(p => `${p.name} ${getProfile(library, p.id)?.note || ''}`.toLocaleLowerCase().includes(query));
        if (!shown.length) roster.append(make('p', people.length ? '没有匹配的人物。' : '当前聊天尚无人物资料。先应用人物表适配，或导入已准备的资源包。', 'npm-empty'));
        for (const person of shown) {
            const entry = button('', () => requestLeave(() => { select(person.id); editor.scrollIntoView({ block: 'start' }); }), roster, 'npm-person');
            entry.setAttribute('aria-label', `编辑图片 ${person.name}`); entry.setAttribute('aria-pressed', String(selected === person.id));
            const profile = getProfile(library, person.id);
            entry.append(portraitNode(profile, person.name, 'npm-avatar'));
            const words = make('span', undefined, 'npm-person-copy'); words.append(make('strong', person.name), make('small', person.present ? (profile?.portrait ? '已绑定图片' : '尚未绑定图片') : '此聊天尚未出现'));
            entry.append(words);
        }
    }
    function portraitNode(profile, name, cls) {
        const wrap = make('div', undefined, cls); wrap.append(make('span', name?.slice(0, 1) || '◇', 'npm-initial'));
        if (profile?.portrait) {
            const image = make('img'); image.alt = `${name}的图片`; image.src = profile.portrait;
            image.style.objectFit = profile.fit; image.style.objectPosition = `${profile.position.x}% ${profile.position.y}%`;
            image.addEventListener('error', () => { image.remove(); wrap.dataset.failed = 'true'; wrap.title = '图片无法读取，请重新选择图片'; }, { once: true });
            wrap.append(image);
        }
        return wrap;
    }
    function select(id) {
        checkScope(); selected = id; pendingImport = null;
        const person = people.find(p => p.id === id); if (!person) return;
        draft = structuredClone(getProfile(library, id) || { id, name: person.name, portrait: '', fit: 'cover', position: { x: 50, y: 30 }, note: '' });
        // The mapped name can change while the stable database primary key stays the same.
        draft.name = person.name || draft.name; cleanDraft = structuredClone(draft);
        renderRoster(); renderEditor();
    }
    function renderEditor() {
        editor.replaceChildren();
        if (!draft) { editor.append(make('p', '从左侧选择人物，上传头像或立绘。', 'npm-empty')); return; }
        const person = people.find(p => p.id === draft.id);
        const h = make('h3', draft.name); editor.append(h);
        if (person && !person.present) editor.append(make('p', '这是资源库中的人物，当前聊天尚未出现。这里只管理展示素材，不会把该人物加入剧情。', 'npm-hint'));
        const preview = make('div', undefined, 'npm-preview-wrap');
        function showPreview() { preview.replaceChildren(portraitNode(draft, draft.name, 'npm-preview')); }
        showPreview(); editor.append(preview);
        const form = make('div', undefined, 'npm-fields'); editor.append(form);
        const fileLabel = make('label', '选择头像或立绘'); const file = make('input'); file.type = 'file'; file.accept = 'image/png,image/jpeg,image/webp'; file.setAttribute('aria-label', '选择人物图片'); fileLabel.append(file); form.append(fileLabel);
        form.append(make('p', 'PNG、JPEG 或 WebP，单图不超过 3 MiB。选择后先预览，点击保存才上传到当前酒馆。', 'npm-hint'));
        file.addEventListener('change', () => {
            const chosen = file.files?.[0]; file.value = ''; if (!chosen) return;
            const id = selected;
            run(async ticket => {
                if (!chosen.size || chosen.size > MAX_IMAGE_BYTES) throw new Error('请选择不超过 3 MiB 的图片');
                const bytes = new Uint8Array(await chosen.arrayBuffer()); checkScope(ticket);
                if (selected !== id) throw new Error('所选人物已变化，请重新选择图片');
                const source = bytesToDataURL(bytes, chosen.type);
                draft.portrait = source; showPreview(); message('图片已载入预览，尚未保存。');
            }, '正在读取图片…');
        });
        const fitLabel = make('label', '显示方式'); const fit = make('select'); fit.setAttribute('aria-label', '人物图片显示方式');
        for (const [value, label] of [['cover', '铺满画框'], ['contain', '显示完整图片']]) { const option = make('option', label); option.value = value; fit.append(option); }
        fit.value = draft.fit; fitLabel.append(fit); form.append(fitLabel);
        fit.addEventListener('change', () => { draft.fit = fit.value; showPreview(); });
        const sliders = make('div', undefined, 'npm-sliders');
        for (const [axis, labelText] of [['x', '水平焦点'], ['y', '垂直焦点']]) {
            const label = make('label', labelText); const value = make('output', `${draft.position[axis]}%`); const input = make('input'); input.type = 'range'; input.min = '0'; input.max = '100'; input.step = '1'; input.value = String(draft.position[axis]); input.setAttribute('aria-label', `人物图片${labelText}`);
            input.addEventListener('input', () => { draft.position[axis] = Number(input.value); value.textContent = `${input.value}%`; showPreview(); }); label.append(value, input); sliders.append(label);
        }
        form.append(sliders);
        const noteLabel = make('label', '公开简介'); const note = make('textarea'); note.rows = 3; note.maxLength = 600; note.placeholder = '只填写可以给玩家看到的介绍，避免写入秘密设定。'; note.value = draft.note; note.setAttribute('aria-label', '人物公开简介');
        note.addEventListener('input', () => { draft.note = note.value; }); noteLabel.append(note); form.append(noteLabel);
        const actions = make('div', undefined, 'npm-form-actions');
        button('保存此人物', saveDraft, actions, 'npm-primary');
        button('解除图片绑定', () => { draft.portrait = ''; showPreview(); message('已在编辑区解除图片绑定；保存后生效。原图片文件不会被删除。'); }, actions);
        button('还原未保存修改', () => { draft = structuredClone(cleanDraft); renderEditor(); message('已还原为本次打开的设置。'); }, actions);
        form.append(actions);
        const binding = make('details', undefined, 'npm-binding'); binding.append(make('summary', '人物绑定标识'), make('code', draft.id)); form.append(binding);
    }
    function notifyChanged() {
        try { Promise.resolve(onChanged(library)).catch(() => message('图片已保存；界面刷新未完成，请重新打开人物面板。', true)); }
        catch { message('图片已保存；界面刷新未完成，请重新打开人物面板。', true); }
    }
    function saveDraft() {
        if (!draft) return;
        const next = upsertProfile(library, draft), id = selected;
        run(async ticket => {
            const saved = await store.save(next); checkScope(ticket); library = saved;
            refreshPeople(); select(id); message('已保存并从酒馆回读核对。同一世界卡的其他聊天也可使用。'); notifyChanged();
        }, '正在上传图片并保存到这张世界卡…');
    }
    function exportPack() {
        requestLeave(() => run(async ticket => {
            const portable = await store.exportPortable(); checkScope(ticket);
            const blob = new Blob([JSON.stringify(portable, null, 2)], { type: 'application/json' });
            if (blob.size > MAX_PACK_BYTES) throw new Error('含图资源包超过 15 MiB，请减少图片体积');
            const url = URL.createObjectURL(blob), link = make('a'); link.href = url; link.download = '人物图片资源包.json'; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
            message(`已导出 ${portable.profiles.length} 人的配置与图片。导入其他酒馆时仍需匹配相同人物标识。`);
        }, '正在收集图片并生成资源包…'));
    }
    importInput.addEventListener('change', () => {
        const file = importInput.files?.[0]; importInput.value = ''; if (!file) return;
        run(async ticket => {
            if (file.size > MAX_PACK_BYTES) throw new Error('资源包超过 15 MiB');
            const raw = await file.text(); checkScope(ticket);
            let value; try { value = JSON.parse(raw); } catch { throw new Error('资源包不是有效 JSON'); }
            pendingImport = validateLibrary(value);
            showImportPreview(); message('资源包已读取；尚未保存。请检查新增和替换项后再应用。');
        }, '正在读取人物资源包…');
    });
    function showImportPreview() {
        editor.replaceChildren(); const incoming = pendingImport;
        const existing = new Set(library.profiles.map(p => p.id));
        const replaced = incoming.profiles.filter(p => existing.has(p.id)).length;
        editor.append(make('h3', '导入预览'), make('p', `${incoming.profiles.length} 人：新增 ${incoming.profiles.length - replaced} 人，替换 ${replaced} 人。其他人物保留。`));
        editor.append(make('p', '人物标识需要与表格适配中的实体及主键一致。导入图片不代表角色已在剧情中出现。', 'npm-hint'));
        const list = make('ul', undefined, 'npm-import-list');
        for (const profile of incoming.profiles) list.append(make('li', `${existing.has(profile.id) ? '替换' : '新增'} · ${profile.name}${profile.portrait ? ' · 含图片' : ' · 无图片'}`));
        editor.append(list);
        const actions = make('div', undefined, 'npm-form-actions');
        const apply = button('确认合并到本世界卡', () => run(async ticket => {
            let merged = library;
            for (const profile of incoming.profiles) merged = upsertProfile(merged, profile);
            const saved = await store.save(merged); checkScope(ticket); library = saved; pendingImport = null; refreshPeople();
            const id = people.some(p => p.id === selected) ? selected : people[0]?.id;
            if (id) select(id); else { draft = null; renderEditor(); renderRoster(); }
            message('资源包已合并并从酒馆回读核对。'); notifyChanged();
        }, '正在上传资源包图片并保存…'), actions, 'npm-primary');
        apply.disabled = !incoming.profiles.length; apply.dataset.locked = String(!incoming.profiles.length);
        button('取消导入', () => { pendingImport = null; renderEditor(); message('已取消导入，未写入任何配置。'); }, actions); editor.append(actions);
    }
    search.addEventListener('input', () => { if (library) renderRoster(); });
    dialog.addEventListener('cancel', event => { event.preventDefault(); requestLeave(hide); });
    dialog.addEventListener('click', event => { if (event.target !== dialog) return; const box = dialog.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) requestLeave(hide); });
    const ctx = getContext();
    for (const eventName of ['CHAT_CHANGED', 'CHAT_LOADED']) if (ctx.eventTypes?.[eventName]) ctx.eventSource?.on(ctx.eventTypes[eventName], () => {
        if (!dialog.open) return;
        try { checkScope(); } catch (error) { message(`${ownerName}：${error.message}`, true); disable(busy); }
    });
    return {
        open(initialId) {
            if (dialog.open) { if (initialId && people.some(p => p.id === initialId)) requestLeave(() => select(initialId)); else closeButton.focus(); return; }
            opener = document.activeElement; opened++; busy = false; stale = false; draft = null; cleanDraft = null; pendingImport = null; selected = ''; search.value = ''; guard.hidden = true;
            owner = ''; ownerAvatar = ''; ownerName = ''; titleBlock.querySelector('h2').textContent = '人物图片';
            dialog.showModal();
            try {
                owner = currentScope(); ownerAvatar = store.scope(); const current = getContext(); ownerName = current.characters?.[current.characterId]?.name || ownerAvatar;
                titleBlock.querySelector('h2').textContent = `${ownerName} · 人物图片`;
                library = store.read(); refreshPeople(); renderRoster();
                if (people.length) select(people.some(p => p.id === initialId) ? initialId : people[0].id); else renderEditor();
                message('图片和公开简介只影响展示；保存前可以预览。'); disable(false);
            } catch (error) {
                library = null; stale = true; roster.replaceChildren(); editor.replaceChildren(make('p', '请先打开有效的单角色世界卡聊天，再重新打开此面板。', 'npm-empty'));
                message(error.message || String(error), true); disable(false);
            }
            closeButton.focus();
        },
        close() { requestLeave(hide); },
        refreshPeople() {
            if (!dialog.open || busy || stale || !library) return false;
            try { if (currentScope() !== owner) return false; } catch { return false; }
            refreshPeople();
            // A refresh may remove a catalog row while its uncommitted portrait is
            // being edited. Keep that selection without touching the form or draft.
            if (draft && !people.some(person => person.id === selected)) people.push({ id: selected, name: draft.name, present: false });
            if (!draft && !pendingImport && people.length) select(people.some(person => person.id === selected) ? selected : people[0].id);
            else renderRoster();
            return true;
        },
    };
}
