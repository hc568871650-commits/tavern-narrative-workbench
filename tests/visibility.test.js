import test from 'node:test';
import assert from 'node:assert/strict';
import { visibleChanges } from '../actions.js';
test('玩家变化摘要不会泄漏筛选隐藏、已移除或未知的记录',()=>{
    const changes=[
        {id:JSON.stringify(['inventory','mine','quantity'])},
        {id:JSON.stringify(['inventory','secret','quantity'])},
        {id:JSON.stringify(['inventory','removed','quantity'])},
        {id:'malformed'},
    ];
    assert.deepEqual(visibleChanges(changes,[{rows:[{id:JSON.stringify(['inventory','mine'])}]}]),[changes[0]]);
    assert.deepEqual(visibleChanges(changes,[]),[]);
});
