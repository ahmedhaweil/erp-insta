import { Controller, Get, Post, Body, Req, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { AuthService } from '../services/auth.service';
import { LoginDto } from '../dto/login.dto';
import { RefreshTokenDto } from '../dto/refresh-token.dto';
import { Verify2faDto } from '../dto/verify-2fa.dto';
import { ForgotPasswordDto } from '../dto/forgot-password.dto';
import { ResetPasswordDto } from '../dto/reset-password.dto';
import { Public } from '@common/decorators/public.decorator';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { JwtPayload } from '@common/interfaces/request-with-user.interface';
import { UsersService } from '../services/users.service';
import { ChangePasswordDto, TwoFaCodeDto } from '../dto/admin.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly usersService: UsersService,
  ) {}

  @Get('me')
  me(@CurrentUser() user: JwtPayload) {
    return this.usersService.findById(user.tenantId, user.sub);
  }

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  changePassword(@CurrentUser() user: JwtPayload, @Body() dto: ChangePasswordDto) {
    return this.usersService.changeOwnPassword(
      user.tenantId,
      user.sub,
      dto.currentPassword,
      dto.newPassword,
    );
  }

  @Post('2fa/setup')
  @HttpCode(HttpStatus.OK)
  setupTwoFa(@CurrentUser() user: JwtPayload) {
    return this.usersService.setupTwoFa(user.tenantId, user.sub);
  }

  @Post('2fa/enable')
  @HttpCode(HttpStatus.OK)
  enableTwoFa(@CurrentUser() user: JwtPayload, @Body() dto: TwoFaCodeDto) {
    return this.usersService.enableTwoFa(user.tenantId, user.sub, dto.code);
  }

  @Post('2fa/disable')
  @HttpCode(HttpStatus.OK)
  disableTwoFa(@CurrentUser() user: JwtPayload, @Body() dto: TwoFaCodeDto) {
    return this.usersService.disableTwoFa(user.tenantId, user.sub, dto.code);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.authService.login(dto, req.ip, req.headers['user-agent']);
  }

  @Public()
  @Post('2fa/verify')
  @HttpCode(HttpStatus.OK)
  verify2fa(@Body() dto: Verify2faDto, @Req() req: Request) {
    return this.authService.verify2fa(dto.tempToken, dto.code, req.ip, req.headers['user-agent']);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() dto: RefreshTokenDto, @Req() req: Request) {
    return this.authService.refreshToken(dto.refreshToken, req.ip);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  logout(@CurrentUser() user: JwtPayload) {
    return this.authService.logout(user.sub);
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto.email, dto.tenantSlug);
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto.token, dto.newPassword);
  }
}
