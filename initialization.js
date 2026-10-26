import { KEY, canonical, committedState, contextToken, validateConfig, assertSupportedTimeline } from './core.js';

let running = false;
const phases = {
    validate: '检查空白聊天与样例', confirm: '等待确认', template: '建立本聊天表结构',
    'initial-values': '提交样例初值', verify: '核对历史帧与磁盘保存', complete: '样例初始化完成', cancelled: '已取消初始化',
};

function hasFrames(chat) {
    return chat.some(message => {
        let slots = message.TavernDB_ACU_IsolatedData;
        if (typeof slots === 'string') {
            try { slots = JSON.parse(slots); } catch { throw new Error('聊天数据库字段无法解析，请先检查存档'); }
        }
        if (slots != null && (typeof slots !== 'object' || Array.isArray(slots))) throw new Error('聊天数据库字段格式异常');
        return Object.values(slots || {}).some(slot => slot?.storageFrame);
    });
}

/** confirm resolves to true only on explicit approval. verifySave is a zero-argument host readback callback.
 * No timeout races or automatic retries: an unresolved backend write may still be running.
 */
export async function initializeSample({ getContext, getApi, tables, confirm, onPhase = () => {}, verifySave }) {
    if (running) throw Object.assign(new Error('样例初始化正在进行，请等待完成'), { phase: 'validate', mayHaveWritten: false });
    running = true;
    let phase = 'validate', mayHaveWritten = false;
    const announce = next => {
        phase = next;
        try { onPhase({ phase, message: phases[phase] }); } catch { /* Presentation errors must not interrupt a commit. */ }
    };
    try {
        announce('validate');
        if (typeof confirm !== 'function' || typeof verifySave !== 'function') throw new Error('缺少确认或磁盘回读能力');
        const start = getContext(), chat = start.chat, first = chat?.[0], backend = getApi();
        if (!start.chatId || start.groupId || !Array.isArray(chat)) throw new Error('样例初始化仅支持已打开的单角色聊天');
        const cfg = validateConfig(start.chatMetadata?.[KEY]);
        const identity = canonical([start.characterId, start.groupId, start.chatId, start.characters?.[start.characterId]?.avatar]);
        const configToken = canonical(cfg), initialToken = contextToken(start);
        const narrative = () => canonical(getContext().chat?.map(m => [m.mes, m.swipe_id, m.swipes, m.is_user]));
        const initialNarrative = narrative();
        const assertOwner = () => {
            const current = getContext();
            if (canonical([current.characterId, current.groupId, current.chatId, current.characters?.[current.characterId]?.avatar]) !== identity
                || current.chat !== chat || current.chat?.[0] !== first || narrative() !== initialNarrative
                || canonical(current.chatMetadata?.[KEY]) !== configToken || getApi() !== backend) {
                throw new Error('聊天、正文、适配配置或底座已变化，已停止后续写入；请回原聊天核对');
            }
        };
        const assertEmpty = () => {
            assertOwner();
            assertSupportedTimeline(chat, 0);
            if (chat.length !== 1 || first.is_user || hasFrames(chat)
                || Object.entries(backend.exportTableAsJson() || {}).some(([key, sheet]) => key.startsWith('sheet_') && sheet?.content?.length > 1)) {
                throw new Error('仅允许一条开场消息、无已存表格数据的空白聊天初始化');
            }
        };
        for (const method of ['importTemplateFromData', 'importTableAsJson', 'exportTableAsJson', 'exportTableSnapshotsAtMessages']) {
            if (typeof backend?.[method] !== 'function') throw new Error(`底座尚未就绪：缺少 ${method}`);
        }
        const supplied = structuredClone(tables);
        const sheets = Object.entries(supplied || {}).filter(([key]) => key.startsWith('sheet_'));
        if (!supplied?.mate || !sheets.length || sheets.some(([, sheet]) => !sheet?.name || !Array.isArray(sheet.content) || !Array.isArray(sheet.content[0]))) {
            throw new Error('样例缺少完整表结构');
        }
        if (new Set(sheets.map(([, sheet]) => sheet.name)).size !== sheets.length) throw new Error('样例表名称重复，无法唯一匹配');
        assertEmpty();
        announce('confirm');
        if (await confirm() !== true) { announce('cancelled'); return { status: 'cancelled' }; }
        assertEmpty();
        if (contextToken(getContext()) !== initialToken) throw new Error('确认期间消息存储已变化，未执行初始化');

        announce('template');
        mayHaveWritten = true;
        const result = await backend.importTemplateFromData(supplied, { scope: 'chat', dataMode: 'replace', presetName: cfg.name });
        assertOwner();
        if (!result?.success || result.runtimeReady === false) throw new Error(result?.message || '底座未确认模板与运行时就绪');
        // A pristine template commit stores guide/scope only. Reject a competing data commit.
        if (hasFrames(chat) || contextToken(getContext()) !== initialToken) throw new Error('建立模板期间出现其他数据提交，未覆盖初值');
        const initialData = structuredClone(backend.exportTableAsJson());
        const normalized = Object.entries(initialData || {}).filter(([key]) => key.startsWith('sheet_'));
        if (normalized.length !== sheets.length || new Set(normalized.map(([, sheet]) => sheet?.name)).size !== sheets.length) throw new Error('底座返回的样例表数量或名称不唯一');
        for (const [, sheet] of normalized) {
            const matches = sheets.filter(([, source]) => source.name === sheet?.name);
            if (matches.length !== 1) throw new Error('样例表结构匹配不唯一，未提交初值');
            sheet.content = structuredClone(matches[0][1].content);
            delete sheet.seedRows;
        }
        assertOwner();
        announce('initial-values');
        if (await backend.importTableAsJson(JSON.stringify(initialData)) !== true) throw new Error('模板可能已建立，但初值未获保存确认；请检查原聊天，不自动重试');
        assertOwner();
        const committedToken = contextToken(getContext());
        announce('verify');
        const history = await backend.exportTableSnapshotsAtMessages([0]);
        assertOwner();
        if (contextToken(getContext()) !== committedToken) throw new Error('核对期间数据库帧已变化，不能确认本次初值');
        const snapshots = history?.snapshots?.filter(snapshot => snapshot.messageIndex === 0);
        if (!history?.success || snapshots?.length !== 1 || committedState(snapshots[0].data) !== committedState(initialData)) {
            throw new Error(`初值提交后历史帧未核对一致：${history?.error || history?.code || '缺少或不一致的初始快照'}`);
        }
        const verification = await verifySave();
        assertOwner();
        if (contextToken(getContext()) !== committedToken) throw new Error('磁盘回读期间数据库帧已变化，不能确认本次初值');
        if (verification === false) throw new Error('磁盘回读未获确认');
        announce('complete');
        return { status: 'complete', chatId: start.chatId, tableCount: normalized.length, verification };
    } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        throw Object.assign(new Error(`${phases[phase]}失败：${message}${mayHaveWritten ? '（可能已部分写入；不会自动重试或覆盖）' : ''}`, { cause }), { phase, mayHaveWritten });
    } finally { running = false; }
}
