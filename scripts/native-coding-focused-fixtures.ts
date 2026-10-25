/** Frozen, synthetic inputs. Reference code and independent tests stay with the evaluator. */
export type FocusedFixture = { id: string; prompt: string; files: Record<string, string>; referenceFiles: Record<string, string>; independent: string; testCommand: string; provenance: string }
const packageFile = '{"private":true,"type":"module"}\n'
const recovery = `export async function runBatch(initial, io, options) {
  const state = structuredClone(initial);
  state.status = 'running';
  while (state.step < options.maxSteps && io.now() < options.deadline) {
    try {
      const value = await io.request({step:state.step, retry:state.recoveries});
      state.attempts.push('completed'); state.results.push(value);
      state.step++; state.recoveries = 0;
    } catch (error) {
      state.attempts.push('failed');
      if (error.kind === 'delivery_unknown') { state.status = 'waiting_confirmation'; await io.save(state); return state; }
      if (error.kind !== 'invalid_output' || state.recoveries >= options.maxRetries) { state.status = 'failed'; await io.save(state); return state; }
      state.recoveries++;
    }
    await io.save(state);
  }
  state.status = state.step >= options.maxSteps ? 'completed' : 'paused';
  await io.save(state); return state;
}
`
const initial = `({status:'running',step:0,recoveries:0,results:[],attempts:[]})`
const recoveryTests = `import {test} from 'node:test'; import assert from 'node:assert/strict'; import {runBatch} from './runner.js';
const start=()=>${initial};
const options={maxSteps:3,maxRetries:2,deadline:10};
test('bounded recovery finishes before pausing new steps at the time boundary',async()=>{
 let time=0,calls=0;const saved=[];
 const io={now:()=>time,save:async s=>saved.push(structuredClone(s)),request:async()=>{calls++;if(calls===2||calls===3){time=11;throw {kind:'invalid_output'};}return calls;}};
 const state=await runBatch(start(),io,options);
 assert.equal(calls,4);assert.equal(state.status,'paused');assert.equal(state.step,2);assert.equal(state.recoveries,0);
 assert.deepEqual(state.attempts,['completed','failed','failed','completed']);assert.deepEqual(state.results,[1,4]);assert.deepEqual(saved.at(-1),state);
 const restarted=await runBatch(saved.at(-1),io,options);assert.equal(calls,4);assert.equal(restarted.status,'paused');
});
test('restored in-progress recovery remains bounded after the deadline',async()=>{
 const state={...start(),step:1,recoveries:1,results:['done'],attempts:['completed','failed']};let calls=0;
 const result=await runBatch(state,{now:()=>11,save:async()=>{},request:async()=>{calls++;return 'recovered';}},options);
 assert.equal(calls,1);assert.equal(result.status,'paused');assert.equal(result.step,2);assert.deepEqual(result.results,['done','recovered']);
});
test('recovery exhaustion cannot loop forever beyond the deadline',async()=>{
 let time=0,calls=0;const result=await runBatch(start(),{now:()=>time,save:async()=>{},request:async()=>{calls++;time=11;throw {kind:'invalid_output'};}},options);
 assert.equal(calls,3);assert.equal(result.status,'failed');assert.equal(result.step,0);assert.equal(result.recoveries,2);
});
test('unknown delivery requires confirmation and is never automatically replayed',async()=>{
 let calls=0;const result=await runBatch(start(),{now:()=>0,save:async()=>{},request:async()=>{calls++;throw {kind:'delivery_unknown'};}},options);
 assert.equal(calls,1);assert.equal(result.status,'waiting_confirmation');assert.equal(result.recoveries,0);
});
test('an expired batch without pending recovery starts no work',async()=>{
 let calls=0;const result=await runBatch(start(),{now:()=>11,save:async()=>{},request:async()=>{calls++;return 1;}},options);
 assert.equal(calls,0);assert.equal(result.status,'paused');
});
test('ordinary successful steps retain the original contract',async()=>{
 let calls=0;const input=start();const result=await runBatch(input,{now:()=>0,save:async()=>{},request:async()=>++calls},options);
 assert.equal(calls,3);assert.equal(result.status,'completed');assert.deepEqual(result.results,[1,2,3]);assert.deepEqual(input,start());
});
`

