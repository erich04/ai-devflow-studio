import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HOST = '127.0.0.1';
const DEFAULT_PORT = 5173;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
};

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const defaultRoot = path.resolve(currentDir, '..');

function sendNotFound(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('404 未找到');
}

export function createServer(rootDir = defaultRoot) {
  const root = path.resolve(rootDir);

  return http.createServer(async (req, res) => {
    try {
      const rawPath = (req.url || '/').split('?')[0];
      const decodedPath = decodeURIComponent(rawPath);

      if (decodedPath.includes('..') || decodedPath.includes('\0')) {
        sendNotFound(res);
        return;
      }

      const relativePath = decodedPath.replace(/^\/+/, '') || 'index.html';
      const filePath = path.resolve(root, relativePath);

      if (filePath !== root && !filePath.startsWith(root + path.sep)) {
        sendNotFound(res);
        return;
      }

      const info = await stat(filePath).catch(() => null);
      if (!info || !info.isFile()) {
        sendNotFound(res);
        return;
      }

      const data = await readFile(filePath);
      const type = MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type });
      res.end(data);
    } catch {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('500 服务器内部错误');
    }
  });
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const port = Number(process.env.PORT) || DEFAULT_PORT;
  createServer().listen(port, HOST, () => {
    console.log(`开发服务器已启动：http://${HOST}:${port}`);
  });
}
