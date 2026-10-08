import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ChequePrintLayout } from '../entities/cheque-print-layout.entity';
import { CreateChequeLayoutDto, UpdateChequeLayoutDto } from '../dto/print.dto';
import { ChequeLayoutSpec, DEFAULT_CHEQUE_LAYOUT } from '../templates/cheque-renderer';
import { Direction } from '../engine/bidi-text';

/** Per-tenant cheque print layouts (field positions per bank cheque book). */
@Injectable()
export class ChequeLayoutsService {
  constructor(
    @InjectRepository(ChequePrintLayout)
    private readonly repo: Repository<ChequePrintLayout>,
  ) {}

  findAll(tenantId: string) {
    return this.repo.find({ where: { tenantId }, order: { isDefault: 'DESC', name: 'ASC' } });
  }

  async findById(tenantId: string, id: string) {
    const layout = await this.repo.findOne({ where: { id, tenantId } });
    if (!layout) throw new NotFoundException('Cheque layout not found');
    return layout;
  }

  /** The built-in layout, as a template for new ones. */
  defaults() {
    return DEFAULT_CHEQUE_LAYOUT;
  }

  async create(tenantId: string, dto: CreateChequeLayoutDto) {
    const layout = this.repo.create({
      tenantId,
      ...dto,
      fields: { ...DEFAULT_CHEQUE_LAYOUT.fields, ...(dto.fields ?? {}) },
    });
    if (layout.isDefault) await this.clearDefault(tenantId);
    return this.repo.save(layout);
  }

  async update(tenantId: string, id: string, dto: UpdateChequeLayoutDto) {
    const layout = await this.findById(tenantId, id);
    const { fields, ...rest } = dto;
    Object.assign(layout, rest);
    if (fields) layout.fields = { ...layout.fields, ...fields };
    if (dto.isDefault) await this.clearDefault(tenantId, id);
    return this.repo.save(layout);
  }

  async remove(tenantId: string, id: string) {
    const layout = await this.findById(tenantId, id);
    await this.repo.remove(layout);
    return { id, deleted: true };
  }

  private async clearDefault(tenantId: string, exceptId?: string) {
    const defaults = await this.repo.find({ where: { tenantId, isDefault: true } });
    for (const d of defaults.filter((l) => l.id !== exceptId)) {
      d.isDefault = false;
      await this.repo.save(d);
    }
  }

  /**
   * Layout for a cheque: explicit id, else the layout of its bank account,
   * else one matching the bank name, else the tenant default, else built-in.
   */
  async resolve(
    tenantId: string,
    opts: { layoutId?: string; treasuryId?: string | null; bankNames?: (string | null | undefined)[] },
  ): Promise<{ spec: ChequeLayoutSpec; lang: 'ar' | 'en' }> {
    let layout: ChequePrintLayout | null = null;
    if (opts.layoutId) layout = await this.findById(tenantId, opts.layoutId);
    else {
      const all = await this.repo.find({ where: { tenantId } });
      const norm = (s?: string | null) => (s ?? '').trim().toLowerCase();
      const names = (opts.bankNames ?? []).map(norm).filter(Boolean);
      layout =
        (opts.treasuryId && all.find((l) => l.treasuryId === opts.treasuryId)) ||
        all.find((l) => l.bankName && names.includes(norm(l.bankName))) ||
        all.find((l) => l.isDefault) ||
        null;
    }
    if (!layout) return { spec: DEFAULT_CHEQUE_LAYOUT, lang: 'ar' };
    return { spec: toSpec(layout), lang: layout.lang === 'en' ? 'en' : 'ar' };
  }
}

export function toSpec(layout: ChequePrintLayout): ChequeLayoutSpec {
  const width = Number(layout.widthMm);
  const height = Number(layout.heightMm);
  if (!(width > 0) || !(height > 0)) throw new BadRequestException('Invalid cheque size');
  return {
    widthMm: width,
    heightMm: height,
    direction: (layout.direction === 'ltr' ? 'ltr' : 'rtl') as Direction,
    dateFormat: layout.dateFormat,
    amountFrame: layout.amountFrame,
    offsetX: Number(layout.offsetX || 0),
    offsetY: Number(layout.offsetY || 0),
    fields: { ...DEFAULT_CHEQUE_LAYOUT.fields, ...(layout.fields ?? {}) },
  };
}
