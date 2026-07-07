import { Body, Controller, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { SendOtpDto } from './dto/send-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtRefreshGuard } from './guards/jwt-refresh.guard';
import { RefreshRequestUser } from './strategies/jwt-refresh.strategy';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // ----- phone OTP (passwordless) -----

  // Per-IP limit (5 sends / 10 min) — layered with the per-phone guard in OtpService.
  @Throttle({ default: { limit: 5, ttl: 600_000 } })
  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('sendOtp')
  sendOtp(@Body() dto: SendOtpDto) {
    return this.authService.sendOtp(dto);
  }

  // Per-IP limit (10 verifies / 10 min) — layered with the per-OTP max-attempts.
  @Throttle({ default: { limit: 10, ttl: 600_000 } })
  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('verifyOtp')
  verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.authService.verifyOtp(dto);
  }

  // ----- email + password (secondary) -----

  @Public()
  @Post('registerUser')
  registerUser(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('loginUser')
  loginUser(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  /**
   * Exchanges a valid refresh token for a new token pair.
   * Send the refresh token as: Authorization: Bearer <refreshToken>
   */
  @Public()
  @UseGuards(JwtRefreshGuard)
  @HttpCode(HttpStatus.OK)
  @Post('refreshToken')
  refreshToken(@Req() req: Request) {
    const { userId, refreshToken } = req.user as RefreshRequestUser;
    return this.authService.refresh(userId, refreshToken);
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('logoutUser')
  async logoutUser(@CurrentUser('userId') userId: string) {
    await this.authService.logout(userId);
  }
}
