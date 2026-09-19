/**
 * DOS-167 close — the measuring instrument.
 *
 * A transparent HTTP proxy the phone talks to instead of the service: it appends one JSON line per
 * request the instant the request line is parsed (before the body is read and before anything is
 * forwarded), then pipes the request upstream and the response back untouched. The line carries
 * wall-clock ms, method, path, and the request's own `x-dos-op`/idempotency headers when present.
 *
 * Usage: node log-proxy.mjs <listenPort> <upstreamPort> <logFile>
 * Stopping this process IS "the office is cut off" for the phone: nothing answers on <listenPort>.
 */
import fs from 'node:fs'
import http from 'node:http'

const listenPort = Number(process.argv[2])
const upstreamPort = Number(process.argv[3])
const logFile = process.argv[4]

const log = fs.createWriteStream(logFile, { flags: 'a' })
log.write(
  JSON.stringify({ t: Date.now(), iso: new Date().toISOString(), event: 'proxy-up', listenPort, upstreamPort }) + '\n',
)

const server = http.createServer((req, res) => {
  const t = Date.now()
  log.write(
    JSON.stringify({
      t,
      iso: new Date(t).toISOString(),
      method: req.method,
      url: req.url,
      ua: req.headers['user-agent'] ?? null,
      auth: req.headers.authorization === undefined ? null : 'bearer',
    }) + '\n',
  )
  const upstream = http.request(
    { host: '127.0.0.1', port: upstreamPort, method: req.method, path: req.url, headers: req.headers },
    (up) => {
      const done = Date.now()
      log.write(
        JSON.stringify({
          t: done,
          iso: new Date(done).toISOString(),
          event: 'response',
          method: req.method,
          url: req.url,
          status: up.statusCode,
          ms: done - t,
        }) + '\n',
      )
      res.writeHead(up.statusCode ?? 502, up.headers)
      up.pipe(res)
    },
  )
  upstream.on('error', (error) => {
    log.write(JSON.stringify({ t: Date.now(), event: 'upstream-error', url: req.url, error: String(error) }) + '\n')
    res.writeHead(502).end('upstream error')
  })
  req.pipe(upstream)
})

process.on('SIGTERM', () => {
  log.write(JSON.stringify({ t: Date.now(), iso: new Date().toISOString(), event: 'proxy-down' }) + '\n')
  log.end(() => process.exit(0))
})

server.listen(listenPort, '127.0.0.1', () => console.log(`log-proxy ${listenPort} -> ${upstreamPort}`))
