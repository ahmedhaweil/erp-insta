import { IsOptional, IsUUID } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { ReturnHeaderDto } from '@modules/sales/dto/sales-return.dto';

export class CreatePurchaseReturnDto extends ReturnHeaderDto {
  @ApiPropertyOptional({ description: 'Required for returns without an original bill' })
  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @ApiPropertyOptional({ description: 'Approved vendor bill the goods were bought on' })
  @IsOptional()
  @IsUUID()
  originalBillId?: string;
}
