import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateConfig, parseConfig, project, changes, assertSupportedTimeline, readView } from '../core.js';

const config = () => ({ version: 1, backend: 'shujuku', id: 'test', name: '隔离样例',
    modules: [{id:'resources',label:'资源',enabled:true}], entities: [{id:'ship',label:'飞船',module:'resources',
        sheet:{name:'补给'},keyColumn:'id',fields:[{id:'fuel',column:'fuel',label:'燃料',type:'number',min:0,max:100,required:true}]}] });
const table = (rows = [['a', 10], ['b', 20]]) => ({mate:{type:'acu',version:1},sheet_ship:{uid:'ship',name:'补给',content:[['id','fuel'], ...rows]}});
const context = () => ({characterId:0,groupId:null,chatId:'chat-a',chat:[{mes:'opening',swipe_id:0},{mes:'turn two',swipe_id:0}]});
function apiFor(states, runtime = states.at(-1)) {
    return { exportTableSnapshotsAtMessages: async indices => ({success:true,snapshots:indices.map(messageIndex => ({messageIndex,data:states[messageIndex]}))}),
        exportTableAsJson: () => runtime };
}
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return {promise, resolve}; }

for (const name of ['academy','starship']) test(`交付适配 ${name} 可导入导出且互相独立`, async () => {
    const raw = await readFile(new URL(`../examples/${name}.json`,import.meta.url),'utf8');
    const c = parseConfig(raw); assert.deepEqual(parseConfig(JSON.stringify(c)),c);
    const copy = validateConfig(c); copy.name='changed'; assert.notEqual(copy.name,c.name);
});

test('拒绝不支持底座、重复标识、未知模块和歧义映射', () => {
    for (const mutate of [c=>c.backend='other',c=>c.modules.push({...c.modules[0]}),c=>c.entities.push({...c.entities[0]}),
        c=>c.entities[0].fields.push({...c.entities[0].fields[0]}),c=>c.entities[0].module='missing',
        c=>c.entities[0].sheet.key='sheet_ship',c=>c.entities[0].sheet={},c=>c.entities[0].fields[0].min=101]) {
        const c=config(); mutate(c); assert.throws(()=>validateConfig(c));
    }
    assert.throws(()=>parseConfig(' '.repeat(200001)), /200 KB/);
});

test('声明式配置只保留文本，不执行作为字段值传入的代码', () => {
    const c=config(); c.entities[0].fields[0].label='globalThis.shouldNeverRun = true';
    assert.equal(validateConfig(c).entities[0].fields[0].label,c.entities[0].fields[0].label);
    assert.equal(globalThis.shouldNeverRun,undefined);
});

test('重复主键、数字字符串等价主键、重复表头及同名表拒绝猜测', () => {
    for (const data of [table([['a',10],['a',20]]),table([[1,10],['1',20]]),table([['',10]])]) {
        const p=project(data,config()); assert.equal(p.cells.length,0); assert.match(p.issues.join(''),/主键/);
    }
    const duplicateHeader=table(); duplicateHeader.sheet_ship.content[0]=['id','id'];
    assert.equal(project(duplicateHeader,config()).cells.length,0);
    const duplicateTable=table(); duplicateTable.sheet_other=structuredClone(duplicateTable.sheet_ship);
    assert.equal(project(duplicateTable,config()).cells.length,0);
});

test('行序和列序变化不构成业务变化，字符串数字规范化', () => {
    const before=project(table(),config());
    const after=table([['20','b'],['10','a']]); after.sheet_ship.content[0]=['fuel','id'];
    assert.deepEqual(changes(before,project(after,config())),[]);
});

test('按稳定主键区分改变、新增和移除，重复读取不重复结算', () => {
    const before=project(table(),config()), after=project(table([['a',9],['c',30]]),config());
    assert.deepEqual(changes(before,after).map(c=>c.kind).sort(),['新增','改变','移除'].sort());
    assert.deepEqual(changes(after,after),[]);
    assert.deepEqual(changes(before,after),changes(before,after));
});

test('关闭模块不显示数据；数值规则异常保留来源和诊断', () => {
    const c=config(); c.modules[0].enabled=false;
    assert.deepEqual(project(table(),c),{cells:[],groups:[],issues:[]});
    const p=project(table([['a',-1],['b','no-number']]),config());
    assert.equal(p.issues.length,2); assert.match(p.cells[0].source,/sheet_ship\[a\]\.fuel/);
});

test('当前或以前的多 swipe 会阻止读取，允许此前单版本楼层', async () => {
    const ctx=context(); ctx.chat[1].swipes=['a','b'];
    assert.throws(()=>assertSupportedTimeline(ctx.chat,1),/多 swipe/);
    assert.doesNotThrow(()=>assertSupportedTimeline(ctx.chat,0));
    let calls=0; await assert.rejects(readView(()=>ctx,{exportTableSnapshotsAtMessages:async()=>{calls++;}},config()),/多 swipe/);
    assert.equal(calls,0);
    ctx.chat[1].swipes=['a']; ctx.chat[1].swipe_id=1;
    assert.throws(()=>assertSupportedTimeline(ctx.chat,1),/多 swipe/);
});

