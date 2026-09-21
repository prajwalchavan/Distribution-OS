/**
 * Stock turns, as a multiple (DOS-018).
 *
 * `stockTurns` arrives as a `ratio` on the wire like a fill rate, but it is a MULTIPLE and not a
 * percentage: 0.89 turns in a month is "0.9×", and "89%" says the wrong thing about the one number
 * the chart exists for. It was printed with `toFixed(1)`, which is right for a brisk month and wrong
 * for a slow one: `niceTicks` answers 0, 0.05, 0.1, 0.15, 0.2 for a maximum of 0.2, and one decimal
 * printed that axis as "0.0× 0.1× 0.1× 0.2× 0.2×" — the same label twice, up the side of a chart.
 *
 * So the tick keeps as many decimals as it has, up to three (the finest step `niceTicks` can answer
 * for any turns figure a distributor will see), and no trailing zeros: a whole number is "1×" and
 * never "1.000×". Pure and dependency-free so it can be read by a test in Node, where the kit and
 * `react-native` do not resolve.
 */
const MAX_DECIMALS = 3

export function turnsLabel(value: number): string {
  const text = value.toFixed(MAX_DECIMALS).replace(/0+$/, '').replace(/\.$/, '')
  return `${text === '' || text === '-0' ? '0' : text}×`
}
