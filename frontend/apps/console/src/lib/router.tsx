import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

/**
 * Hash router for the console: `#/catalog`, `#/retailers/abc`. Deliberately tiny (no data loaders,
 * no nested layouts) — the console is an internal tool with a dozen flat routes. Swap for
 * react-router when nested layouts or URL search state become necessary.
 */
interface RouterApi {
  path: string
  navigate: (to: string) => void
}

const RouterContext = createContext<RouterApi | null>(null)

function read(): string {
  const h = window.location.hash.replace(/^#/, '')
  return h.startsWith('/') ? h : '/'
}

export function RouterProvider({ children }: { children: ReactNode }) {
  const [path, setPath] = useState<string>(() => read())
  useEffect(() => {
    const onChange = () => setPath(read())
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  const value = useMemo<RouterApi>(
    () => ({
      path,
      navigate: (to: string) => {
        window.location.hash = to.startsWith('/') ? to : `/${to}`
      },
    }),
    [path],
  )
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>
}

export function useRouter(): RouterApi {
  const ctx = useContext(RouterContext)
  if (!ctx) throw new Error('useRouter outside RouterProvider')
  return ctx
}

/** Matches `/retailers/:id` style patterns; returns params or null. */
export function match(pattern: string, path: string): Record<string, string> | null {
  const p = pattern.split('/').filter(Boolean)
  const s = path.split('/').filter(Boolean)
  if (p.length !== s.length) return null
  const params: Record<string, string> = {}
  for (let i = 0; i < p.length; i++) {
    const seg = p[i] ?? ''
    const val = s[i] ?? ''
    if (seg.startsWith(':')) params[seg.slice(1)] = decodeURIComponent(val)
    else if (seg !== val) return null
  }
  return params
}

export function Link({
  to,
  children,
  className,
}: {
  to: string
  children: ReactNode
  className?: string
}) {
  const { path } = useRouter()
  const active = path === to || (to !== '/' && path.startsWith(`${to}/`))
  return (
    <a
      href={`#${to}`}
      className={[className ?? '', active ? 'active' : ''].join(' ').trim()}
      aria-current={active ? 'page' : undefined}
    >
      {children}
    </a>
  )
}
