import { Module } from '@nestjs/common'
import { AccessTokenGuard } from './access-token.guard.js'
import { AuthController } from './auth.controller.js'
import { AuthService } from './auth.service.js'

/**
 * Served by auth-service (:3000) alone. Depends on nothing but the database: every other service verifies
 * the tokens this module issues with the public key (loadAuthKeys) and never calls back here.
 */
@Module({
  controllers: [AuthController],
  providers: [AuthService, AccessTokenGuard],
  exports: [AuthService, AccessTokenGuard],
})
export class AuthModule {}
