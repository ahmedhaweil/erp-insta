import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Product } from '@modules/inventory/entities/product.entity';
import { Category } from '@modules/inventory/entities/category.entity';
import { AuthModule } from '@modules/auth/auth.module';
import { PromotionCampaign } from './entities/promotion-campaign.entity';
import { PromotionBonusRule } from './entities/promotion-bonus-rule.entity';
import { PromotionInvoiceDiscount } from './entities/promotion-invoice-discount.entity';
import { PromotionUsage } from './entities/promotion-usage.entity';
import { PromotionSettings } from './entities/promotion-settings.entity';
import { PromotionsService } from './services/promotions.service';
import { PromotionsController } from './controllers/promotions.controller';

/**
 * Promotions engine (Instasoft disc_item / disc_pouns / disc_fat): item
 * campaigns, bonus (buy X get Y), invoice-total discounts and the tenant
 * manual discount limit. Applied by POS orders and sales invoices / orders.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      PromotionCampaign,
      PromotionBonusRule,
      PromotionInvoiceDiscount,
      PromotionUsage,
      PromotionSettings,
      Product,
      Category,
    ]),
    AuthModule,
  ],
  controllers: [PromotionsController],
  providers: [PromotionsService],
  exports: [PromotionsService],
})
export class PromotionsModule {}
