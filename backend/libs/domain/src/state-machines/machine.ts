/** Tiny explicit state machine: transitions are data, so the same rules run on device and server. */
export class TransitionError extends Error {
  override name = 'TransitionError'
  constructor(
    public readonly machine: string,
    public readonly from: string,
    public readonly event: string,
  ) {
    super(`${machine}: cannot apply "${event}" in state "${from}"`)
  }
}

export interface Machine<S extends string, E extends string> {
  readonly name: string
  readonly initial: S
  readonly terminal: ReadonlySet<S>
  readonly transitions: Readonly<Record<S, Partial<Readonly<Record<E, S>>>>>
  can(from: S, event: E): boolean
  next(from: S, event: E): S
  isTerminal(state: S): boolean
}

export function defineMachine<S extends string, E extends string>(spec: {
  name: string
  initial: S
  terminal: readonly S[]
  transitions: Readonly<Record<S, Partial<Readonly<Record<E, S>>>>>
}): Machine<S, E> {
  const terminal = new Set(spec.terminal)
  return {
    name: spec.name,
    initial: spec.initial,
    terminal,
    transitions: spec.transitions,
    can: (from, event) => spec.transitions[from]?.[event] !== undefined,
    next: (from, event) => {
      const to = spec.transitions[from]?.[event]
      if (to === undefined) throw new TransitionError(spec.name, from, event)
      return to
    },
    isTerminal: (state) => terminal.has(state),
  }
}
