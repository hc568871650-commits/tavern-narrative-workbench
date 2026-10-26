import test from 'node:test';
import assert from 'node:assert/strict';
import { initializeSample } from '../initialization.js';
import { KEY } from '../core.js';

function fixture() {
    const config={version:1,backend:'shujuku',id:'demo',name:'测试适配',modules:[{id:'m',label:'模块',enabled:true}],entities:[{id:'e',label:'物品',module:'m',sheet:{name:'物品'},keyColumn:'id',fields:[{id:'qty',label:'数量',column:'数量',type:'number'}]}]};
    const tables={mate:{type:'chatSheets',version:1},sheet_source:{name:'物品',uid:'source',content:[['row_id','数量'],['1',3]],sourceData:{},updateConfig:{},exportConfig:{}}};
    const state={chatId:'first-chat',characterId:0,groupId:null,characters:[{avatar:'demo.png'}],chatMetadata:{[KEY]:config},chat:[{is_user:false,mes:'开场',swipe_id:0}]};
    let runtime={},saved;
    const calls=[],phases=[];
    const api={
        exportTableAsJson:()=>runtime,
        importTemplateFromData:async(data,options)=>{calls.push(['template',structuredClone(options)]);runtime={mate:data.mate,sheet_normalized:{...structuredClone(data.sheet_source),uid:'normalized',content:[['row_id','数量']],seedRows:[['1',3]]}};return {success:true,runtimeReady:true};},
        importTableAsJson:async json=>{calls.push(['values']);saved=JSON.parse(json);runtime=structuredClone(saved);state.chat[0].TavernDB_ACU_IsolatedData={'':{storageFrame:{checkpoint:{kind:'full',data:saved},logEntries:[]}}};return true;},
        exportTableSnapshotsAtMessages:async indices=>{calls.push(['history',indices]);return {success:true,snapshots:[{messageIndex:0,data:saved}]};},
    };
    const args={getContext:()=>({...state}),getApi:()=>api,tables,confirm:async()=>{calls.push(['confirm']);return true;},onPhase:p=>phases.push(p.phase),verifySave:async()=>{calls.push(['verify']);return {chatId:state.chatId,messageCount:1};}};
    return {args,state,api,calls,phases,setRuntime:value=>runtime=value};
}

 test('完整流程仅聊天模板导入，规范化初值落正式帧，再历史与磁盘回读',async()=>{
    const f=fixture(),original=structuredClone(f.args.tables),r=await initializeSample(f.args);
    assert.deepEqual(f.calls.map(c=>c[0]),['confirm','template','values','history','verify']);
    assert.deepEqual(f.calls[1][1],{scope:'chat',dataMode:'replace',presetName:'测试适配'});
    assert.deepEqual(f.phases,['validate','confirm','template','initial-values','verify','complete']);
    assert.equal(r.status,'complete');assert.equal(r.tableCount,1);assert.equal(r.chatId,'first-chat');
    const saved=f.state.chat[0].TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint.data;
    assert.equal(saved.sheet_normalized.uid,'normalized');assert.equal(saved.sheet_normalized.content[1][1],3);assert.equal('seedRows' in saved.sheet_normalized,false);
    assert.deepEqual(f.args.tables,original);
});

test('取消与非严格true确认均不写入',async()=>{
    for(const response of [false,null,undefined,1,'yes']){const f=fixture();f.args.confirm=async()=>response;assert.deepEqual(await initializeSample(f.args),{status:'cancelled'});assert.equal(f.calls.length,0);}
});

test('已有帧、序列化已有帧或运行时已有数据提前拒绝，不能重复初始化',async()=>{
    for(const kind of ['frames','serialized','rows','swipe','multiple-messages']){
        const f=fixture();
        if(kind==='frames')f.state.chat[0].TavernDB_ACU_IsolatedData={'':{storageFrame:{version:2}}};
        if(kind==='serialized')f.state.chat[0].TavernDB_ACU_IsolatedData=JSON.stringify({'':{storageFrame:{version:2}}});
        if(kind==='rows')f.setRuntime(f.args.tables);
        if(kind==='swipe')f.state.chat[0].swipes=['a','b'];
        if(kind==='multiple-messages')f.state.chat.push({is_user:true,mes:'额外楼层'});
        await assert.rejects(initializeSample(f.args),e=>e.phase==='validate'&&!e.mayHaveWritten);assert.equal(f.calls.length,0);
    }
});

test('成功后第二次调用不会重复导入或结算',async()=>{const f=fixture();await initializeSample(f.args);const before=f.calls.length;await assert.rejects(initializeSample(f.args));assert.equal(f.calls.length,before);});

