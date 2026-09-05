import { docintConfig, type DocintConfig } from '../config.js'
import type { ExtractionEngineAdapter } from '../types.js'
import { createAnthropicEngine } from './anthropic.js'
import { createStubEngine } from './stub.js'

export {
  createStubEngine,
  registerStubReading,
  clearStubReadings,
  fixturesDir,
  STUB_ENGINE_VERSION,
  STUB_PROMPT_VERSION,
} from './stub.js'
export {
  createAnthropicEngine,
  toReading,
  costPaiseFor,
  ENGINE_OUTPUT_SCHEMA,
  ANTHROPIC_ENGINE_VERSION,
  ANTHROPIC_PROMPT_VERSION,
} from './anthropic.js'

/** The adapter `DOCINT_ENGINE` names: `stub` in tests and without a key, `anthropic` otherwise. */
export function createEngine(config: DocintConfig = docintConfig()): ExtractionEngineAdapter {
  return config.engine === 'anthropic' ? createAnthropicEngine(config) : createStubEngine()
}
