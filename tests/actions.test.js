import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateConfig, project } from '../core.js';
import { buildCatalog, composeAction, appendDraft } from '../actions.js';

const cfg=()=>({version:1,backend:'shujuku',id:'action-test',name:'操作样例',modules:[{id:'bag',label:'背包',enabled:true}],entities:[{
    id:'items',label:'持有物',module:'bag',sheet:{name:'物品'},keyColumn:'id',fields:[
        {id:'name',column:'name',label:'物品名',type:'text'},{id:'owner',column:'owner',label:'持有者',type:'text'},
        {id:'quantity',column:'quantity',label:'数量',type:'number',min:0},{id:'description',column:'description',label:'描述',type:'text'}],
    ui:{kind:'items',titleField:'name',quantityField:'quantity',descriptionField:'description',filter:{field:'owner',equals:'我'},actions:[
        {id:'give',label:'交给',template:'我把{quantity}个{name}交给{target}。',quantity:true,target:true},
        {id:'inspect',label:'查看',template:'我仔细检查{name}。'}]}}]});
const data=(rows=[['1','绷带','我',3,'干净的绷带'],['2','钥匙','他人',1,'一把铜钥匙']])=>({mate:{version:1},sheet_items:{uid:'items',name:'物品',content:[['id','name','owner','quantity','description'],...rows]}});
const catalog=(c=cfg(),d=data())=>buildCatalog(validateConfig(c),project(d,c));
const item=()=>catalog()[0].rows[0];

test('明确持有者筛选只展示本人库存，他人/缺持有者行不会泄漏进目录',()=>{
    const d=data([['1','绷带','我',3,''],['2','钥匙','他人',1,''],['3','失物',undefined,1,'']]);
    const result=catalog(cfg(),d);assert.deepEqual(result[0].rows.map(r=>r.name),['绷带']);
    assert.equal(result[0].rows[0].quantity,3);assert.equal(result[0].rows[0].id,JSON.stringify(['items','1']));
});

test('筛选严格匹配声明值，不做模糊名称或类型强转',()=>{
    const c=cfg();c.entities[0].ui.filter.equals='1';
    const d=data([['1','数值持有者',1,2,''],['2','文本持有者','1',2,''],['3','近似名称','01',2,'']]);
    assert.deepEqual(catalog(c,d)[0].rows.map(r=>r.name),['文本持有者']);
});

test('隐藏模块不产生目录或可用操作',()=>{const c=cfg();c.modules[0].enabled=false;assert.deepEqual(catalog(c),[]);});

test('物品视图缺少持有者筛选时拒绝，只有显式全部物品才允许全表',()=>{
    const c=cfg();delete c.entities[0].ui.filter;
    assert.throws(()=>validateConfig(c),/filter|筛选/);
    c.entities[0].ui.visibility='all';
    assert.deepEqual(catalog(c)[0].rows.map(r=>r.name),['绷带','钥匙']);
});

test('旧v1无ui保持status展示，不凭空创建物品操作',async()=>{
    for(const name of ['academy','starship']){
        const c=JSON.parse(await readFile(new URL(`../examples/${name}.json`,import.meta.url),'utf8'));
        for(const e of c.entities)delete e.ui;
        const d=JSON.parse(await readFile(new URL(`../examples/${name}.tables.json`,import.meta.url),'utf8'));
        const result=buildCatalog(validateConfig(c),project(d,c));
        for(const group of result){assert.equal(group.kind,'status');for(const row of group.rows)assert.deepEqual(row.actions,[]);}
    }
});

test('生成合法操作仅返回草稿字符串，不改输入物品/动作/数据库',()=>{
    const i=item(),before=structuredClone(i);
    assert.equal(composeAction(i,'give',2,'  同伴  '),'我把2个绷带交给同伴。');
    assert.deepEqual(i,before);
});

for(const quantity of [0,-1,4,1.5,NaN,Infinity,'2',undefined,Number.MAX_SAFE_INTEGER+1])test(`拒绝无效操作数量：${String(quantity)}`,()=>{
    assert.throws(()=>composeAction(item(),'give',quantity,'同伴'),/数量/);
});

test('库存为零、负数、NaN或Infinity时拒绝数量操作',()=>{
    for(const stock of [0,-1,NaN,Infinity]){const i=item();i.quantity=stock;assert.throws(()=>composeAction(i,'give',1,'同伴'),/数量/);}
});

test('目标必填、长度及单行校验；不带目标的检查动作可生成',()=>{
    for(const target of ['', '   ', null, '人'.repeat(101),'甲\n乙','甲\r乙'])assert.throws(()=>composeAction(item(),'give',1,target),/对象/);
    assert.equal(composeAction(item(),'give',1,'人'.repeat(100)).length>100,true);
    assert.equal(composeAction(item(),'inspect',undefined,undefined),'我仔细检查绷带。');
    assert.throws(()=>composeAction(item(),'removed',1,'同伴'),/不可用/);
});

test('未知变量、双括号、残缺括号、未启用输入的变量在配置导入时拒绝',()=>{
    for(const template of ['给{unknown}','给{{name}}','给{name','给name}','给{quantity}']){
        const c=cfg();c.entities[0].ui.actions[1].template=template;assert.throws(()=>validateConfig(c));
    }
    const c=cfg();c.entities[0].ui.actions[1].template='交给{target}';assert.throws(()=>validateConfig(c),/target/);
});

test('UI无效字段引用、筛选、重复动作及缺数量字段在配置导入时拒绝',()=>{
    for(const mutate of [u=>u.kind='unsupported',u=>u.titleField='missing',u=>u.filter={field:'missing',equals:'我'},
        u=>u.filter={field:'owner',equals:{}},u=>u.actions.push({...u.actions[0]}),u=>delete u.quantityField,
        u=>u.actions[0].quantity='yes',u=>u.actions[0].label='',u=>u.actions[0].template=' '.repeat(2)]){
        const c=cfg();mutate(c.entities[0].ui);assert.throws(()=>validateConfig(c));
    }
});

test('名称和目标含占位符/花括号/脚本文本不二次展开或执行',()=>{
    const i=item();i.name='{target} + {quantity} + ${globalThis.executed=true}';
    const result=composeAction(i,'give',1,'{name}');
    assert.equal(result,'我把1个{target} + {quantity} + ${globalThis.executed=true}交给{name}。');
    assert.equal(globalThis.executed,undefined);
});

test('保留原草稿全部内容并只追加一条换行；从不覆盖或发送',()=>{
    assert.equal(appendDraft('已有重要草稿','动作'),'已有重要草稿\n动作');
    assert.equal(appendDraft('已有草稿\n','动作'),'已有草稿\n动作');
    assert.equal(appendDraft('','动作'),'动作');
    assert.equal(appendDraft('/命令只是原始文本\n  保留空格','{name}'),'/命令只是原始文本\n  保留空格\n{name}');
});
