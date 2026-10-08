import { BadRequestException } from '@nestjs/common';
import { BomsService } from './boms.service';
import { BomLineType } from '../entities/bom-line.entity';
import { ProductType } from '@modules/inventory/entities/product.entity';

const line = (productId: string, quantity: number, scrapPercent = 0, type = BomLineType.COMPONENT, costSharePercent = 0) =>
  ({ productId, quantity, scrapPercent, type, costSharePercent, sequence: 0 }) as any;

describe('BomsService', () => {
  let service: BomsService;
  let boms: any[];
  let bomRepo: Record<string, jest.Mock>;
  const costs: Record<string, number> = { steel: 5, screw: 0.5, paint: 2, frame: 999 };

  beforeEach(() => {
    // Table (output 2) = 1 frame + 8 screws (+25% scrap) + labour 10/unit; by-product sawdust 10% cost
    // Frame (output 1) = 4 steel (+5% scrap) + 0.5 paint, overhead 3/unit
    boms = [
      {
        id: 'bom-table', productId: 'table', outputQuantity: 2, isActive: true, version: 1,
        labourCostPerUnit: 10, overheadCostPerUnit: 0,
        lines: [line('frame', 2), line('screw', 8, 25), line('sawdust', 1, 0, BomLineType.BY_PRODUCT, 10)],
      },
      {
        id: 'bom-frame', productId: 'frame', outputQuantity: 1, isActive: true, version: 1,
        labourCostPerUnit: 0, overheadCostPerUnit: 3,
        lines: [line('steel', 4, 5), line('paint', 0.5)],
      },
    ];
    bomRepo = {
      findOne: jest.fn(async ({ where }) =>
        boms.find(
          (b) =>
            (!where.id || b.id === where.id) &&
            (!where.productId || b.productId === where.productId) &&
            (where.isActive === undefined || b.isActive === where.isActive),
        ) ?? null,
      ),
      save: jest.fn(async (b) => ({ id: 'new-bom', ...b })),
      create: jest.fn((b) => b),
      update: jest.fn(),
    };
    const productRepo = {
      findOne: jest.fn(async ({ where }) => ({ id: where.id, type: ProductType.GOODS })),
      find: jest.fn(async ({ where }) =>
        (where.id._value as string[]).map((id) => ({ id, code: id, type: ProductType.GOODS })),
      ),
    };
    service = new BomsService(
      bomRepo as any,
      { create: jest.fn((l) => l), delete: jest.fn(), save: jest.fn() } as any,
      { count: jest.fn() } as any,
      productRepo as any,
      { getUnitCost: jest.fn(async (_t, id) => costs[id] ?? 0) } as any,
      { next: jest.fn().mockResolvedValue('BOM-000001') } as any,
    );
  });

  it('explodes multi-level BOMs into leaf components with scrap and sub-assembly overhead', async () => {
    const result = await service.explode('t1', boms[0], 4, true);
    // factor 2: frame 4, screws 16 x 1.25 = 20; frame 4 -> steel 16 x 1.05 = 16.8, paint 2
    expect(result.components).toEqual([
      { productId: 'steel', quantity: 16.8, level: 2 },
      { productId: 'paint', quantity: 2, level: 2 },
      { productId: 'screw', quantity: 20, level: 1 },
    ]);
    expect(result.subAssemblies).toEqual([{ productId: 'frame', quantity: 4, level: 1 }]);
    expect(result.labourCost).toBe(40);
    expect(result.overheadCost).toBe(12);
    expect(result.byProducts).toEqual([{ productId: 'sawdust', quantity: 2, costSharePercent: 10 }]);
  });

  it('keeps sub-assemblies as components when explosion is not requested', async () => {
    const result = await service.explode('t1', boms[0], 2, false);
    expect(result.components.map((c) => c.productId)).toEqual(['frame', 'screw']);
    expect(result.overheadCost).toBe(0);
  });

  it('detects circular structures', async () => {
    boms[1].lines.push(line('table', 1));
    await expect(service.explode('t1', boms[0], 1, true)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rolls up cost using sub-BOM costs and assigns the by-product share', async () => {
    jest.spyOn(service, 'findById').mockResolvedValue(boms[0]);
    const result = await service.costRollup('t1', 'bom-table');
    // frame unit = 4.2 x 5 + 0.5 x 2 + 3 = 25 ; 2 frames = 50 ; screws 10 x 0.5 = 5
    expect(result.lines.find((l) => l.productId === 'frame')).toMatchObject({ unitCost: 25, cost: 50, costSource: 'sub_bom' });
    expect(result.materialCost).toBe(55);
    expect(result.labourCost).toBe(20);
    expect(result.totalCost).toBe(75);
    expect(result.byProductCost).toBe(7.5);
    expect(result.unitCost).toBe(33.75);
  });

  it('rejects a BOM whose component is the finished product', async () => {
    await expect(
      service.create('t1', 'u1', { productId: 'table', components: [{ productId: 'table', quantity: 1 }] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a BOM that would create a cycle through an active sub-BOM', async () => {
    // steel made from table while table -> frame -> steel
    await expect(
      service.create('t1', 'u1', { productId: 'steel', components: [{ productId: 'table', quantity: 1 }] }),
    ).rejects.toThrow('Circular BOM structure detected');
  });

  it('rejects by-product cost shares of 100% or more', async () => {
    await expect(
      service.create('t1', 'u1', {
        productId: 'chair',
        components: [{ productId: 'steel', quantity: 1 }],
        byProducts: [{ productId: 'sawdust', quantity: 1, costSharePercent: 100 }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