for (const mutation of ['chat-id','same-id-new-array','body','swipe','frame']) test(`异步读取丢弃已变化上下文：${mutation}`, async () => {
    const ctx=context(), pending=deferred();
    const api={...apiFor([table(),table()]),exportTableSnapshotsAtMessages:()=>pending.promise};
    const promise=readView(()=>ctx,api,config());
    if(mutation==='chat-id') ctx.chatId='chat-b';
    if(mutation==='same-id-new-array') ctx.chat=structuredClone(ctx.chat);
    if(mutation==='body') ctx.chat[1].mes='edited';
    if(mutation==='swipe') ctx.chat[1].swipe_id=1;
    if(mutation==='frame') ctx.chat[1].TavernDB_ACU_IsolatedData={slot:{revision:2}};
    pending.resolve({success:true,snapshots:[{messageIndex:0,data:table()},{messageIndex:1,data:table()}]});
    await assert.rejects(promise,/旧结果已丢弃/);
});

test('缺接口、结构化失败、抛异常都不退回当前运行时伪造历史', async () => {
    const ctx=context(); let runtimeReads=0;
    for(const api of [{}, {exportTableSnapshotsAtMessages:async()=>({success:false,code:'replay_failed',error:'损坏帧'})},
        {exportTableSnapshotsAtMessages:async()=>{throw new Error('offline');}}]) {
        api.exportTableAsJson=()=>{runtimeReads++;return table();};
        await assert.rejects(readView(()=>ctx,api,config()));
    }
    assert.equal(runtimeReads,0);
});

test('缺少当前楼层或前一楼快照必须失败，不把未知基线当空表', async () => {
    const ctx=context();
    for(const messageIndex of [0,1]) await assert.rejects(readView(()=>ctx,{
        ...apiFor([table(),table()]),exportTableSnapshotsAtMessages:async()=>({success:true,snapshots:[{messageIndex,data:table()}]})
    },config()));
});

test('重复主键使实体不可识别时不虚报所有记录新增或移除', async () => {
    const valid=table(), invalid=table([['a',10],['a',20]]);
    for (const states of [[valid,invalid],[invalid,valid]]) {
        const ctx=context(), view=await readView(()=>ctx,apiFor(states),config());
        assert.ok(view.current.issues.length || view.baselineIssues.length);
        assert.deepEqual(view.changes,[]);
    }
});

test('重复快照回执与缺少快照列表不允许任意选择历史', async () => {
    const ctx=context(), a={messageIndex:0,data:table()}, b={messageIndex:1,data:table()};
    for (const snapshots of [undefined,[a,a,b],[a,b,b]]) {
        const api={...apiFor([table(),table()]),exportTableSnapshotsAtMessages:async()=>({success:true,snapshots})};
        await assert.rejects(readView(()=>ctx,api,config()),/完整、唯一/);
    }
});

test('runtime-only 更新不标为持久化；展示与变化均来自记录帧', async () => {
    const ctx=context(), old=table(), saved=table([['a',9],['b',20]]), runtime=table([['a',4],['b',20]]);
    const result=await readView(()=>ctx,apiFor([old,saved],runtime),config());
    assert.equal(result.persisted,false); assert.deepEqual(result.data,saved);
    assert.equal(result.changes[0].after,9); assert.equal(result.current.cells[0].value,9);
    const historic=await readView(()=>ctx,apiFor([old,saved],runtime),config(),0);
    assert.equal(historic.persisted,true); assert.equal(historic.initial,true);
});

test('当前运行时与持久帧一致可确认一致，结果是独立副本', async () => {
    const ctx=context(), saved=table();
    const result=await readView(()=>ctx,apiFor([saved,saved]),config());
    assert.equal(result.persisted,true); assert.deepEqual(result.changes,[]);
    result.data.sheet_ship.content[1][1]=999;
    assert.equal(saved.sheet_ship.content[1][1],10);
});

test('仅seedRows运行时初始化提示差异不误报业务未保存', async () => {
    const ctx=context(), saved=table(), runtime=structuredClone(saved);
    runtime.sheet_ship.seedRows=[['a','initial-hint']];
    const view=await readView(()=>ctx,apiFor([saved,saved],runtime),config());
    assert.equal(view.persisted,true);assert.deepEqual(view.changes,[]);
    assert.deepEqual(runtime.sheet_ship.seedRows,[['a','initial-hint']]);
});

test('seedRows与业务content同时变化仍必须标为未保存', async () => {
    const ctx=context(), saved=table(), runtime=structuredClone(saved);
    runtime.sheet_ship.seedRows=[['a','initial-hint']];runtime.sheet_ship.content[1][1]=7;
    const view=await readView(()=>ctx,apiFor([saved,saved],runtime),config());
    assert.equal(view.persisted,false);assert.equal(view.current.cells[0].value,10);
});

test('仅排除seedRows，不忽略其他配置或业务字段变化', async () => {
    const ctx=context(), saved=table(), runtime=structuredClone(saved);
    runtime.sheet_ship.sourceData={note:'changed'};
    assert.equal((await readView(()=>ctx,apiFor([saved,saved],runtime),config())).persisted,false);
});
