import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';

import { UserService } from '../user/user.service';
import { UserDocument, UserStatus } from '../user/schemas/user.schema';
import { Role } from '../../common/enums/role.enum';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { SendOtpDto } from './dto/send-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { OtpService } from './otp.service';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly userService: UserService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly otpService: OtpService,
  ) {}

  // ----- phone OTP (passwordless) -----

  /** Step 1: issue an OTP for a mobile number. */
  async sendOtp(dto: SendOtpDto) {
    const issued = await this.otpService.issue(dto.mobile);
    return issued; // { requestId, sentTo, devCode? }
  }

  /** Step 2: verify the code, then find-or-create the customer and start a session. */
  async verifyOtp(dto: VerifyOtpDto) {
    const phone = await this.otpService.verify(dto.requestId, dto.code);
    const { user, isNew } = await this.userService.findOrCreateByPhone(phone);
    const tokens = await this.issueSession(user);
    return {
      token: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      isNewUser: isNew,
      user: user.toJSON(),
    };
  }

  async register(dto: RegisterDto) {
    const user = await this.userService.create({
      name: dto.name,
      email: dto.email,
      password: dto.password,
      roles: dto.role ? [dto.role] : [Role.CUSTOMER],
    });
    return this.issueSession(user);
  }

  async login(dto: LoginDto) {
    const user = await this.userService.findByEmailWithSecret(dto.email);
    if (!user || !user.passwordHash || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid credentials');
    }
    if (user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('Account is not active');
    }
    return this.issueSession(user);
  }

  /** Rotates the refresh token: verifies the presented one against the stored hash. */
  async refresh(userId: string, presentedToken: string) {
    const user = await this.userService.findByIdWithRefreshHash(userId);
    if (!user || !user.refreshTokenHash) {
      throw new UnauthorizedException('Session expired');
    }
    const matches = await bcrypt.compare(presentedToken, user.refreshTokenHash);
    if (!matches) {
      // Token reuse or theft — drop the session entirely.
      await this.userService.setRefreshTokenHash(userId, null);
      throw new UnauthorizedException('Refresh token rejected');
    }
    return this.issueSession(user);
  }

  async logout(userId: string): Promise<void> {
    await this.userService.setRefreshTokenHash(userId, null);
  }

  // ----- internals -----

  private async issueSession(user: UserDocument): Promise<TokenPair> {
    const userId = user._id.toString();
    const tokens = await this.signTokens(user);
    await this.userService.setRefreshTokenHash(userId, tokens.refreshToken);
    return tokens;
  }

  private async signTokens(user: UserDocument): Promise<TokenPair> {
    const userId = user._id.toString();
    const payload = {
      sub: userId,
      roles: user.roles,
      email: user.email,
      phone: user.phone,
    };
    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: this.config.get<string>('jwt.accessSecret'),
        expiresIn: this.config.get<string>('jwt.accessExpiresIn'),
      }),
      this.jwtService.signAsync(
        { sub: userId },
        {
          secret: this.config.get<string>('jwt.refreshSecret'),
          expiresIn: this.config.get<string>('jwt.refreshExpiresIn'),
        },
      ),
    ]);
    return { accessToken, refreshToken };
  }
}
