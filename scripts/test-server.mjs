/** テスト専用。worktree内のgameだけを配信し、他スレッドのサーバーを再利用しない。 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../game/', import.meta.url));
const port = Number(process.env.CDG_TEST_PORT || 18080);
const types = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.csv': 'text/csv; charset=utf-8',
    '.json': 'application/json', '.webmanifest': 'application/manifest+json',
    '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon'
};

createServer(async (req, res) => {
    if (!['GET', 'HEAD'].includes(req.method)) {
        res.writeHead(405); res.end(); return;
    }
    try {
        const pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
        const path = resolve(root, pathname.replace(/^\/+/, '') || 'index.html');
        if (!path.startsWith(root.endsWith(sep) ? root : root + sep)) {
            res.writeHead(403); res.end(); return;
        }
        const body = await readFile(path);
        res.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
        res.end(req.method === 'HEAD' ? undefined : body);
    } catch {
        res.writeHead(404); res.end('Not found');
    }
}).listen(port, '127.0.0.1', () => console.log(`Test server: http://127.0.0.1:${port}`));
