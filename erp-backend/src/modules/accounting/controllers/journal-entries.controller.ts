import { Controller, Get, Post, Patch, Param, Body } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JournalEntriesService } from '../services/journal-entries.service';
import { CreateJournalEntryDto } from '../dto/create-journal-entry.dto';
import { CurrentTenant } from '@common/decorators/current-tenant.decorator';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { RequirePermissions } from '@common/decorators/require-permissions.decorator';
import { JwtPayload } from '@common/interfaces/request-with-user.interface';

@ApiTags('accounting')
@ApiBearerAuth()
@Controller('accounting/journal-entries')
export class JournalEntriesController {
  constructor(private readonly journalEntriesService: JournalEntriesService) {}

  @RequirePermissions({ module: 'accounting', screen: 'journal-entries', action: 'create' })
  @Post()
  create(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateJournalEntryDto,
  ) {
    return this.journalEntriesService.create(tenantId, user.sub, dto);
  }

  @RequirePermissions({ module: 'accounting', screen: 'journal-entries', action: 'read' })
  @Get()
  findAll(@CurrentTenant() tenantId: string) {
    return this.journalEntriesService.findAll(tenantId);
  }

  @RequirePermissions({ module: 'accounting', screen: 'journal-entries', action: 'read' })
  @Get(':id')
  findById(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.journalEntriesService.findById(tenantId, id);
  }

  @RequirePermissions({ module: 'accounting', screen: 'journal-entries', action: 'post' })
  @Patch(':id/post')
  post(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    return this.journalEntriesService.post(tenantId, user.sub, id);
  }

  @RequirePermissions({ module: 'accounting', screen: 'journal-entries', action: 'create' })
  @Post(':id/reverse')
  reverse(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    return this.journalEntriesService.reverse(tenantId, user.sub, id);
  }
}
