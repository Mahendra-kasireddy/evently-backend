import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';

import { UserService } from '../user/user.service';
import { AdminTeamService } from '../user/admin-team.service';
import { UserDocument, UserStatus } from '../user/schemas/user.schema';
import { Role } from '../../common/enums/role.enum';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { SendOtpDto } from './dto/send-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { OtpService } from './otp.service';
import { OtpPurpose } from './schemas/otp.schema';

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
    private readonly adminTeam: AdminTeamService,
  ) {}

  // ----- phone OTP (passwordless) -----

  /** Step 1: issue an OTP for a mobile number. */
  async sendOtp(dto: SendOtpDto) {
    if (dto.purpose === 'register' && (await this.userService.findByPhone(dto.mobile))) {
      throw new ConflictException('This number is already registered. Sign in to continue.');
    }
    if (dto.purpose === 'admin_signup') {
      // Invite-only: no code is sent to a number nobody invited.
      if (!(await this.adminTeam.hasPendingInvite(dto.mobile))) {
        throw new ForbiddenException(
          'This number hasn’t been invited to Evently Admin. Ask an admin to invite you.',
        );
      }
      return this.otpService.issue(dto.mobile, OtpPurpose.ADMIN_SIGNUP);
    }
    const issued = await this.otpService.issue(dto.mobile);
    return issued; // { requestId, sentTo, devCode? }
  }

  /** Step 2: verify the code, then find-or-create the customer and start a session. */
  async verifyOtp(dto: VerifyOtpDto) {
    const { phone, purpose } = await this.otpService.verify(dto.requestId, dto.code);
    const { user, isNew } = await this.userService.findOrCreateByPhone(phone);
    /*
     * A suspended account must not get a session here either.
     *
     * This check used to exist only on password `login`, while OTP is the path
     * almost every customer actually uses — so suspending an account from the
     * admin console blocked nobody. The correct code for a suspended number is
     * still a rejection.
     */
    this.assertActive(user);
    // An admin sign-up code: the number is proven, so the invite is honoured
    // and the session below already carries the admin role.
    if (purpose === OtpPurpose.ADMIN_SIGNUP) await this.adminTeam.acceptInvite(user);
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
    this.assertActive(user);
    return this.issueSession(user);
  }

  /** Rotates the refresh token: verifies the presented one against the stored hash. */
  async refresh(userId: string, presentedToken: string) {
    const user = await this.userService.findByIdWithRefreshHash(userId);
    if (!user || !user.refreshTokenHash) {
      throw new UnauthorizedException('Session expired');
    }
    /*
     * Suspension has to bite here too. Without it a suspended user simply kept
     * rotating their refresh token and stayed signed in indefinitely, because
     * the only status check in the service ran at login — which they no longer
     * needed to do.
     */
    this.assertActive(user);
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

  /**
   * Issues a fresh token pair for an already-authenticated user. Used when a
   * user's roles change mid-session (e.g. a customer upgrades to organizer) so
   * the new access token reflects the updated roles without a re-login.
   */
  async issueSessionForUser(userId: string): Promise<TokenPair> {
    const user = await this.userService.findById(userId);
    this.assertActive(user);
    return this.issueSession(user);
  }

  /** One rule for "may this account hold a session", used by every entry point. */
  private assertActive(user: UserDocument): void {
    if (user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('Account is not active');
    }
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
