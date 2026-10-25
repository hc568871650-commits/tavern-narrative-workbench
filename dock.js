import { KEY, canonical, contextToken, committedState } from './core.js';
import { buildCatalog, composeAction, appendDraft } from './actions.js';

const make = (tag,text,cls) => { const e=document.createElement(tag); if(text!==undefined)e.textContent=text; if(cls)e.className=cls; return e; };
const icons = {items:'◇',people:'♙',tasks:'✓',places:'⌖',status:'◈'};
export function createDock({getContext,getApi,openWorkbench,refresh}) {
    const host=document.getElementById('send_form'); if(!host)return {clear(){},update(){},setBusy(){}};
    let snapshot=null, cfg=null, catalog=[], active='', picked=null, busy=false, expanded=true;
    let opener=null, pickerMode='items';
    const root=make('section',undefined,'nw-dock');root.id='nw-dock';root.setAttribute('aria-label','叙事操作栏');
    const bar=make('div',undefined,'nw-dock-bar');
    const brand=make('span','◇  场景工具','nw-dock-brand');bar.append(brand);
    const tabs=make('div',undefined,'nw-dock-tabs');tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','场景模块');bar.append(tabs);
    const controls=make('div',undefined,'nw-dock-tools');bar.append(controls);
    function button(text,handler,parent,cls) {const b=make('button',text,cls);b.type='button';b.addEventListener('click',handler);parent.append(b);return b;}
    const theme=button('氛围：开',()=>setTheme(!document.body.classList.contains('nw-player')),controls);
    theme.title='只调整本页聊天外观，可随时关闭';
    button('工作台',openWorkbench,controls);
    const collapse=button('收起',()=>{expanded=!expanded;content.hidden=!expanded;collapse.textContent=expanded?'收起':'展开';collapse.setAttribute('aria-expanded',String(expanded));},controls);collapse.setAttribute('aria-expanded','true');
    const content=make('div',undefined,'nw-dock-content');
    const top=make('div',undefined,'nw-dock-top');
    const heading=make('div');const title=make('strong','随故事而行');const subtitle=make('span','选择一张卡，载入它的场景工具。');heading.append(title,subtitle);top.append(heading);
    const status=make('span','等待状态','nw-dock-badge');status.setAttribute('role','status');top.append(status);
    button('↻',refresh,top,'nw-dock-refresh').setAttribute('aria-label','刷新操作栏');
    content.append(top);
    const layout=make('div',undefined,'nw-dock-layout');const list=make('div',undefined,'nw-dock-list');const detail=make('div',undefined,'nw-dock-detail');layout.append(list,detail);content.append(layout);
    const note=make('div','选择只会生成草稿，物品是否消耗由实际剧情决定。','nw-dock-note');note.id='nw-dock-note';note.setAttribute('aria-live','polite');content.append(note);
    root.append(bar,content);
    // Plotti's actual play screen keeps these controls in on-demand overlays.
    const dialog=make('dialog');dialog.id='nw-player-dialog';dialog.setAttribute('aria-label','状态与物品');
    const closeButton=button('×',closePicker,dialog,'nw-picker-close');closeButton.setAttribute('aria-label','关闭面板');dialog.append(root);document.body.append(dialog);
    dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)closePicker();}});
    dialog.addEventListener('keydown',e=>{if(e.key!=='Tab')return;const a=[...dialog.querySelectorAll('button,input')].filter(x=>!x.disabled&&x.getClientRects().length);if(!a.length)return;if(e.shiftKey&&document.activeElement===a[0]){e.preventDefault();a.at(-1).focus();}else if(!e.shiftKey&&document.activeElement===a.at(-1)){e.preventDefault();a[0].focus();}});
    const shortcuts=make('div',undefined,'nw-play-shortcuts');shortcuts.id='nw-play-shortcuts';
    const quickButtons=[];
    for(const [label,kind] of [['☷ 选项','options'],['♙ 人物','people'],['◈ 状态','status'],['◇ 物品','items']])quickButtons.push(button(label,()=>openPicker(kind),shortcuts));
    const toast=make('span','','nw-play-toast');toast.setAttribute('aria-live','polite');shortcuts.append(toast);host.append(shortcuts);
    const header=make('header');header.id='nw-play-header';const scene=make('strong','叙事游玩');const playStatus=make('span','等待状态');playStatus.setAttribute('role','status');header.append(scene,playStatus);
    const headTools=make('div');header.append(headTools);button('工作台',openWorkbench,headTools);const viewToggle=button('原生界面',()=>setTheme(!document.body.classList.contains('nw-player')),headTools);document.getElementById('sheld')?.prepend(header);
    const sidebar=make('aside');sidebar.id='nw-play-sidebar';sidebar.setAttribute('aria-label','人物与任务');document.body.append(sidebar);
    function closePicker(){dialog.close();opener?.focus?.();}
    function openPicker(kind){
        pickerMode=kind;
        opener=document.activeElement;const group=catalog.find(g=>g.kind===kind)||(kind==='options'?catalog.find(g=>g.kind!=='items'&&g.rows.some(i=>i.actions.length)):null)||catalog[0];
        if(group)active=group.id;picked=null;expanded=true;content.hidden=false;renderTabs();renderList();emptyDetail();if(kind==='options')renderOptions();if(kind==='status')renderStatus();dialog.showModal();closeButton.focus();
    }
    function setTheme(enabled) {
        document.body.classList.remove('nw-atmosphere');document.body.classList.toggle('nw-player',enabled);theme.textContent=`氛围：${enabled?'开':'关'}`;theme.setAttribute('aria-pressed',String(enabled));viewToggle.textContent=enabled?'原生界面':'游玩界面';
        try{localStorage.setItem('nw.player',enabled?'on':'off');}catch{}
    }
    let preferred=true;try{preferred=localStorage.getItem('nw.player')!=='off';}catch{}setTheme(preferred);
    const say=text=>{note.textContent=text;};
    function emptyDetail(){root.classList.remove('nw-preparing','nw-detail-open');detail.classList.remove('nw-action-active');detail.replaceChildren(make('div','选中一项，查看详情与可用动作。','nw-dock-placeholder'));}
    function clear(message='正在核对当前状态…') {
        snapshot=null;picked=null;catalog=[];tabs.replaceChildren();list.replaceChildren();emptyDetail();
        status.textContent=busy?'生成中':message;title.textContent='场景工具';subtitle.textContent='状态就绪后可选择操作';
        playStatus.textContent=busy?'生成中':message;quickButtons.forEach(b=>b.disabled=true);sidebar.replaceChildren(make('p',busy?'故事正在继续…':message,'nw-side-empty'));
    }
    function valid() {
        if(busy||!snapshot||!snapshot.persisted)throw new Error('状态尚未就绪，请刷新后重新选择');
        const ctx=getContext();
        if(contextToken(ctx)!==snapshot.token || canonical(ctx.chatMetadata?.[KEY])!==canonical(cfg))throw new Error('聊天、回复或配置已经变化，请重新选择');
        if(committedState(getApi().exportTableAsJson())!==committedState(snapshot.data))throw new Error('物品状态已经变化，请刷新后重新选择');
    }
    function renderTabs(){tabs.replaceChildren();for(const group of catalog){const b=button(`${icons[group.kind]} ${group.label} ${group.rows.length}`,()=>{pickerMode="entity";active=group.id;picked=null;renderTabs();renderList();emptyDetail();},tabs);b.setAttribute('role','tab');b.setAttribute('aria-selected',String(active===group.id));b.dataset.entity=group.id;} }
    function renderList() {
        list.replaceChildren();const group=catalog.find(g=>g.id===active);if(!group)return;
        title.textContent=group.label;subtitle.textContent=`${group.rows.length} 项记录 · ${cfg.name}`;
        if(!group.rows.length)list.append(make('p','这里还没有可显示的记录。','nw-dock-placeholder'));
        for(const item of group.rows){const card=button('',()=>showItem(item),list,'nw-item');card.dataset.item=item.id;card.setAttribute('aria-label',`选择 ${item.name}`);card.setAttribute('aria-pressed',String(picked===item.id));
            card.append(make('span',icons[item.kind],'nw-item-icon'));const words=make('span',undefined,'nw-item-copy');words.append(make('strong',item.name),make('small',item.description || (item.fields[0] ? String(item.fields[0].value??'暂无说明') : '查看详情')));card.append(words);
            if(item.quantity!==undefined)card.append(make('span',`×${item.quantity}`,'nw-item-count'));
        }
    }
    function showItem(item,preferredAction) {
        root.classList.remove('nw-preparing');detail.classList.remove('nw-action-active');
        root.classList.add('nw-detail-open');picked=item.id;renderList();detail.replaceChildren();
        const fromOptions=pickerMode==='options';const focusLabel=fromOptions?`${item.actions.find(a=>a.id===preferredAction)?.label} ${item.name}`:`选择 ${item.name}`;
        const back=button(fromOptions?'← 返回可选行动':'← 返回列表',()=>{
            emptyDetail();picked=null;if(fromOptions)renderOptions();else{renderTabs();renderList();}
            const target=[...list.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')===focusLabel);target?.focus();target?.scrollIntoView({block:'nearest'});
        },detail,'nw-back-list');
        detail.append(make('h4',item.name));
        const fields=make('dl');for(const f of item.fields){fields.append(make('dt',f.label.split('/').at(-1)),make('dd',String(f.value??'—')+f.unit));}detail.append(fields);
        if(!item.actions.length){detail.append(make('p','此记录仅供查看。','nw-dock-placeholder'));return;}
        const buttons=make('div',undefined,'nw-action-buttons');const form=make('div',undefined,'nw-action-form');detail.append(buttons,form);
        for(const action of item.actions){const b=button(action.label,()=>chooseAction(item,action,form),buttons);b.disabled=action.quantity&&(!Number.isFinite(item.quantity)||item.quantity<1);}
        const first=item.actions.find(a=>a.id===preferredAction)||item.actions.find(a=>!a.quantity||(Number.isFinite(item.quantity)&&item.quantity>=1));if(first)chooseAction(item,first,form);
        back.focus();back.scrollIntoView({block:'nearest'});
    }
    function renderOptions(){
        title.textContent='可选行动';subtitle.textContent='选择一条意图，再补充细节。';tabs.replaceChildren();list.replaceChildren();
        const tab=button('可选行动',renderOptions,tabs);tab.setAttribute('role','tab');tab.setAttribute('aria-selected','true');
        let count=0;for(const group of catalog.filter(g=>g.kind!=='items'))for(const item of group.rows)for(const action of item.actions){
            count++;const row=button('',()=>{active=group.id;renderTabs();showItem(item,action.id);},list,'nw-item');row.setAttribute('aria-label',`${action.label} ${item.name}`);const words=make('span',undefined,'nw-item-copy');words.append(make('strong',`${action.label} · ${item.name}`),make('small',item.description||group.label));row.append(words);
        }if(!count)list.append(make('p','此卡尚未配置可选行动，可直接在输入框自由输入。','nw-dock-placeholder'));
    }
    function renderStatus(){
        title.textContent='状态一览';subtitle.textContent='查看已记录的信息。';tabs.replaceChildren();emptyDetail();say('这里只读显示资料；编辑和保存请前往工作台。');
        function showRecord(item,group,chosen=false){if(chosen)root.classList.add('nw-detail-open');detail.replaceChildren();const back=button('← 返回列表',()=>{showGroup(group);const target=[...list.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')===`查看状态 ${item.name}`);target?.focus();target?.scrollIntoView({block:'nearest'});},detail,'nw-back-list');detail.append(make('h4',item.name));const dl=make('dl');for(const f of item.fields)dl.append(make('dt',f.label.split('/').at(-1)),make('dd',String(f.value??'—')+f.unit));detail.append(dl);if(chosen){back.focus();back.scrollIntoView({block:'nearest'});}}
        function showGroup(group){list.replaceChildren();emptyDetail();for(const item of group.rows){const b=button(item.name,()=>showRecord(item,group,true),list,'nw-item');b.setAttribute('aria-label',`查看状态 ${item.name}`);}if(group.rows[0])showRecord(group.rows[0],group);else list.append(make('p','暂无记录。','nw-dock-placeholder'));}
        const first=catalog.find(g=>g.kind==='status')||catalog.find(g=>g.kind==='people')||catalog[0];
        for(const group of catalog){const b=button(`${group.label} ${group.rows.length}`,()=>{for(const x of tabs.children)x.setAttribute('aria-selected',String(x===b));showGroup(group);},tabs);b.setAttribute('role','tab');b.setAttribute('aria-selected',String(group===first));}
        if(first)showGroup(first);
    }
    function chooseAction(item,action,form) {
        root.classList.add('nw-preparing');detail.classList.add('nw-action-active');
        say('准备完成后加入草稿，不会自动发送或扣除物品。');
        form.replaceChildren();delete form.dataset.consumed;const fields=make('div',undefined,'nw-action-fields');let qty,target;
        if(action.quantity){const label=make('label','数量');qty=make('input');qty.type='number';qty.min='1';qty.max=String(item.quantity);qty.step='1';qty.value='1';qty.setAttribute('aria-label','操作数量');label.append(qty);fields.append(label);}
        if(action.target){const label=make('label','对象');target=make('input');target.type='text';target.maxLength=100;target.placeholder='自己或对象名称';target.setAttribute('aria-label','操作对象');label.append(target);fields.append(label);}
        const preview=make('p',undefined,'nw-action-preview');preview.setAttribute('aria-live','polite');form.append(fields);
        if(target){const chips=make('div',undefined,'nw-target-chips');for(const name of [...new Set(['自己',...catalog.filter(g=>g.kind==='people').flatMap(g=>g.rows.map(r=>r.name))])].slice(0,8)){button(name,()=>{target.value=name;updatePreview();},chips);}form.append(chips);}
        form.append(preview);
        const add=button('加入聊天草稿',()=>{
            try{
                if(form.dataset.consumed==='true')return;
                valid();const actionText=composeAction(item,action.id,qty?Number(qty.value):undefined,target?.value);
                const input=document.getElementById('send_textarea');if(!input)throw new Error('找不到聊天输入框');
                input.value=appendDraft(input.value,actionText);input.dispatchEvent(new Event('input',{bubbles:true}));
                add.disabled=true;form.dataset.consumed='true';closePicker();input.focus();input.setSelectionRange(input.value.length,input.value.length);
                say('已加入草稿，原有文字保留。尚未发送，也未扣除物品。');toast.textContent='已加入输入 · 未发送';
            }catch(e){say(e.message);}
        },form,'nw-action-primary');
        function updatePreview(){try{preview.textContent=composeAction(item,action.id,qty?Number(qty.value):undefined,target?.value);add.disabled=form.dataset.consumed==='true';}catch(e){preview.textContent=e.message;add.disabled=true;}}
        qty?.addEventListener('input',updatePreview);target?.addEventListener('input',updatePreview);updatePreview();
    }
    function update(view,config,{historical=false}={}) {
        if(busy){clear();return;}
        cfg=structuredClone(config);snapshot=view;picked=null;toast.textContent='';
        if(dialog.open)closePicker();
        if(historical){clear('历史只读');say('正在查看历史楼层。回到工作台“当前状态”后可准备行动。');return;}
        if(!view.persisted || view.current.issues.length){clear('状态待确认');say('当前状态或字段映射存在问题，请到工作台核对后再操作。');return;}
        catalog=buildCatalog(cfg,view.current);if(!catalog.some(g=>g.id===active))active=(catalog.find(g=>g.kind==='items')||catalog[0])?.id;
        status.textContent='当前状态';playStatus.textContent='当前状态';scene.textContent=getContext().name2||cfg.name;quickButtons.forEach(b=>b.disabled=false);renderTabs();renderList();emptyDetail();renderSidebar();say('选择只会生成草稿，物品是否消耗由实际剧情决定。');
    }
    function renderSidebar(){
        sidebar.replaceChildren();const top=make('div',undefined,'nw-side-top');top.append(make('strong','人物资料'));button('全部',()=>openPicker('people'),top);sidebar.append(top);
        const person=catalog.filter(g=>g.kind==='people').flatMap(g=>g.rows)[0];
        const portrait=make('div',undefined,'nw-character-mark');portrait.append(make('span',person?.name.slice(0,1)||'◇'),make('small',person?'人物档案':'当前故事'));sidebar.append(portrait);
        const box=make('section',undefined,'nw-character-facts');box.append(make('h2',person?.name||getContext().name2||'尚未选择角色'));
        if(person){for(const f of person.fields){const line=make('div');line.append(make('small',f.label.split('/').at(-1)),make('span',String(f.value??'—')+f.unit));box.append(line);}button('与其互动',()=>{openPicker('people');showItem(person);},box);}else box.append(make('p','此卡未配置人物资料。'));
        sidebar.append(box);
        const tasks=catalog.filter(g=>g.kind==='tasks').flatMap(g=>g.rows);if(tasks.length){sidebar.append(make('h3','当前任务'));for(const task of tasks.slice(0,3)){const b=button('',()=>{openPicker('tasks');showItem(task);},sidebar,'nw-side-task');b.append(make('strong',task.name),make('small',task.description));}}
    }
    return {clear,update,setBusy(value){busy=value;if(value)clear();}};
}
