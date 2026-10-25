import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createServer } from '../scripts/dev-server.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

test('开发服务器：/ 返回首页且为 HTML', async () => {
  const server = createServer(projectRoot);
  const base = await listen(server);
  try {
    const response = await fetch(`${base}/`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') || '', /text\/html/);
    const body = await response.text();
    assert.match(body, /任务清单/);
  } finally {
    server.close();
  }
});

test('开发服务器：模块脚本以 text/javascript 返回', async () => {
  const server = createServer(projectRoot);
  const base = await listen(server);
  try {
    const response = await fetch(`${base}/src/app.js`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'text/javascript; charset=utf-8');
  } finally {
    server.close();
  }
});

test('开发服务器：路径穿越请求返回 404', async () => {
  const server = createServer(projectRoot);
  const base = await listen(server);
  try {
    const response = await fetch(`${base}/..%2fpackage.json`);
    assert.equal(response.status, 404);
  } finally {
    server.close();
  }
});

test('开发服务器：未命中路径返回 404', async () => {
  const server = createServer(projectRoot);
  const base = await listen(server);
  try {
    const response = await fetch(`${base}/does-not-exist.js`);
    assert.equal(response.status, 404);
  } finally {
    server.close();
  }
});
