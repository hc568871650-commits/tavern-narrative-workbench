// Declarative, draft-only actions. This module never writes business state or runs commands.
export function validateActionUI(config) {
    for (const entity of config.entities) {
        const ui = entity.ui; if (!ui) continue;
        if (!['items','people','tasks','places','status'].includes(ui.kind)) throw new Error('ui.kind 无效');
        const field = id => entity.fields.some(f => f.id === id);
        for (const key of ['titleField','quantityField','descriptionField']) if (ui[key] && !field(ui[key])) throw new Error(`ui.${key} 引用了不存在的字段`);
        if (ui.filter && (!field(ui.filter.field) || !['string','number','boolean'].includes(typeof ui.filter.equals))) throw new Error('ui.filter 须明确指定字段和值');
        if (ui.kind === 'items' && !ui.filter && ui.visibility !== 'all') throw new Error('物品栏必须指定持有者/可见范围筛选，或显式声明 visibility:all');
        if (ui.actions !== undefined && (!Array.isArray(ui.actions) || ui.actions.length > 8)) throw new Error('ui.actions 最多 8 项');
        const seen = new Set();
        for (const action of ui.actions || []) {
            if (typeof action.id !== 'string' || !action.id || seen.has(action.id)) throw new Error('操作 id 为空或重复');
            seen.add(action.id);
            if (typeof action.label !== 'string' || !action.label || action.label.length > 40) throw new Error('操作名称须为 1–40 字符');
            if (typeof action.template !== 'string' || !action.template.trim() || action.template.length > 1000) throw new Error('操作文本须为 1–1000 字符');
            const stripped = action.template.replace(/\{(name|quantity|target)\}/g, '');
            if (/[{}]/.test(stripped)) throw new Error('操作文本仅支持 {name}/{quantity}/{target}');
            for (const k of ['quantity','target']) if (action[k] !== undefined && typeof action[k] !== 'boolean') throw new Error(`操作 ${k} 须为布尔值`);
            if (action.quantity && !ui.quantityField) throw new Error('数量操作必须映射 quantityField');
            if (action.template.includes('{target}') && !action.target) throw new Error('{target} 必须启用对象选择');
            if (action.template.includes('{quantity}') && !action.quantity) throw new Error('{quantity} 必须启用数量选择');
        }
    }
}
export function buildCatalog(config, projection) {
    return config.entities.filter(e => config.modules.find(m => m.id === e.module)?.enabled).map(entity => {
        const ui = entity.ui || {kind:'status'};
        const group = projection.groups.find(g => g.entityId === entity.id);
        const rows = (group?.rows || []).flatMap(row => {
            const values = Object.fromEntries(row.fields.map(f => [JSON.parse(f.id)[2],f.value]));
            if (ui.filter && values[ui.filter.field] !== ui.filter.equals) return [];
            const quantity = ui.quantityField ? Number(values[ui.quantityField]) : undefined;
            const item = {id:JSON.stringify([entity.id,row.key]),name:String(ui.titleField ? values[ui.titleField] ?? row.key : row.key),
                description:String(ui.descriptionField ? values[ui.descriptionField] ?? '' : ''),quantity,
                fields:row.fields,actions:ui.actions || [],kind:ui.kind};
            return [item];
        });
        return {id:entity.id,label:entity.label,kind:ui.kind,rows};
    });
}
export function composeAction(item, actionId, quantity, target) {
    const action = item.actions.find(a => a.id === actionId);
    if (!action) throw new Error('操作已不可用');
    if (action.quantity && (!Number.isSafeInteger(quantity) || quantity < 1 || !Number.isFinite(item.quantity) || quantity > item.quantity)) throw new Error('数量必须为正整数，且不能超过当前库存');
    const cleanTarget = typeof target === 'string' ? target.trim() : '';
    if (action.target && (!cleanTarget || cleanTarget.length > 100 || /[\r\n]/.test(cleanTarget))) throw new Error('请填写 1–100 字的操作对象');
    return action.template.replace(/\{(name|quantity|target)\}/g, (_m,key) => String({name:item.name,quantity,target:cleanTarget}[key]));
}
export function appendDraft(existing, actionText) {
    // Never interpret slash commands, clear text, send a message, or modify database values.
    return existing + (existing && !existing.endsWith('\n') ? '\n' : '') + actionText;
}
// A player-facing summary must not reveal rows excluded by entity visibility filters.
// Removed rows have no current visibility proof, so omit them conservatively.
export function visibleChanges(changes, catalog) {
    const allowed=new Set(catalog.flatMap(group=>group.rows.map(row=>row.id)));
    return changes.filter(change=>{
        try{const [entity,key]=JSON.parse(change.id);return allowed.has(JSON.stringify([entity,key]));}
        catch{return false;}
    });
}
