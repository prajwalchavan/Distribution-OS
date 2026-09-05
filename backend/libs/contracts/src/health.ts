import { z } from 'zod'

export const HealthOutputSchema = z.object({
  ok: z.boolean(),
  version: z.string(),
  db: z.enum(['up', 'down']),
  time: z.iso.datetime(),
})
export type HealthOutput = z.infer<typeof HealthOutputSchema>