for(const change of ['chat','array','first-message','body','config','backend','inventory'])test(`异步确认期间${change}变化不写模板`,async()=>{
    const f=fixture();f.args.confirm=async()=>{
        if(change==='chat')f.state.chatId='another';
        if(change==='array')f.state.chat=structuredClone(f.state.chat);
        if(change==='first-message')f.state.chat[0]={...f.state.chat[0]};
        if(change==='body')f.state.chat[0].mes='编辑后的正文';
        if(change==='config')f.state.chatMetadata[KEY].name='另一配置';
        if(change==='backend')f.args.getApi=()=>({...f.api});
        if(change==='inventory')f.setRuntime(f.args.tables);
        return true;
    };
    // getApi is captured from arguments; use a stable closure for the replacement case.
    if(change==='backend'){let current=f.api;f.args.getApi=()=>current;f.args.confirm=async()=>{current={...f.api};return true;};}
    await assert.rejects(initializeSample(f.args),e=>e.phase==='confirm'&&!e.mayHaveWritten);assert.equal(f.calls.length,0);
});

test('模板阶段成功但切卡后拒绝后续初值写入',async()=>{
    const f=fixture(),original=f.api.importTemplateFromData;
    f.api.importTemplateFromData=async(...args)=>{await original(...args);f.state.chatId='new';return {success:true,runtimeReady:true};};
    await assert.rejects(initializeSample(f.args),e=>e.phase==='template'&&e.mayHaveWritten);
    assert.deepEqual(f.calls.map(c=>c[0]),['confirm','template']);
});

test('模板已保存但runtime未就绪时停止并保留阶段信息',async()=>{
    const f=fixture();f.api.importTemplateFromData=async()=>({success:true,runtimeReady:false,message:'运行时重建失败'});
    await assert.rejects(initializeSample(f.args),e=>e.phase==='template'&&e.mayHaveWritten&&e.message.includes('运行时重建失败'));
    assert.equal(f.calls.some(c=>c[0]==='values'),false);
});

test('模板成功但初值失败不回读、不伪报完成或自动重试',async()=>{
    const f=fixture();f.api.importTableAsJson=async()=>{f.calls.push(['values']);return false;};
    await assert.rejects(initializeSample(f.args),e=>e.phase==='initial-values'&&e.mayHaveWritten);
    assert.deepEqual(f.calls.map(c=>c[0]),['confirm','template','values']);assert.equal(f.phases.includes('complete'),false);
});

test('新出现竞争帧或规范化表缺失时不覆盖样例',async()=>{
    for(const kind of ['competing-frame','missing-table']){
        const f=fixture(),original=f.api.importTemplateFromData;
        f.api.importTemplateFromData=async(...args)=>{await original(...args);if(kind==='competing-frame')f.state.chat[0].TavernDB_ACU_IsolatedData={'':{storageFrame:{version:2}}};else f.setRuntime({mate:{}});return {success:true};};
        await assert.rejects(initializeSample(f.args));assert.equal(f.calls.some(c=>c[0]==='values'),false);
    }
});

test('初值回执true但没有历史基底不计完成',async()=>{
    const f=fixture();f.api.exportTableSnapshotsAtMessages=async()=>({success:false,code:'replay_failed',error:'缺基底'});
    await assert.rejects(initializeSample(f.args),e=>e.phase==='verify'&&e.message.includes('缺基底'));assert.equal(f.calls.some(c=>c[0]==='verify'),false);
});

test('磁盘回读失败或切卡时保持部分成功错误，不再写入',async()=>{
    for(const kind of ['throw','false','switch','frame-change']){
        const f=fixture();f.args.verifySave=async()=>{if(kind==='throw')throw new Error('磁盘不一致');if(kind==='false')return false;if(kind==='switch')f.state.chatId='other';if(kind==='frame-change')f.state.chat[0].TavernDB_ACU_IsolatedData[''].storageFrame.logEntries.push({seq:1});};
        await assert.rejects(initializeSample(f.args),e=>e.phase==='verify'&&e.mayHaveWritten);assert.equal(f.phases.includes('complete'),false);
    }
});

test('同一时间仅允许一次初始化，取消后释放锁',async()=>{
    const f=fixture();let resolve;f.args.confirm=()=>new Promise(r=>resolve=r);const pending=initializeSample(f.args);
    await assert.rejects(initializeSample(fixture().args),/正在进行/);resolve(false);await pending;
    assert.equal((await initializeSample(fixture().args)).status,'complete');
});
