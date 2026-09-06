import { afterEach, describe, expect, it, vi } from 'vitest'

import { memoryTokenStorage, secureStoreTokenStorage, webTokenStorage } from './storage.js'

function fakeWebStorage(): Storage & { map: Map<string, string> } {
  const map = new Map<string, string>()
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value)
    },
    removeItem: (key: string) => {
      map.delete(key)
    },
    clear: () => {
      map.clear()
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size
    },
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('memoryTokenStorage', () => {
  it('holds a token for this process and nothing longer', () => {
    const storage = memoryTokenStorage('device-1')
    expect(storage.getRefreshToken()).toBeNull()
    storage.setRefreshToken('r1')
    expect(storage.getRefreshToken()).toBe('r1')
    storage.setRefreshToken(null)
    expect(storage.getRefreshToken()).toBeNull()
    expect(storage.getDeviceId()).toBe('device-1')
  })
})

describe('webTokenStorage', () => {
  it('falls back to memory when there is no window at all (SSR, a test)', () => {
    const storage = webTokenStorage()
    storage.setRefreshToken('r1')
    expect(storage.getRefreshToken()).toBe('r1')
  })

  it('keeps the session across a restart when the device is remembered', () => {
    const local = fakeWebStorage()
    const session = fakeWebStorage()
    vi.stubGlobal('window', { localStorage: local, sessionStorage: session })
    const storage = webTokenStorage({ remember: true })
    storage.setRefreshToken('r1')
    expect(local.map.get('dos.auth.refresh')).toBe('r1')
    expect(session.map.has('dos.auth.refresh')).toBe(false)
  })

  it('drops the session with the tab when the device is NOT remembered', () => {
    const local = fakeWebStorage()
    const session = fakeWebStorage()
    vi.stubGlobal('window', { localStorage: local, sessionStorage: session })
    const storage = webTokenStorage({ remember: false })
    storage.setRefreshToken('r1')
    expect(session.map.get('dos.auth.refresh')).toBe('r1')
    expect(local.map.has('dos.auth.refresh')).toBe(false)
  })

  it('gives the install one device id that outlives every sign-out', () => {
    const local = fakeWebStorage()
    const session = fakeWebStorage()
    vi.stubGlobal('window', { localStorage: local, sessionStorage: session })
    const first = webTokenStorage().getDeviceId()
    expect(first).toMatch(/^[0-9a-f-]{36}$/)
    // A sign-out clears the token, never the device id.
    webTokenStorage().setRefreshToken(null)
    expect(webTokenStorage({ remember: false }).getDeviceId()).toBe(first)
  })

  it('carries a live session across a change of "remember this device"', () => {
    const local = fakeWebStorage()
    const session = fakeWebStorage()
    vi.stubGlobal('window', { localStorage: local, sessionStorage: session })
    const storage = webTokenStorage({ remember: true })
    storage.setRefreshToken('r1')
    storage.setDurable?.(false)
    expect(storage.getRefreshToken()).toBe('r1')
    expect(session.map.get('dos.auth.refresh')).toBe('r1')
    expect(local.map.has('dos.auth.refresh')).toBe(false)
  })

  it('finds a token written by the other box after a reload', () => {
    const local = fakeWebStorage()
    const session = fakeWebStorage()
    vi.stubGlobal('window', { localStorage: local, sessionStorage: session })
    webTokenStorage({ remember: false }).setRefreshToken('r1')
    // A fresh page load defaults to "remembered" and must still see the tab-scoped token.
    expect(webTokenStorage({ remember: true }).getRefreshToken()).toBe('r1')
  })
})

describe('secureStoreTokenStorage', () => {
  it('reads and writes through the injected expo-secure-store module', () => {
    const map = new Map<string, string>()
    const storage = secureStoreTokenStorage({
      getItem: (key) => map.get(key) ?? null,
      setItem: (key, value) => {
        map.set(key, value)
      },
    })
    const deviceId = storage.getDeviceId()
    expect(deviceId).toMatch(/^[0-9a-f-]{36}$/)
    storage.setRefreshToken('r1')
    expect(map.get('dos.auth.refresh')).toBe('r1')
    storage.setRefreshToken(null)
    expect(storage.getRefreshToken()).toBeNull()
  })
})
