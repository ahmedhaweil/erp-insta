import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FixedAsset } from '../entities/fixed-asset.entity';
import { JournalType } from '../entities/journal.entity';
import { CreateFixedAssetDto, DisposeAssetDto } from '../dto/fixed-asset.dto';
import { AutoPostingService } from './auto-posting.service';
import { round, today } from '@shared/utils/document-totals.util';

export interface DepreciationLine {
  date: string;
  amount: number;
  accumulated: number;
  bookValue: number;
}

function monthEnd(year: number, monthIndex: number): string {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).toISOString().split('T')[0];
}

/**
 * Full depreciation board, one line per month-end starting with the purchase
 * month (Odoo's depreciation board without prorata).
 */
export function computeDepreciationSchedule(asset: {
  purchaseDate: string;
  purchaseValue: number;
  salvageValue?: number;
  usefulLifeMonths: number;
  depreciationMethod?: string;
  decliningRate?: number;
}): DepreciationLine[] {
  const value = Number(asset.purchaseValue);
  const salvage = Number(asset.salvageValue || 0);
  const depreciable = Math.max(value - salvage, 0);
  const months = Number(asset.usefulLifeMonths);
  const start = new Date(`${asset.purchaseDate}T00:00:00Z`);
  const lines: DepreciationLine[] = [];
  let accumulated = 0;

  for (let i = 0; i < months; i++) {
    const remaining = round(depreciable - accumulated, 4);
    if (remaining <= 0) break;

    let amount: number;
    if (i === months - 1) {
      amount = remaining;
    } else if (
      asset.depreciationMethod === 'declining_balance' &&
      Number(asset.decliningRate) > 0
    ) {
      const bookValue = value - accumulated;
      const declining = (bookValue * Number(asset.decliningRate)) / 100 / 12;
      // Switch to straight-line once it depreciates faster (Odoo "degressive then linear").
      const linear = remaining / (months - i);
      amount = Math.max(declining, linear);
    } else {
      amount = depreciable / months;
    }
    amount = Math.min(round(amount, 4), remaining);
    accumulated = round(accumulated + amount, 4);

    lines.push({
      date: monthEnd(start.getUTCFullYear(), start.getUTCMonth() + i),
      amount,
      accumulated,
      bookValue: round(value - accumulated, 4),
    });
  }
  return lines;
}

@Injectable()
export class FixedAssetsService {
  constructor(
    @InjectRepository(FixedAsset)
    private readonly assetRepo: Repository<FixedAsset>,
    private readonly autoPosting: AutoPostingService,
  ) {}

  async create(tenantId: string, dto: CreateFixedAssetDto): Promise<FixedAsset> {
    if (Number(dto.salvageValue || 0) > Number(dto.purchaseValue)) {
      throw new BadRequestException('Salvage value cannot exceed the purchase value');
    }
    return this.assetRepo.save(this.assetRepo.create({ ...dto, tenantId }));
  }

  findAll(tenantId: string): Promise<FixedAsset[]> {
    return this.assetRepo.find({ where: { tenantId }, order: { code: 'ASC' } });
  }

  async findById(tenantId: string, id: string): Promise<FixedAsset> {
    const asset = await this.assetRepo.findOne({ where: { id, tenantId } });
    if (!asset) throw new NotFoundException('Fixed asset not found');
    return asset;
  }

  async getSchedule(tenantId: string, id: string) {
    const asset = await this.findById(tenantId, id);
    return computeDepreciationSchedule(asset).map((line) => ({
      ...line,
      posted: !!asset.lastDepreciationDate && line.date <= asset.lastDepreciationDate,
    }));
  }

  /** Posts every unposted monthly depreciation up to `asOf` for all active assets. */
  async runDepreciation(tenantId: string, userId: string, asOf: string = today()) {
    const assets = await this.assetRepo.find({ where: { tenantId, isDisposed: false } });
    const results: { assetId: string; code: string; posted: number; amount: number }[] = [];

    for (const asset of assets) {
      const { posted, amount } = await this.depreciateAsset(tenantId, userId, asset, asOf);
      if (posted > 0) results.push({ assetId: asset.id, code: asset.code, posted, amount });
    }
    return { asOf, assets: results };
  }

  async dispose(tenantId: string, userId: string, id: string, dto: DisposeAssetDto) {
    const asset = await this.findById(tenantId, id);
    if (asset.isDisposed) throw new ConflictException('Asset is already disposed');
    if (dto.date < asset.purchaseDate) {
      throw new BadRequestException('Disposal date cannot precede the purchase date');
    }

    await this.depreciateAsset(tenantId, userId, asset, dto.date);

    const cost = Number(asset.purchaseValue);
    const accumulated = Number(asset.accumulatedDepreciation);
    const proceeds = Number(dto.saleAmount || 0);
    const gainOrLoss = round(proceeds - (cost - accumulated), 4);

    await this.autoPosting.post({
      tenantId,
      userId,
      journalType: JournalType.GENERAL,
      date: dto.date,
      description: `Disposal of asset ${asset.code}`,
      sourceType: 'fixed_asset_disposal',
      sourceId: asset.id,
      buildLines: (settings, account) => [
        {
          accountId:
            asset.accumulatedDepreciationAccountId || account('accumulatedDepreciationAccountId'),
          debit: accumulated,
        },
        { accountId: account('bankAccountId'), debit: proceeds },
        { accountId: asset.accountId || this.missing('asset account'), credit: cost },
        gainOrLoss >= 0
          ? { accountId: account('assetDisposalAccountId'), credit: gainOrLoss }
          : { accountId: account('assetDisposalAccountId'), debit: -gainOrLoss },
      ],
    });

    asset.isDisposed = true;
    asset.disposalDate = dto.date;
    asset.disposalAmount = proceeds;
    await this.assetRepo.save(asset);
    return { asset, gainOrLoss };
  }

  private async depreciateAsset(
    tenantId: string,
    userId: string,
    asset: FixedAsset,
    asOf: string,
  ): Promise<{ posted: number; amount: number }> {
    const due = computeDepreciationSchedule(asset).filter(
      (l) => l.date <= asOf && (!asset.lastDepreciationDate || l.date > asset.lastDepreciationDate),
    );
    let amount = 0;
    for (const line of due) {
      await this.autoPosting.post({
        tenantId,
        userId,
        journalType: JournalType.GENERAL,
        date: line.date,
        description: `Depreciation ${asset.code} ${line.date.slice(0, 7)}`,
        sourceType: 'fixed_asset_depreciation',
        sourceId: asset.id,
        buildLines: (settings, account) => [
          {
            accountId:
              asset.depreciationExpenseAccountId || account('depreciationExpenseAccountId'),
            debit: line.amount,
          },
          {
            accountId:
              asset.accumulatedDepreciationAccountId || account('accumulatedDepreciationAccountId'),
            credit: line.amount,
          },
        ],
      });
      asset.accumulatedDepreciation = line.accumulated;
      asset.lastDepreciationDate = line.date;
      await this.assetRepo.save(asset);
      amount = round(amount + line.amount, 4);
    }
    return { posted: due.length, amount };
  }

  private missing(what: string): never {
    throw new BadRequestException(`Fixed asset has no ${what} configured`);
  }
}
