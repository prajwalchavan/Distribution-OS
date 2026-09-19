// Tiny static server for the production web export, with COOP/COEP (docs/26) and an SPA fallback.
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { join, extname, normalize } from 'node:path'
const ROOT = process.argv[2]
const PORT = Number(process.argv[3] ?? 5199)
const TYPES = { '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.wasm': 'application/wasm', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff2': 'font/woff2', '.ico': 'image/x-icon' }
createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')
  let p = join(ROOT, normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, ''))
  try {
    const s = await stat(p).catch(() => null)
    if (s === null || s.isDirectory()) p = join(ROOT, 'index.html')
    const body = await readFile(p)
    res.writeHead(200, {
      'content-type': TYPES[extname(p)] ?? 'application/octet-stream',
      'cross-origin-opener-policy': 'same-origin',
      'cross-origin-embedder-policy': 'require-corp',
      'cross-origin-resource-policy': 'same-origin',
      'cache-control': 'no-store',
    })
    res.end(body)
  } catch (e) {
    res.writeHead(500).end(String(e))
  }
}).listen(PORT, () => console.log(`serving ${ROOT} on http://localhost:${PORT} with COOP/COEP`))