const deepFiles: Record<string, string> = {
  'package.json': packageFile,
  'app.js': "import {calculate} from './packages/domain/cart/pricing/region/retail/current/implementation/calculate.js';\nimport {settings} from './config.js';\nexport function checkout(items){if(items.length===0)return 0;return calculate(items,settings);}\n",
  'config.js': 'export const settings = {freeShippingThreshold:100,shippingFee:5};\n',
  'packages/domain/cart/pricing/region/retail/current/implementation/calculate.js': 'export function calculate(items,settings){const subtotal=items.reduce((sum,item)=>sum+item.price,0);return subtotal+(subtotal>=settings.freeShippingThreshold?0:settings.shippingFee);}\n',
  'app.test.js': "import {test} from 'node:test';import assert from 'node:assert/strict';import {checkout} from './app.js';test('checkout is positive',()=>assert.ok(Number(checkout([{price:10,quantity:1}]))>0));\n",
}
for (let index = 0; index < 600; index++) deepFiles[`aa_decoys/group-${String(Math.floor(index / 20)).padStart(2, '0')}/record-${String(index).padStart(4, '0')}.js`] = `export const fixtureRecord${index} = ${index};\n`

export const focusedFixtures: FocusedFixture[] = [
  { id: 'recovery', provenance: 'New minimal development fixture derived from devflow-history-02 / d219017; not a replay of the historical 81-assertion full repository task.',
    files: { 'package.json': packageFile, 'runner.js': recovery,
      'runner.test.js': `import {test} from 'node:test';import assert from 'node:assert/strict';import {runBatch} from './runner.js';test('one ordinary step',async()=>{const result=await runBatch(${initial},{now:()=>0,request:async()=>7,save:async()=>{}},{maxSteps:1,maxRetries:2,deadline:10});assert.equal(result.status,'completed');assert.deepEqual(result.results,[7]);});\n` },
    referenceFiles: { 'runner.js': recovery.replace('io.now() < options.deadline', '(state.recoveries > 0 || io.now() < options.deadline)') },
    independent: recoveryTests, testCommand: 'node --test runner.test.js',
    prompt: '修复 runBatch 的时间边界问题：已收到但无效的输出允许当前步骤最多 maxRetries 次恢复尝试；批次时间到达时，应完成当前正在进行的有界恢复并保存状态，再暂停新步骤。已有成功步骤不得重放；delivery_unknown 仍须等待人工确认，不得自动重发；恢复次数耗尽必须失败，不能无限循环。保留输入不变及现有接口、测试与其他正常行为。只修改实现，不修改测试或配置。',
  },
  { id: 'deep', provenance: 'Same synthetic 605-file/eight-level cart behavior used by the earlier deep investigation; this run evaluates Native v3 only.',
    files: deepFiles, referenceFiles: {
      'app.js': deepFiles['app.js']!.replace('return 0;', "return '0.00';").replace('return calculate(items,settings);', 'return calculate(items,settings).toFixed(2);'),
      'config.js': deepFiles['config.js']!.replace('100','50'),
      'packages/domain/cart/pricing/region/retail/current/implementation/calculate.js': deepFiles['packages/domain/cart/pricing/region/retail/current/implementation/calculate.js']!.replace('sum+item.price','sum+item.price*item.quantity'),
    }, testCommand: 'node --test app.test.js',
    prompt: '购物车结算有三个问题需要一并修复：商品数量大于 1 时总价错误；业务规定商品小计满 50 元免运费，目前仍收运费；checkout API 应返回保留两位小数的金额字符串，空购物车应返回 "0.00"。找到实际调用链、配置和实现，修复这三个问题。保留原有接口名称，不改测试或配置文件格式。',
    independent: `import {test} from 'node:test';import assert from 'node:assert/strict';import {checkout} from './app.js';
test('quantity and shipping',()=>assert.equal(checkout([{price:12,quantity:2}]),'29.00'));
test('new free shipping threshold',()=>assert.equal(checkout([{price:30,quantity:2}]),'60.00'));
test('empty cart',()=>assert.equal(checkout([]),'0.00'));
test('exact free shipping boundary',()=>assert.equal(checkout([{price:25,quantity:2}]),'50.00'));
test('two decimal places',()=>assert.equal(checkout([{price:1.125,quantity:2}]),'7.25'));
`,
  },
]
