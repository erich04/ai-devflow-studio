import test from 'node:test';
import assert from 'node:assert/strict';

import { createStore, STORAGE_KEY } from '../src/store.js';

class MemoryStorage {
  #map = new Map();

  getItem(key) {
    return this.#map.has(key) ? this.#map.get(key) : null;
  }

  setItem(key, value) {
    this.#map.set(key, String(value));
  }

  removeItem(key) {
    this.#map.delete(key);
  }
}

function setup() {
  const storage = new MemoryStorage();
  const store = createStore(storage);
  return { storage, store };
}

test('新增任务：返回成功并出现在列表，默认未完成', () => {
  const { store } = setup();
  const result = store.addTask('写周报');

  assert.equal(result.ok, true);
  assert.equal(result.task.text, '写周报');
  assert.equal(result.task.done, false);

  const tasks = store.listTasks();
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].text, '写周报');
  assert.equal(tasks[0].done, false);
});

test('新增任务：按创建顺序排列', () => {
  const { store } = setup();
  store.addTask('第一项');
  store.addTask('第二项');
  store.addTask('第三项');

  assert.deepEqual(
    store.listTasks().map((task) => task.text),
    ['第一项', '第二项', '第三项'],
  );
});

test('无效输入：空白内容被拒绝且列表不变', () => {
  const { store } = setup();
  store.addTask('已有任务');

  for (const value of ['', '   ', '\t\n', '  \t  ']) {
    const result = store.addTask(value);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'empty');
  }

  assert.equal(store.listTasks().length, 1);
});

test('无效输入：超过 200 个字符被拒绝，边界值可通过', () => {
  const { store } = setup();

  const text200 = '字'.repeat(200);
  const text201 = '字'.repeat(201);

  const okBoundary = store.addTask(text200);
  assert.equal(okBoundary.ok, true);
  assert.equal(okBoundary.task.text.length, 200);

  const tooLong = store.addTask(text201);
  assert.equal(tooLong.ok, false);
  assert.equal(tooLong.reason, 'too-long');

  const padded = `  ${'字'.repeat(200)}  `;
  const trimmedOk = store.addTask(padded);
  assert.equal(trimmedOk.ok, true);
  assert.equal(trimmedOk.task.text.length, 200);

  assert.equal(store.listTasks().length, 2);
});

test('切换完成：标记完成与取消完成可双向切换', () => {
  const { store } = setup();
  const { task } = store.addTask('买牛奶');

  const done = store.toggleTask(task.id);
  assert.equal(done.ok, true);
  assert.equal(store.listTasks()[0].done, true);

  const undone = store.toggleTask(task.id);
  assert.equal(undone.ok, true);
  assert.equal(store.listTasks()[0].done, false);
});

test('删除任务：删除后不再出现在列表，其余顺序不变', () => {
  const { store } = setup();
  const first = store.addTask('第一项');
  const second = store.addTask('第二项');
  const third = store.addTask('第三项');

  const removed = store.removeTask(second.task.id);
  assert.equal(removed.ok, true);
  assert.deepEqual(
    store.listTasks().map((task) => task.text),
    ['第一项', '第三项'],
  );
  assert.equal(store.listTasks().some((task) => task.id === second.task.id), false);
  assert.equal(first.ok, true);
  assert.equal(third.ok, true);
});

test('存储恢复：使用同一存储新建 store 后内容保持一致', () => {
  const { storage, store } = setup();
  store.addTask('买牛奶');
  const milk = store.addTask('写周报');
  store.toggleTask(milk.task.id);

  const restored = createStore(storage);
  const tasks = restored.listTasks();

  assert.deepEqual(
    tasks.map((task) => task.text),
    ['买牛奶', '写周报'],
  );
  assert.deepEqual(
    tasks.map((task) => task.done),
    [false, true],
  );
});

test('存储恢复：已删除任务在重新载入后不重现', () => {
  const { storage, store } = setup();
  store.addTask('保留项');
  const removed = store.addTask('删除项');
  store.removeTask(removed.task.id);

  const restored = createStore(storage);
  assert.deepEqual(
    restored.listTasks().map((task) => task.text),
    ['保留项'],
  );
});

test('坏数据容错：非法 JSON 或非数组结构回退为空列表且不抛异常', () => {
  for (const bad of ['not-json', '{"a":1}', '123', 'null']) {
    const storage = new MemoryStorage();
    storage.setItem(STORAGE_KEY, bad);
    const store = createStore(storage);
    assert.deepEqual(store.listTasks(), []);
  }
});

test('坏数据容错：数组中的非法项被安全过滤', () => {
  const storage = new MemoryStorage();
  storage.setItem(
    STORAGE_KEY,
    JSON.stringify([
      { id: 'a', text: '合法项', done: false, createdAt: 1 },
      { text: '缺少 id' },
      null,
      { id: 'b', text: 42 },
    ]),
  );

  const store = createStore(storage);
  assert.deepEqual(
    store.listTasks().map((task) => task.text),
    ['合法项'],
  );
});

test('不存在 id：切换与删除返回 not-found 且不改变列表', () => {
  const { store } = setup();
  store.addTask('唯一任务');

  const toggled = store.toggleTask('不存在');
  assert.equal(toggled.ok, false);
  assert.equal(toggled.reason, 'not-found');

  const removed = store.removeTask('不存在');
  assert.equal(removed.ok, false);
  assert.equal(removed.reason, 'not-found');

  assert.equal(store.listTasks().length, 1);
});

test('存储不可用：读取抛异常时回退为空列表，写入抛异常不影响内存状态', () => {
  const failing = {
    getItem() {
      throw new Error('storage 不可用');
    },
    setItem() {
      throw new Error('storage 不可用');
    },
    removeItem() {
      throw new Error('storage 不可用');
    },
  };

  const store = createStore(failing);
  assert.deepEqual(store.listTasks(), []);

  const result = store.addTask('仍可新增');
  assert.equal(result.ok, true);
  assert.equal(store.listTasks().length, 1);
});

test('持久化写入：新增、切换、删除后使用同一存储可恢复最终状态', () => {
  const { storage, store } = setup();
  const first = store.addTask('第一项');
  const second = store.addTask('第二项');
  store.toggleTask(first.task.id);
  store.removeTask(second.task.id);

  const restored = createStore(storage);
  const tasks = restored.listTasks();

  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].text, '第一项');
  assert.equal(tasks[0].done, true);
});
