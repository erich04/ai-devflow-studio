export const STORAGE_KEY = 'tasklist.tasks.v1';
export const MAX_LENGTH = 200;

export function generateId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function sanitizeTask(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (typeof raw.id !== 'string' || raw.id.length === 0) return null;
  if (typeof raw.text !== 'string') return null;
  return {
    id: raw.id,
    text: raw.text,
    done: raw.done === true,
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : 0,
  };
}

export function createStore(storage, options = {}) {
  const key = options.key || STORAGE_KEY;
  const maxLength = typeof options.maxLength === 'number' ? options.maxLength : MAX_LENGTH;
  const idFactory = options.idFactory || generateId;

  function load() {
    let raw;
    try {
      raw = storage.getItem(key);
    } catch {
      return [];
    }
    if (raw === null || raw === undefined) return [];
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.map(sanitizeTask).filter((task) => task !== null);
    } catch {
      return [];
    }
  }

  let tasks = load();

  function persist() {
    try {
      storage.setItem(key, JSON.stringify(tasks));
    } catch {
      // 存储不可用时忽略写入错误，保持页面可用。
    }
  }

  function addTask(text) {
    const value = typeof text === 'string' ? text : '';
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return { ok: false, reason: 'empty' };
    }
    if (Array.from(trimmed).length > maxLength) {
      return { ok: false, reason: 'too-long' };
    }
    const task = {
      id: idFactory(),
      text: trimmed,
      done: false,
      createdAt: Date.now(),
    };
    tasks = tasks.concat(task);
    persist();
    return { ok: true, task: { ...task } };
  }

  function toggleTask(id) {
    const index = tasks.findIndex((task) => task.id === id);
    if (index === -1) {
      return { ok: false, reason: 'not-found' };
    }
    const updated = { ...tasks[index], done: !tasks[index].done };
    tasks = tasks.slice();
    tasks[index] = updated;
    persist();
    return { ok: true, task: { ...updated } };
  }

  function removeTask(id) {
    const index = tasks.findIndex((task) => task.id === id);
    if (index === -1) {
      return { ok: false, reason: 'not-found' };
    }
    tasks = tasks.filter((task) => task.id !== id);
    persist();
    return { ok: true };
  }

  function listTasks() {
    return tasks.map((task) => ({ ...task }));
  }

  return { addTask, toggleTask, removeTask, listTasks, load };
}
