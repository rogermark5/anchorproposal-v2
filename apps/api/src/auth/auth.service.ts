import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { UserRole, UserStatus, AuthChallengePurpose } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import {
  LoginDto,
  RegisterDto,
  RegisterVerifyDto,
  ForgotPasswordDto,
  ResetPasswordDto,
} from './dto/auth.dto';
import { AuthUser } from '../common/types/auth.types';

const OTP_TTL_MS = 10 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;
const MAX_ATTEMPTS = 5;

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private config: ConfigService,
    private mail: MailService,
  ) {}

  async requestRegisterOtp(dto: RegisterDto) {
    if (dto.password !== dto.confirmPassword) {
      throw new BadRequestException('Passwords do not match');
    }

    const email = dto.email.toLowerCase().trim();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new ConflictException('Email already registered');

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const code = this.generateOtp();
    const codeHash = this.hashToken(code);
    const expiresAt = new Date(Date.now() + OTP_TTL_MS);

    await this.prisma.authChallenge.updateMany({
      where: { email, purpose: AuthChallengePurpose.SIGNUP, consumedAt: null },
      data: { consumedAt: new Date() },
    });

    await this.prisma.authChallenge.create({
      data: {
        email,
        purpose: AuthChallengePurpose.SIGNUP,
        codeHash,
        expiresAt,
        payloadJson: {
          email,
          passwordHash,
          firstName: dto.firstName.trim(),
          lastName: dto.lastName.trim(),
        },
      },
    });
    await this.mail.sendOtp(email, 'signup', code);

    return {
      requiresOtp: true,
      email,
      message: 'Verification code sent. Check your email (or API logs in dev).',
    };
  }

  async verifyRegister(dto: RegisterVerifyDto) {
    const email = dto.email.toLowerCase().trim();
    const challenge = await this.findActiveChallenge(email, AuthChallengePurpose.SIGNUP);

    await this.verifyOtpCode(challenge, dto.code);

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new ConflictException('Email already registered');

    const payload = challenge.payloadJson as {
      email: string;
      passwordHash: string;
      firstName: string;
      lastName: string;
    } | null;

    if (!payload?.passwordHash || !payload.firstName || !payload.lastName) {
      throw new BadRequestException('Signup session expired. Please register again.');
    }

    const user = await this.prisma.user.create({
      data: {
        email,
        passwordHash: payload.passwordHash,
        firstName: payload.firstName,
        lastName: payload.lastName,
        role: UserRole.BIDDER,
        status: UserStatus.PENDING,
      },
    });
    await this.prisma.authChallenge.update({
      where: { id: challenge.id },
      data: { consumedAt: new Date() },
    });

    await this.prisma.auditEvent.create({
      data: {
        actorId: user.id,
        action: 'USER_REGISTERED',
        targetType: 'User',
        targetId: user.id,
        reason: 'Pending admin approval',
      },
    });

    return {
      success: true,
      message: 'Account created. Awaiting admin approval before you can sign in.',
      user: this.toPublicUser(user),
    };
  }

  async login(dto: LoginDto) {
    const user = await this.findUserByIdentifier(dto.email.trim());

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.status === UserStatus.PENDING) {
      throw new ForbiddenException('Account is pending approval. Contact an administrator.');
    }

    if (user.status === UserStatus.SUSPENDED) {
      throw new ForbiddenException('Account is disallowed. Contact your administrator.');
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw new ForbiddenException('Account cannot sign in.');
    }

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
    });

    const sessionId = crypto.randomUUID();
    const tokens = await this.generateTokens(user.id, user.email, user.role, sessionId);
    await this.prisma.$transaction(async tx => {
      await tx.authSession.deleteMany({ where: { userId: user.id, expiresAt: { lt: new Date() } } });
      await tx.authSession.create({ data: { id: sessionId, userId: user.id, refreshTokenHash: this.hashToken(tokens.refreshToken), expiresAt: new Date(Date.now() + 7 * 86400_000) } });
    });

    return {
      user: this.toPublicUser(user),
      ...tokens,
    };
  }

  async forgotPassword(dto: ForgotPasswordDto) {
    const email = dto.email.toLowerCase().trim();
    const generic = {
      success: true,
      message: 'If this email is eligible, a reset link has been sent.',
    };

    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) return generic;

    if (user.role === UserRole.MASTER) {
      return generic;
    }

    if (user.status === UserStatus.PENDING) {
      throw new ForbiddenException('Account is pending approval. Password reset is unavailable.');
    }

    if (user.status === UserStatus.SUSPENDED) {
      throw new ForbiddenException('Account is disallowed. Contact your administrator.');
    }

    if (user.status !== UserStatus.ACTIVE) return generic;

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(rawToken);
    const expiresAt = new Date(Date.now() + RESET_TTL_MS);

    await this.prisma.authChallenge.updateMany({
      where: { email, purpose: AuthChallengePurpose.RESET, consumedAt: null },
      data: { consumedAt: new Date() },
    });

    await this.prisma.authChallenge.create({
      data: {
        email,
        purpose: AuthChallengePurpose.RESET,
        tokenHash,
        expiresAt,
        payloadJson: { userId: user.id },
      },
    });

    await this.mail.sendResetLink(email, rawToken);

    return generic;
  }

  async resetPassword(dto: ResetPasswordDto) {
    if (dto.password !== dto.confirmPassword) {
      throw new BadRequestException('Passwords do not match');
    }

    const tokenHash = this.hashToken(dto.token.trim());
    const challenge = await this.prisma.authChallenge.findFirst({
      where: {
        purpose: AuthChallengePurpose.RESET,
        tokenHash,
        consumedAt: null,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!challenge) {
      throw new BadRequestException('Invalid or expired reset link.');
    }

    if (challenge.expiresAt < new Date()) {
      throw new BadRequestException('Reset link has expired. Request a new one.');
    }

    const user = await this.prisma.user.findUnique({ where: { email: challenge.email } });
    if (!user || user.status !== UserStatus.ACTIVE || user.role === UserRole.MASTER) {
      throw new ForbiddenException('Unable to reset password for this account.');
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, refreshToken: null, authSessions: { deleteMany: {} } },
    });

    await this.prisma.authChallenge.update({
      where: { id: challenge.id },
      data: { consumedAt: new Date() },
    });

    await this.prisma.auditEvent.create({
      data: {
        actorId: user.id,
        action: 'PASSWORD_RESET',
        targetType: 'User',
        targetId: user.id,
      },
    });

    return { success: true, message: 'Password updated. You can sign in now.' };
  }

  async changePassword(
    user: AuthUser,
    dto: { currentPassword: string; newPassword: string; confirmPassword: string },
  ) {
    if (user.role === UserRole.MASTER) {
      throw new ForbiddenException('Master password cannot be changed here');
    }
    if (dto.newPassword !== dto.confirmPassword) {
      throw new BadRequestException('Passwords do not match');
    }
    if (dto.newPassword.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters');
    }

    const dbUser = await this.prisma.user.findUnique({ where: { id: user.id } });
    if (!dbUser) throw new UnauthorizedException();

    const valid = await bcrypt.compare(dto.currentPassword, dbUser.passwordHash);
    if (!valid) throw new BadRequestException('Current password is incorrect');

    const passwordHash = await bcrypt.hash(dto.newPassword, 10);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, refreshToken: null, authSessions: { deleteMany: {} } },
    });

    await this.prisma.auditEvent.create({
      data: {
        actorId: user.id,
        action: 'PASSWORD_CHANGED',
        targetType: 'User',
        targetId: user.id,
      },
    });

    return { success: true, message: 'Password updated. Please sign in again.' };
  }

  async refresh(refreshToken: string) {
    try {
      const payload = this.jwt.verify(refreshToken, {
        secret: this.config.get('JWT_REFRESH_SECRET') || 'dev-refresh-secret',
      });
      const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
      if (!user || user.status !== UserStatus.ACTIVE) {
        throw new UnauthorizedException('Invalid refresh token');
      }
      if (payload.sid) {
        const tokens = await this.generateTokens(user.id, user.email, user.role, payload.sid);
        const rotated = await this.prisma.authSession.updateMany({
          where: { id: payload.sid, userId: user.id, refreshTokenHash: this.hashToken(refreshToken), expiresAt: { gt: new Date() } },
          data: { refreshTokenHash: this.hashToken(tokens.refreshToken), expiresAt: new Date(Date.now() + 7 * 86400_000) },
        });
        if (rotated.count !== 1) throw new UnauthorizedException('Invalid refresh token');
        return tokens;
      }
      // Existing web sessions remain valid until they expire or sign in again.
      if (user.refreshToken !== refreshToken) throw new UnauthorizedException('Invalid refresh token');
      const tokens = await this.generateTokens(user.id, user.email, user.role);
      const rotated = await this.prisma.user.updateMany({ where: { id: user.id, refreshToken }, data: { refreshToken: tokens.refreshToken } });
      if (rotated.count !== 1) throw new UnauthorizedException('Invalid refresh token');
      return tokens;
    } catch (error) {
      if (error instanceof UnauthorizedException || ['JsonWebTokenError', 'TokenExpiredError', 'NotBeforeError'].includes((error as Error)?.name)) throw new UnauthorizedException('Invalid refresh token');
      // A database/network outage must not invalidate an otherwise valid session.
      throw error;
    }
  }

  async logout(userId: string, sessionId?: string) {
    if (sessionId) {
      await this.prisma.authSession.deleteMany({ where: { id: sessionId, userId } });
      return { success: true };
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshToken: null, authSessions: { deleteMany: {} } },
    });
    return { success: true };
  }

  async getMe(user: AuthUser) {
    return this.prisma.user.findUnique({
      where: { id: user.id },
      select: {
        id: true,
        email: true,
        username: true,
        role: true,
        firstName: true,
        lastName: true,
        status: true,
        canCreateApplications: true,
        canGenerateResumes: true,
        canDownloadDocuments: true,
      },
    });
  }

  private async findUserByIdentifier(identifier: string) {
    let user = await this.prisma.user.findUnique({
      where: { email: identifier.toLowerCase() },
    });

    if (!user && identifier.toLowerCase() === 'master') {
      user = await this.prisma.user.findFirst({
        where: { username: { equals: 'Master', mode: 'insensitive' } },
      });
    }

    return user;
  }

  private async findActiveChallenge(email: string, purpose: AuthChallengePurpose) {
    const challenge = await this.prisma.authChallenge.findFirst({
      where: { email, purpose, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });

    if (!challenge) {
      throw new BadRequestException('No verification code found. Request a new one.');
    }

    if (challenge.expiresAt < new Date()) {
      throw new BadRequestException('Verification code expired. Request a new one.');
    }

    if (challenge.attempts >= MAX_ATTEMPTS) {
      throw new BadRequestException('Too many attempts. Request a new code.');
    }

    return challenge;
  }

  private async verifyOtpCode(
    challenge: { id: string; codeHash: string | null; attempts: number },
    code: string,
  ) {
    if (!challenge.codeHash) {
      throw new BadRequestException('Invalid verification challenge.');
    }

    const ok = this.hashToken(code.trim()) === challenge.codeHash;
    if (!ok) {
      await this.prisma.authChallenge.update({
        where: { id: challenge.id },
        data: { attempts: challenge.attempts + 1 },
      });
      throw new BadRequestException('Invalid verification code.');
    }
  }

  private generateOtp() {
    return String(crypto.randomInt(100000, 1000000));
  }

  private hashToken(value: string) {
    return crypto.createHash('sha256').update(value).digest('hex');
  }

  private toPublicUser(user: {
    id: string;
    email: string;
    role: string;
    firstName: string;
    lastName: string;
    username?: string | null;
    status?: string;
  }) {
    return {
      id: user.id,
      email: user.email,
      username: user.username ?? undefined,
      role: user.role,
      firstName: user.firstName,
      lastName: user.lastName,
      status: user.status,
    };
  }

  private async generateTokens(userId: string, email: string, role: string, sessionId?: string) {
    const payload = { sub: userId, email, role, ...(sessionId ? { sid: sessionId } : {}) };
    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(payload, {
        secret: this.config.get('JWT_SECRET') || 'dev-secret',
        expiresIn: '4h',
      }),
      this.jwt.signAsync({ ...payload, jti: crypto.randomUUID() }, {
        secret: this.config.get('JWT_REFRESH_SECRET') || 'dev-refresh-secret',
        expiresIn: '7d',
      }),
    ]);
    return { accessToken, refreshToken };
  }
}
