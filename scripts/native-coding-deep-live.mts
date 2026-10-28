import { mkdir, writeFile, readFile, access } from 'node:fs/promises'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { runLiveTrial } from './native-coding-trial-live.mts'
import { saveJson, digest } from './native-coding-live-support.ts'

if (process.env.DEVFLOW_NATIVE_EVALUATION_ROUND) throw new Error('The legacy three-engine deep entry is excluded from this guarded CNY round')
const [outputPath, keyPath] = process.argv.slice(2)
if (!outputPath || !keyPath) throw new Error('Usage: deep-live <new-output> <private-key-file>')
const root = path.resolve(outputPath); await mkdir(root)
const apiKey = (await readFile(keyPath, 'utf8')).trim()
const files: Record<string, string> = {
  'package.json': '{"private":true,"type":"module"}\n',
  'app.js': "import {calculate} from './packages/domain/cart/pricing/region/retail/current/implementation/calculate.js';\nimport {settings} from './config.js';\nexport function checkout(items){if(items.length===0)return 0;return calculate(items,settings);}\n",
  'config.js': 'export const settings = {freeShippingThreshold:100,shippingFee:5};\n',
  'packages/domain/cart/pricing/region/retail/current/implementation/calculate.js': 'export function calculate(items,settings){const subtotal=items.reduce((sum,item)=>sum+item.price,0);return subtotal+(subtotal>=settings.freeShippingThreshold?0:settings.shippingFee);}\n',
  'app.test.js': "import {test} from 'node:test';import assert from 'node:assert/strict';import {checkout} from './app.js';test('checkout is positive',()=>assert.ok(Number(checkout([{price:10,quantity:1}]))>0));\n",
}
for (let index = 0; index < 600; index++) files[`aa_decoys/group-${String(Math.floor(index / 20)).padStart(2, '0')}/record-${String(index).padStart(4, '0')}.js`] = `export const fixtureRecord${index} = ${index};\n`
const prompt = '购物车结算有三个问题需要一并修复：商品数量大于 1 时总价错误；业务规定商品小计满 50 元免运费，目前仍收运费；checkout API 应返回保留两位小数的金额字符串，空购物车应返回 "0.00"。找到实际调用链、配置和实现，修复这三个问题。保留原有接口名称，不改测试。'
const independent = "import assert from 'node:assert/strict';import {checkout} from './app.js';assert.equal(checkout([{price:12,quantity:2}]),'29.00');assert.equal(checkout([{price:30,quantity:2}]),'60.00');assert.equal(checkout([]),'0.00');"
await saveJson(path.join(root, 'frozen.json'), { at: new Date().toISOString(), model: 'deepseek-flash', candidateCommit: execFileSync('git', ['rev-parse', 'HEAD']).toString().trim(), fileCount: Object.keys(files).length, maximumDirectoryDepth: 8, filesDigest: digest(JSON.stringify(files)), prompt, independentDigest: digest(independent), engines: ['native-v2', 'native-v3', 'opencode'] })
const results: Array<Record<string, unknown>> = []
for (const engine of ['native-v2', 'native-v3', 'opencode'] as const) {
  const repository = path.join(root, `${engine}-repository`); await mkdir(repository)
  for (const [file, content] of Object.entries(files)) { await mkdir(path.dirname(path.join(repository, file)), { recursive: true }); await writeFile(path.join(repository, file), content) }
  for (const args of [['init', '-b', 'main'], ['config', 'user.name', 'Evaluation'], ['config', 'user.email', 'eval@example.invalid'], ['add', '.'], ['commit', '-m', 'Frozen deep investigation fixture']]) execFileSync('git', args, { cwd: repository, stdio: 'ignore' })
  const output = path.join(root, engine)
  await runLiveTrial({ id: 'deep-investigation', engine, repository, output, prompt, testCommand: 'node --test app.test.js', maxCalls: 192, maxCostUsd: 100, maxSteps: 80, maxActiveMilliseconds: 900000, maxOutputTokens: 16384, opencodeBinary: '/opt/homebrew/bin/opencode' }, apiKey)
  const trial = JSON.parse(await readFile(path.join(output, 'trial.json'), 'utf8'))
  let passed = false, failure: string | undefined
  let workspace = repository
  if (trial.workspace) { try { await access(trial.workspace); workspace = trial.workspace } catch {} }
  try { execFileSync(process.execPath, ['--input-type=module', '-e', independent], { cwd: workspace, stdio: 'pipe' }); passed = true }
  catch (error) { failure = error instanceof Error ? error.message.slice(0, 800) : 'independent failure' }
  results.push({ engine, passed, failure, status: trial.status, costUsd: trial.costUsd, metrics: trial.metrics })
  await saveJson(path.join(root, 'results.json'), results)
  console.log(JSON.stringify(results.at(-1)))
}
