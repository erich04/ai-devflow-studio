// @vitest-environment node
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { createRepositoryKnowledgeService } from '../apps/desktop/electron/repository-knowledge'
import { parseKnowledgeModel } from '../packages/shared/src/hindsight'
import { createHindsightTodoFixture } from './hindsight-todo-fixture'

const execute = promisify(execFile)
const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('isolated Hindsight Todo fixture', () => {
  it('starts from the original working Todo with bulk cleanup still unimplemented', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'hindsight-todo-fixture-'))
    roots.push(root)
    const fixture = await createHindsightTodoFixture(path.join(root, 'project'))
    expect(fixture.sourceCommit).toBe('c2be68d6c4a03fc219c483acc79a90fdf6e11ab6')
    const { stdout } = await execute(process.execPath, ['--input-type=module', '-e', `
      import assert from 'node:assert/strict';
      import { createStore, STORAGE_KEY } from './src/store.js';
      const values = new Map();
      const storage = { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value) };
      const store = createStore(storage);
      const first = store.addTask('保留任务').task;
      const second = store.addTask('已经完成').task;
      store.toggleTask(second.id);
      assert.equal(STORAGE_KEY, 'tasklist.tasks.v1');
      assert.equal(store.clearCompleted, undefined);
      assert.equal(store.listTasks().length, 2);
      assert.equal(createStore(storage).listTasks()[0].id, first.id);
      console.log('baseline-task-behaviour-passed');
    `], { cwd: fixture.repositoryPath })
    expect(stdout).toContain('baseline-task-behaviour-passed')
    expect(JSON.parse(await readFile(path.join(fixture.repositoryPath, 'package.json'), 'utf8')).dependencies).toBeUndefined()
    expect((await execute('git', ['status', '--porcelain'], { cwd: fixture.repositoryPath })).stdout).toBe('')
  })

  it('exports six selected knowledge documents while keeping the thirty questions and answers outside the project', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'hindsight-todo-knowledge-'))
    roots.push(root)
    const fixture = await createHindsightTodoFixture(path.join(root, 'project'))
    expect(fixture.selectedPaths).toHaveLength(6)
    expect(fixture.corpus.questions).toHaveLength(30)
    expect(new Set(fixture.corpus.questions.map((question) => question.id)).size).toBe(30)
    const tracked = (await execute('git', ['ls-files'], { cwd: fixture.repositoryPath })).stdout.split('\n')
    expect(tracked.filter((file) => file.startsWith('docs/knowledge/') && file.endsWith('.md')).sort())
      .toEqual([...fixture.selectedPaths].sort())
    expect(tracked).not.toContain('questions.json')
    expect(tracked).not.toContain('acceptance.json')
    expect(tracked).toContain('docs/knowledge/model.json')
    for (const question of fixture.corpus.questions) {
      for (const expected of question.expectedPaths) expect(fixture.selectedPaths).toContain(expected)
    }
    const terminology = await readFile(path.join(fixture.repositoryPath, 'docs/knowledge/task-domain.md'), 'utf8')
    expect(terminology).toContain('createdAt')
    expect(terminology).toContain('不是完成时间')
    const snapshot = await createRepositoryKnowledgeService().index({
      id: 'todo-fixture', name: 'Todo fixture', path: fixture.repositoryPath, packageManager: 'npm',
      testCommand: 'npm test', createdAt: '2026-10-20T00:00:00.000Z', updatedAt: '2026-10-20T00:00:00.000Z',
    })
    expect(snapshot.documents.map((document) => document.sourcePath).sort()).toEqual([...fixture.selectedPaths].sort())
    expect(snapshot.warnings).toEqual([])
    expect(parseKnowledgeModel(JSON.parse(await readFile(path.join(fixture.repositoryPath, fixture.modelPath), 'utf8'))).version)
      .toBe('todo-synthetic-v1')
    await expect(createHindsightTodoFixture(fixture.repositoryPath)).rejects.toMatchObject({ code: 'EEXIST' })
  })
})
