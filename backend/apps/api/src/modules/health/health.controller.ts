import { Controller, Get, Inject, Optional } from '@nestjs/common'
import { Implement, implement } from '@orpc/nest'
import { contract } from '@dos/contracts'
import { ping, type Db } from '@dos/db'
import { DB, loadEnv, OwnsReply } from '../../platform/index.js'

@Controller()
export class HealthController {
  constructor(@Optional() @Inject(DB) private readonly db: Db | null) {}

  /** Plain endpoint for load balancers: reports process up and whether the DB is reachable. */
  @Get('/health')
  async health(): Promise<{ ok: boolean; db: 'up' | 'down' }> {
    const db = await this.dbStatus()
    return { ok: db === 'up', db }
  }

  @Implement(contract.health.ping)
  ping(@OwnsReply() _reply: unknown) {
    return implement(contract.health.ping).handler(async () => {
      const db = await this.dbStatus()
      return { ok: db === 'up', version: loadEnv().APP_VERSION, db, time: new Date().toISOString() }
    })
  }

  private async dbStatus(): Promise<'up' | 'down'> {
    if (!this.db) return 'down'
    try {
      return (await ping(this.db)) ? 'up' : 'down'
    } catch {
      return 'down'
    }
  }
}
