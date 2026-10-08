import {
  Body,
  Controller,
  Get,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Post,
  Query,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentTenant } from '@common/decorators/current-tenant.decorator';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { RequirePermissions } from '@common/decorators/require-permissions.decorator';
import { JwtPayload } from '@common/interfaces/request-with-user.interface';
import { DataImportService, FileDownload } from '../services/data-import.service';
import { ImportEntity } from '../entities/import-job.entity';
import { ImportJobQueryDto, ImportOptionsDto, LangQueryDto, UploadedSpreadsheet } from '../dto/data-import.dto';
import { XLSX_MIME } from '../utils/spreadsheet.util';

/** Streams past the ResponseInterceptor (objects with `success` are left as is). */
class XlsxFile extends StreamableFile {
  readonly success = true;
}

const xlsx = (file: FileDownload) =>
  new XlsxFile(file.buffer, {
    type: XLSX_MIME,
    disposition: `attachment; filename="${file.filename}"`,
    length: file.buffer.length,
  });

const entityPipe = new ParseEnumPipe(ImportEntity);

@ApiTags('data-import')
@ApiBearerAuth()
@Controller('data-import')
export class DataImportController {
  constructor(private readonly service: DataImportService) {}

  @RequirePermissions({ module: 'settings', screen: 'import', action: 'read' })
  @Get('entities')
  @ApiOperation({ summary: 'Importable entities with their columns' })
  catalog() {
    return this.service.catalog();
  }

  @RequirePermissions({ module: 'settings', screen: 'import', action: 'read' })
  @Get('templates/:entity')
  @ApiOperation({ summary: 'Download the bilingual .xlsx template of an entity' })
  async template(@Param('entity', entityPipe) entity: ImportEntity, @Query() q: LangQueryDto) {
    return xlsx(await this.service.template(entity, q.lang));
  }

  @RequirePermissions({ module: 'settings', screen: 'import', action: 'create' })
  @Post(':entity/validate')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        updateExisting: { type: 'boolean' },
        createMissing: { type: 'boolean' },
        date: { type: 'string', format: 'date' },
        offsetAccountId: { type: 'string', format: 'uuid' },
        offsetAccountCode: { type: 'string' },
      },
    },
  })
  @ApiOperation({ summary: 'Upload a .xlsx/.csv file: returns the validation report (nothing is imported)' })
  validate(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('entity', entityPipe) entity: ImportEntity,
    @UploadedFile() file: UploadedSpreadsheet,
    @Body() dto: ImportOptionsDto,
  ) {
    return this.service.upload(tenantId, user.sub, entity, file, dto);
  }

  @RequirePermissions({ module: 'settings', screen: 'import', action: 'create' })
  @Post('jobs/:id/commit')
  @ApiOperation({ summary: 'Import a validated file: all rows or none' })
  commit(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.commit(tenantId, user.sub, id);
  }

  @RequirePermissions({ module: 'settings', screen: 'import', action: 'read' })
  @Get('jobs')
  jobs(@CurrentTenant() tenantId: string, @Query() query: ImportJobQueryDto) {
    return this.service.findJobs(tenantId, query);
  }

  @RequirePermissions({ module: 'settings', screen: 'import', action: 'read' })
  @Get('jobs/:id')
  job(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.findJob(tenantId, id);
  }

  @RequirePermissions({ module: 'settings', screen: 'import', action: 'read' })
  @Get('jobs/:id/errors')
  @ApiOperation({ summary: 'Download the rows with errors / warnings as .xlsx' })
  async errors(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: LangQueryDto,
  ) {
    return xlsx(await this.service.errorFile(tenantId, id, q.lang));
  }

  @RequirePermissions({ module: 'settings', screen: 'export', action: 'read' })
  @Get('export/:entity')
  @ApiOperation({ summary: 'Export master data (same columns as the import template)' })
  async export(
    @CurrentTenant() tenantId: string,
    @Param('entity', entityPipe) entity: ImportEntity,
    @Query() q: LangQueryDto,
  ) {
    return xlsx(await this.service.exportData(tenantId, entity, q.lang));
  }
}
