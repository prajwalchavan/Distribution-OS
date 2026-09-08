// The debug APKs (plain RN debug builds, no expo-dev-client) look for Metro at 10.0.2.2:8081 — the emulator's
// alias for the host. Each app's Metro runs on its own port, so this forwards host :8081 to the app under test.
// Usage: node proxy8081.mjs <targetPort>
import net from 'node:net'
const target = Number(process.argv[2])
net.createServer((s) => { const c = net.connect(target, '127.0.0.1'); s.pipe(c).pipe(s); s.on('error', () => c.destroy()); c.on('error', () => s.destroy()) }).listen(8081, () => console.log('8081 ->', target))
