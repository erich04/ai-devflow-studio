import { createStore } from './store.js';
import { createView } from './dom.js';

function createMemoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => {
      map.set(key, String(value));
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

function resolveStorage() {
  try {
    const probeKey = '__tasklist_probe__';
    window.localStorage.setItem(probeKey, '1');
    window.localStorage.removeItem(probeKey);
    return { storage: window.localStorage, persistent: true };
  } catch {
    return { storage: createMemoryStorage(), persistent: false };
  }
}

const { storage, persistent } = resolveStorage();
const store = createStore(storage);

createView({
  document,
  store,
  elements: {
    form: document.getElementById('task-form'),
    input: document.getElementById('task-input'),
    message: document.getElementById('message'),
    list: document.getElementById('task-list'),
    emptyState: document.getElementById('empty-state'),
  },
});

if (!persistent) {
  const warning = document.getElementById('storage-warning');
  if (warning) {
    warning.textContent = '当前浏览器无法保存数据，刷新后内容会丢失';
  }
}
