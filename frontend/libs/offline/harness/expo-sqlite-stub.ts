/**
 * Vite cannot compile `expo-sqlite`: the package reaches `react-native`, whose sources are Flow, and
 * only Metro (with `babel-preset-expo`) strips Flow. In the seven real apps that is exactly what
 * bundles them, so the OPFS build is reachable there; in this harness it is not, and the honest thing
 * is to say so rather than to pretend.
 *
 * With no `openDatabaseAsync` on the module, `openStore()` falls to the memory adapter — the SAME
 * path a browser without cross-origin isolation takes — and the page prints "Offline data is not
 * saved on this browser". Every other line of the client is the shipped one.
 */
export {}
