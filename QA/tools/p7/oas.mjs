// Print request body schema + example for an endpoint from a saved OpenAPI file.
// usage: node oas.mjs <service> <METHOD> <path>
import fs from 'node:fs';
const [svc, method, path] = process.argv.slice(2);
const s = JSON.parse(fs.readFileSync(new URL(`../../evidence/p7/openapi-${svc}.json`, import.meta.url)));
const op = s.paths[path]?.[method.toLowerCase()];
if (!op) { console.log('no such op'); process.exit(1); }
const deref = (x, d = 0) => {
  if (d > 12 || x == null || typeof x !== 'object') return x;
  if (x.$ref) { const k = x.$ref.split('/').pop(); return deref(s.components.schemas[k], d + 1); }
  if (Array.isArray(x)) return x.map((y) => deref(y, d + 1));
  return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, deref(v, d + 1)]));
};
console.log(op.summary, '\n', op.description ?? '');
if (op.parameters) console.log('PARAMS', JSON.stringify(deref(op.parameters)));
const rb = op.requestBody?.content?.['application/json'];
if (rb) { console.log('BODY', JSON.stringify(deref(rb.schema))); console.log('EXAMPLE', JSON.stringify(rb.example ?? rb.examples)); }
const r = op.responses?.['200']?.content?.['application/json'];
if (r && process.argv[5] === 'resp') console.log('RESP', JSON.stringify(deref(r.schema)).slice(0, 4000));
