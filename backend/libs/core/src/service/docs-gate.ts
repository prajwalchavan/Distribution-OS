/**
 * Who gets the API reference (DOS-290).
 *
 * `/docs`, `/docs/openapi.json` and `/swagger` carry no token check: they are a developer's tool, read
 * on a laptop before there is anybody to sign in as. On a public host that made the whole document
 * readable by anyone — and its examples were rows of the database, which in production are a
 * distributor's shops, phone numbers and GSTINs.
 *
 * So in production the three routes do not exist unless the operator sets `API_DOCS=on`, and even
 * then the examples come from the schemas alone. Everywhere else nothing changes.
 */
export function docsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NODE_ENV !== 'production') return true
  return env.API_DOCS === 'on'
}

/** Whether the examples may be real rows. Never in production, whatever `API_DOCS` says. */
export function docsUseRows(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV !== 'production'
}
