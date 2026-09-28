// Print request shape + example for endpoints from a saved OpenAPI file (scratch copy). usage: node oas-brief.mjs <svc> "POST /path" ...
import fs from 'node:fs';
const dir = process.env.OAS_DIR; const svc = process.argv[2]; const ops = process.argv.slice(3);
const s = JSON.parse(fs.readFileSync(`${dir}/openapi-${svc}.json`));
const deref = (x, d = 0) => { if (d > 14 || x == null || typeof x !== 'object') return x; if (x.$ref) return deref(s.components.schemas[x.$ref.split('/').pop()], d + 1); if (Array.isArray(x)) return x.map((y) => deref(y, d + 1)); return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, deref(v, d + 1)])); };
const brief = (sc, d = 0) => { if (!sc) return ''; if (sc.anyOf) return sc.anyOf.map((a) => brief(a, d)).join('|'); if (sc.enum) return sc.enum.join('/'); if (sc.type === 'array') return `[${brief(sc.items, d + 1)}]`; if (sc.type === 'object' && sc.properties) { const req = new Set(sc.required || []); return '{' + Object.entries(sc.properties).map(([k, v]) => `${k}${req.has(k) ? '' : '?'}:${brief(v, d + 1)}`).join(', ') + '}'; } return sc.type || ''; };
for (const o of ops) { const [m, p] = o.split(' '); const op = s.paths[p]?.[m.toLowerCase()]; if (!op) { console.log('MISSING', o); continue; }
  console.log(`## ${o} — ${op.summary}`); if (process.env.DESC) console.log('  desc:', (op.description||'').slice(0, 1500));
  const q = (op.parameters || []).filter((x) => x.in === 'query').map((x) => x.name + (x.required ? '' : '?')); if (q.length) console.log('  query:', q.join(', '));
  const rb = op.requestBody?.content?.['application/json']; if (rb) { console.log('  body:', brief(deref(rb.schema))); console.log('  ex:', JSON.stringify(rb.example).slice(0, 1200)); } }
