import { KEY, canonical, contextToken } from './core.js';

// Host-specific readback. No business writes; a resolved saveChat() alone is not a receipt.
export async function verifyHostSave(getContext, request = fetch) {
    const ctx = getContext(), token = contextToken(ctx);
    const cfg = canonical(ctx.chatMetadata?.[KEY]);
    if (!ctx.chatId || ctx.groupId) throw new Error('磁盘核对首版仅支持单角色聊天');
    const character = ctx.characters?.[ctx.characterId];
    if (!character?.avatar) throw new Error('当前角色身份不完整');
    const response = await request('/api/chats/get', {
        method: 'POST', cache: 'no-store', headers: ctx.getRequestHeaders(),
        body: JSON.stringify({ ch_name: character.name, avatar_url: character.avatar, file_name: ctx.chatId }),
    });
    if (!response.ok) throw new Error(`聊天保存回读失败：HTTP ${response.status}`);
    const data = await response.json();
    if (contextToken(getContext()) !== token || getContext().chat !== ctx.chat || canonical(getContext().chatMetadata?.[KEY]) !== cfg) throw new Error('磁盘核对期间聊天或配置已变化，结果已丢弃');
    if (!Array.isArray(data) || !data[0]?.chat_metadata) throw new Error('宿主未返回有效聊天文件');
    const relevant = messages => messages.map(m => ({ text: m.mes, swipe: m.swipe_id, versions: m.swipes, frames: m.TavernDB_ACU_IsolatedData }));
    if (canonical(relevant(data.slice(1))) !== canonical(relevant(ctx.chat))) throw new Error('磁盘中的正文、回复版本或数据库帧与内存不一致；保存尚未确认');
    if (canonical(data[0].chat_metadata[KEY]) !== cfg) throw new Error('磁盘适配配置与当前配置不一致；保存尚未确认');
    return { chatId: ctx.chatId, messageCount: ctx.chat.length, coverage: ['正文与swipe', '数据库消息帧', '适配配置'] };
}
