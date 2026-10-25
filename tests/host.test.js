import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyHostSave } from '../host.js';
import { KEY } from '../core.js';

function fixture() {
    const state={characterId:0,groupId:null,chatId:'isolated-chat',characters:[{name:'隔离角色',avatar:'isolated.png'}],
        chatMetadata:{[KEY]:{version:1,id:'adapter'}},
        chat:[{mes:'开场',swipe_id:0,swipes:['开场'],TavernDB_ACU_IsolatedData:{'':{storageFrame:{version:2,headRevision:'1',logEntries:[]}}}}]};
    return {state,getContext:()=>({...state,getRequestHeaders:()=>({'X-Test-CSRF':'isolated-token'})}),
        disk:()=>structuredClone([{chat_metadata:state.chatMetadata},...state.chat])};
}
const response=data=>({ok:true,status:200,json:async()=>data});
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};}

test('磁盘一致返回明确覆盖范围，回读只发POST读取且带身份与宿主headers',async()=>{
    const f=fixture(),before=structuredClone(f.state);let calls=0;
    const result=await verifyHostSave(f.getContext,async(url,options)=>{
        calls++;assert.equal(url,'/api/chats/get');assert.equal(options.method,'POST');assert.equal(options.cache,'no-store');
        assert.equal(options.headers['X-Test-CSRF'],'isolated-token');
        assert.deepEqual(JSON.parse(options.body),{ch_name:'隔离角色',avatar_url:'isolated.png',file_name:'isolated-chat'});
        return response(f.disk());
    });
    assert.equal(calls,1);assert.equal(result.chatId,'isolated-chat');assert.equal(result.messageCount,1);
    assert.deepEqual(result.coverage,['正文与swipe','数据库消息帧','适配配置']);assert.deepEqual(f.state,before);
});

test('HTTP失败、网络异常、无效JSON都拒绝保存确认',async()=>{
    const f=fixture();let bodyRead=false;
    await assert.rejects(verifyHostSave(f.getContext,async()=>({ok:false,status:503,json:async()=>{bodyRead=true;}})),/HTTP 503/);
    assert.equal(bodyRead,false);
    await assert.rejects(verifyHostSave(f.getContext,async()=>{throw new Error('offline');}),/offline/);
    await assert.rejects(verifyHostSave(f.getContext,async()=>({ok:true,json:async()=>{throw new SyntaxError('invalid json');}})),/invalid json/);
});

for(const kind of ['text','swipe','versions','frames','missing-message'])test(`磁盘${kind}不一致拒绝确认`,async()=>{
    const f=fixture(),disk=f.disk();
    if(kind==='text')disk[1].mes='旧正文';
    if(kind==='swipe')disk[1].swipe_id=1;
    if(kind==='versions')disk[1].swipes=['不同版本'];
    if(kind==='frames')disk[1].TavernDB_ACU_IsolatedData[''].storageFrame.headRevision='older';
    if(kind==='missing-message')disk.pop();
    await assert.rejects(verifyHostSave(f.getContext,async()=>response(disk)),/正文、回复版本或数据库帧/);
});

test('磁盘适配配置不一致或缺失拒绝确认',async()=>{
    for(const replacement of [{version:1,id:'older'},undefined]){
        const f=fixture(),disk=f.disk();disk[0].chat_metadata[KEY]=replacement;
        await assert.rejects(verifyHostSave(f.getContext,async()=>response(disk)),/磁盘适配配置/);
    }
});

test('无有效聊天文件、无角色身份或群聊不伪装成功',async()=>{
    for(const data of [null,{},[],[{}]]){
        const f=fixture();await assert.rejects(verifyHostSave(f.getContext,async()=>response(data)),/有效聊天文件/);
    }
    for(const mutate of [s=>s.chatId='',s=>s.groupId='group',s=>s.characters=[]]){
        const f=fixture();mutate(f.state);let reads=0;
        await assert.rejects(verifyHostSave(f.getContext,async()=>{reads++;return response(f.disk());}));assert.equal(reads,0);
    }
});

for(const kind of ['chat-id','character','new-array','body','frame','config'])test(`回读等待期间${kind}变化拒绝过期结果`,async()=>{
    const f=fixture(),pending=deferred(),disk=f.disk();
    const promise=verifyHostSave(f.getContext,()=>pending.promise);
    if(kind==='chat-id')f.state.chatId='another-chat';
    if(kind==='character')f.state.characterId=1;
    if(kind==='new-array')f.state.chat=structuredClone(f.state.chat);
    if(kind==='body')f.state.chat[0].mes='edited';
    if(kind==='frame')f.state.chat[0].TavernDB_ACU_IsolatedData[''].storageFrame.headRevision='next';
    if(kind==='config')f.state.chatMetadata[KEY].id='new-adapter';
    pending.resolve(response(disk));await assert.rejects(promise,/结果已丢弃/);
});

test('响应JSON解析等待期间切聊天也丢弃结果',async()=>{
    const f=fixture(),pending=deferred(),disk=f.disk();let started;
    const jsonStarted=new Promise(r=>started=r);
    const promise=verifyHostSave(f.getContext,async()=>({ok:true,json:()=>{started();return pending.promise;}}));
    await jsonStarted;f.state.chatId='new-chat';pending.resolve(disk);
    await assert.rejects(promise,/结果已丢弃/);
});
