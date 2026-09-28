// A static server with the SPA fallback `python3 -m http.server` lacks: unknown paths get index.html.
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'

const ROOT = process.argv[2]
const PORT = Number(process.argv[3])
const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
}
createServer(async (req, res) => {
  const path = normalize(decodeURIComponent((req.url ?? '/').split('?')[0])).replace(/^(\.\.[/\\])+/, '')
  let file = join(ROOT, path)
  try {
    if (!(await stat(file)).isFile()) file = join(ROOT, 'index.html')
  } catch {
    file = join(ROOT, 'index.html')
  }
  const body = await readFile(file)
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
  res.end(body)
}).listen(PORT, '127.0.0.1', () => console.log(`serving ${ROOT} on ${PORT}`))
