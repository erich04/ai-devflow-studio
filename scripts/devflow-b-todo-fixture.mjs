import { mkdir, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
export const requestTitle = 'B 验证：Todo 清除已完成'
export const requestBody = `为合成 Todo 网页增加“清除已完成”按钮，保留未完成项的 id、text、done 和顺序。已有新增、完成切换、删除及刷新持久化必须保持。没有已完成项时按钮禁用，清空后仍可新增。输入是普通文本，不能解析HTML。新增自动化测试和简短说明。仅修改 index.html、src/store.js、src/app.js、test/store.test.js、README.md；不添加依赖，不提交或推送。需求与设计各控制在800汉字左右，完整保留验收条件。开发时请使用一个 devflow-worker 子任务实现 store 逻辑，并由子任务通过 question 工具询问“清除已完成后是否显示数量提示？”，选项为“显示数量”和“不显示”；回答后仍应遵守命令审批。父任务负责界面整合和核对。`
export async function createTodoFixture(directory) {
  await mkdir(path.join(directory, 'src'), { recursive: true }); await mkdir(path.join(directory, 'test'))
  const files = {
    'package.json': JSON.stringify({ name: 'devflow-b-todo', version: '1.0.0', type: 'module', scripts: { test: 'node --test' } }, null, 2),
    'package-lock.json': JSON.stringify({ name: 'devflow-b-todo', version: '1.0.0', lockfileVersion: 3, packages: { '': { name: 'devflow-b-todo', version: '1.0.0' } } }),
    '.gitignore': 'node_modules\n',
    'README.md': '# B synthetic Todo\n\nA disposable verification project. Run `npm test`; serve this folder with a local static server.\n',
    'AGENTS.md': '# Synthetic Todo\n\nPreserve localStorage key devflow-b-todo-v1 and stable task fields. No network or dependencies. Only npm test needs command approval. Do not commit or push.\n',
    'src/store.js': `export const addTask = (tasks, text, id) => [...tasks, { id, text: text.trim(), done: false }];\nexport const toggleTask = (tasks, id) => tasks.map(t => t.id === id ? { ...t, done: !t.done } : t);\nexport const deleteTask = (tasks, id) => tasks.filter(t => t.id !== id);\n`,
    'src/app.js': `import { addTask, toggleTask, deleteTask } from './store.js';\nconst key='devflow-b-todo-v1'; let tasks; try { tasks=JSON.parse(localStorage.getItem(key)||'[]'); if(!Array.isArray(tasks)) tasks=[]; } catch { tasks=[]; }\nconst list=document.querySelector('#tasks'); const form=document.querySelector('form'); const input=document.querySelector('#new-task');\nfunction save(){ localStorage.setItem(key,JSON.stringify(tasks)); render(); }\nfunction render(){ list.replaceChildren(); for(const task of tasks){ const li=document.createElement('li'); const label=document.createElement('label'); const check=document.createElement('input'); check.type='checkbox'; check.checked=task.done; check.addEventListener('change',()=>{ tasks=toggleTask(tasks,task.id); save(); }); label.append(check,document.createTextNode(task.text)); const remove=document.createElement('button'); remove.textContent='删除'; remove.setAttribute('aria-label','删除'+task.text); remove.addEventListener('click',()=>{tasks=deleteTask(tasks,task.id);save();}); li.append(label,remove);list.append(li); }}\nform.addEventListener('submit',event=>{event.preventDefault();if(!input.value.trim())return;tasks=addTask(tasks,input.value,crypto.randomUUID());input.value='';save();});render();\n`,
    'index.html': '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>B 合成 Todo</title><h1>任务清单</h1><form><label for="new-task">新任务</label><input id="new-task"><button>新增</button></form><ul id="tasks"></ul><script type="module" src="src/app.js"></script></html>\n',
    'test/store.test.js': `import test from 'node:test'; import assert from 'node:assert/strict'; import {addTask,toggleTask,deleteTask} from '../src/store.js';\ntest('add trim, toggle and delete',()=>{let items=addTask([], ' 中文任务 ', 'a'); assert.deepEqual(items,[{id:'a',text:'中文任务',done:false}]);items=toggleTask(items,'a');assert.equal(items[0].done,true);assert.deepEqual(deleteTask(items,'a'),[]);});\n`,
  }
  for (const [name, content] of Object.entries(files)) await writeFile(path.join(directory, name), content)
  const git = args => execFileSync('git', args, { cwd: directory, stdio: 'ignore' })
  git(['init', '-b', 'main']); git(['add', '.']); git(['-c', 'user.name=B Verification', '-c', 'user.email=b-verification@example.invalid', 'commit', '-m', 'Initialize synthetic Todo baseline'])
}
