import { ProductType, TrackingType } from '@modules/inventory/entities/product.entity';
import { AccountType } from '@modules/accounting/entities/account.entity';
import { ProductsImporter } from './products.importer';
import { AccountsImporter } from './accounts.importer';
import { OpeningCustomerBalancesImporter, OpeningSupplierBalancesImporter } from './opening-balances.importer';
import { OpeningStockImporter } from './opening-stock.importer';
import { ImportContext } from './importer.types';
import { ParsedRow } from '../utils/spreadsheet.util';

const ctx = (options: Partial<ImportContext['options']> = {}): ImportContext => ({
  tenantId: 't1',
  userId: 'u1',
  jobId: 'job-1',
  options: { updateExisting: true, createMissing: false, ...options },
});

let rowNo = 1;
const row = (values: Record<string, unknown>): ParsedRow => ({
  rowNumber: ++rowNo,
  values,
  raw: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, String(v)])),
});

const repo = (items: any[] = []) => ({
  find: jest.fn().mockResolvedValue(items),
  findOne: jest.fn().mockResolvedValue(null),
  create: jest.fn((x) => x),
  save: jest.fn(async (x) => ({ id: `new-${x.nameAr ?? x.code}`, ...x })),
});

describe('ProductsImporter', () => {
  const existing = {
    id: 'p1',
    code: 'P-1',
    unitId: 'kg',
    barcode: '111',
    trackingType: TrackingType.NONE,
    hasExpiry: false,
    type: ProductType.GOODS,
  };
  let products: any;
  let service: any;
  let importer: ProductsImporter;

  beforeEach(() => {
    products = {
      create: jest.fn(async (_t, dto) => ({ id: 'created', ...dto })),
      update: jest.fn(),
      upsertUnit: jest.fn(),
    };
    service = products;
    importer = new ProductsImporter(
      repo([existing]) as any,
      repo([{ id: 'cat1', nameAr: 'أغذية', nameEn: 'Food' }]) as any,
      repo([
        { id: 'kg', symbol: 'kg', nameAr: 'كيلو' },
        { id: 'box', symbol: 'box', nameAr: 'كرتونة' },
      ]) as any,
      repo([{ productId: 'p1', barcode: '222' }]) as any,
      repo([]) as any,
      service,
    );
  });

  it('plans updates for existing codes and creates for new ones; flags duplicate codes', async () => {
    const out = await importer.validate(ctx(), [
      row({ code: 'P-1', nameAr: 'سكر', sellPrice: 10 }),
      row({ code: 'P-2', nameAr: 'أرز', category: 'food', unit: 'KG' }),
      row({ code: 'p-2', nameAr: 'مكرر', category: 'food', unit: 'kg' }),
    ]);
    expect(out.planned.map((p) => p.action)).toEqual(['update', 'create', 'create']);
    expect(out.planned[1].data.dto).toMatchObject({ categoryId: 'cat1', unitId: 'kg', type: ProductType.GOODS });
    expect(out.issues.map((i) => i.code)).toEqual(['duplicate_in_file']);
  });

  it('skips existing products when updateExisting is off', async () => {
    const out = await importer.validate(ctx({ updateExisting: false }), [row({ code: 'P-1', nameAr: 'x' })]);
    expect(out.planned[0].action).toBe('skip');
    expect(out.issues[0].code).toBe('exists_skipped');
  });

  it('rejects unknown category/unit unless createMissing, and barcodes used by other products', async () => {
    const strict = await importer.validate(ctx(), [
      row({ code: 'N-1', nameAr: 'x', category: 'Drinks', unit: 'liter', barcode: '222' }),
    ]);
    expect(strict.issues.map((i) => i.code)).toEqual(['not_found', 'not_found', 'barcode_used']);

    const lenient = await importer.validate(ctx({ createMissing: true }), [
      row({ code: 'N-1', nameAr: 'x', category: 'Drinks', unit: 'liter' }),
      row({ code: 'N-2', nameAr: 'y', category: 'drinks', unit: 'Liter' }),
    ]);
    expect(lenient.issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(lenient.summary).toEqual({ newCategories: ['Drinks'], newUnits: ['liter'] });

    await importer.commit(ctx(), lenient);
    expect(products.create).toHaveBeenCalledTimes(2);
    expect(products.create.mock.calls[0][1]).toMatchObject({ categoryId: 'new-Drinks', unitId: 'new-liter' });
  });

  it('validates alternate units, tracking and base unit changes', async () => {
    const out = await importer.validate(ctx(), [
      row({ code: 'P-1', nameAr: 'x', unit: 'box' }),
      row({ code: 'N-3', nameAr: 'y', category: 'Food', unit: 'kg', altUnit1: 'kg', altUnit1Factor: 2 }),
      row({ code: 'N-4', nameAr: 'z', category: 'Food', unit: 'kg', altUnit1: 'box' }),
      row({ code: 'N-5', nameAr: 'w', category: 'Food', unit: 'kg', hasExpiry: true }),
      row({ code: 'N-6', nameAr: 'v', category: 'Food', unit: 'kg', altUnit1: 'box', altUnit1Factor: 12, altUnit1Barcode: '999' }),
    ]);
    expect(out.issues.map((i) => `${i.row - out.planned[0].row.rowNumber}:${i.code}`)).toEqual([
      '0:unit_change',
      '1:alt_is_base',
      '2:required',
      '3:expiry_needs_tracking',
    ]);
    await importer.commit(ctx(), { ...out, planned: [out.planned[4]] });
    expect(products.upsertUnit).toHaveBeenCalledWith('t1', 'created', {
      unitId: 'box',
      factor: 12,
      barcode: '999',
      sellPrice: undefined,
    });
  });
});

describe('AccountsImporter', () => {
  const existing = [
    { id: 'a3', code: '3', type: AccountType.EQUITY, parentId: null, allowPosting: false },
    { id: 'a33', code: '33', type: AccountType.EQUITY, parentId: 'a3', allowPosting: false },
  ];
  let accounts: any;
  let importer: AccountsImporter;

  beforeEach(() => {
    accounts = {
      create: jest.fn(async (_t, dto) => ({ id: `id-${dto.code}`, ...dto })),
      update: jest.fn(),
    };
    importer = new AccountsImporter(repo(existing) as any, accounts);
  });

  it('inherits the parent type, makes parents non-postable and creates parents before children', async () => {
    const out = await importer.validate(ctx(), [
      row({ code: '330201', nameAr: 'افتتاحي', parentCode: '3302' }),
      row({ code: '3302', nameAr: 'أرصدة افتتاحية', parentCode: '33' }),
    ]);
    expect(out.issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(out.planned[0].data.dto).toMatchObject({ type: AccountType.EQUITY, allowPosting: true });
    expect(out.planned[1].data.dto).toMatchObject({ type: AccountType.EQUITY, allowPosting: false });

    await importer.commit(ctx(), out);
    expect(accounts.create.mock.calls.map((c: any[]) => [c[1].code, c[1].parentId])).toEqual([
      ['3302', 'a33'],
      ['330201', 'id-3302'],
    ]);
  });

  it('reports missing parents, loops and top-level accounts without type', async () => {
    const out = await importer.validate(ctx(), [
      row({ code: '9', nameAr: 'x', parentCode: '999' }),
      row({ code: '7', nameAr: 'a', parentCode: '8' }),
      row({ code: '8', nameAr: 'b', parentCode: '7' }),
      row({ code: '6', nameAr: 'c' }),
    ]);
    const codes = out.issues.filter((i) => i.severity === 'error').map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(['not_found', 'cycle', 'required']));
  });
});

describe('Opening balances', () => {
  const settings = { retainedEarningsAccountId: 're' };
  const accountRepo = () => ({
    ...repo([{ id: 'eq', code: '330201', isActive: true, allowPosting: true }]),
    findOne: jest.fn().mockResolvedValue({ id: 're', code: '330101' }),
  });
  const autoPosting = () => ({ preflight: jest.fn() });
  const openingApi = () => ({
    postPartners: jest.fn(async (_t: string, _u: string, dto: any) =>
      dto.documents.map((d: any, i: number) => ({ id: `ob-${i}`, documentNumber: `OB-${d.amount}` })),
    ),
  });

  it('customers: refuses unknown partners and missing accounting setup; offset defaults to retained earnings', async () => {
    const importer = new OpeningCustomerBalancesImporter(
      { query: jest.fn() } as any,
      accountRepo() as any,
      repo([{ id: 'c1', code: 'C-1' }]) as any,
      autoPosting() as any,
      { find: jest.fn().mockResolvedValue(settings) } as any,
      openingApi() as any,
    );
    const out = await importer.validate(ctx(), [row({ partnerCode: 'C-1', amount: 950 }), row({ partnerCode: 'X', amount: 1 })]);
    expect(out.issues.map((i) => i.code)).toEqual(expect.arrayContaining(['offset_default', 'not_found']));
    expect((out as any).offset.accountId).toBe('re');

    const unconfigured = new OpeningCustomerBalancesImporter(
      { query: jest.fn() } as any,
      accountRepo() as any,
      repo([{ id: 'c1', code: 'C-1' }]) as any,
      autoPosting() as any,
      { find: jest.fn().mockResolvedValue(null) } as any,
      openingApi() as any,
    );
    const blocked = await unconfigured.validate(ctx(), [row({ partnerCode: 'C-1', amount: 5 })]);
    expect(blocked.issues.map((i) => i.code)).toContain('accounting_not_configured');
  });

  it('customers: posts opening documents through the accounting opening API, one call per date', async () => {
    const api = openingApi();
    const importer = new OpeningCustomerBalancesImporter(
      { query: jest.fn() } as any,
      accountRepo() as any,
      repo([{ id: 'c1', code: 'C-1' }]) as any,
      autoPosting() as any,
      { find: jest.fn().mockResolvedValue(settings) } as any,
      api as any,
    );
    const context = ctx({ offsetAccountCode: '330201', date: '2026-01-01' });
    const out = await importer.validate(context, [
      row({ partnerCode: 'C-1', amount: 500 }),
      row({ partnerCode: 'C-1', amount: -50, reference: 'R1', notes: 'old credit' }),
      row({ partnerCode: 'C-1', amount: 70, date: '2025-12-31' }),
    ]);
    expect(out.issues).toEqual([]);
    const result = await importer.commit(context, out);

    expect(api.postPartners).toHaveBeenCalledTimes(2);
    expect(api.postPartners.mock.calls[0][2]).toEqual({
      date: '2026-01-01',
      equityAccountId: 'eq',
      documents: [
        { partnerType: 'customer', partnerId: 'c1', amount: 500, dueDate: undefined, reference: undefined },
        { partnerType: 'customer', partnerId: 'c1', amount: -50, dueDate: undefined, reference: 'R1 - old credit' },
      ],
    });
    expect(api.postPartners.mock.calls[1][2]).toMatchObject({ date: '2025-12-31' });
    expect(result).toEqual({ documents: ['OB-500', 'OB--50', 'OB-70'], positive: 570, negative: 50 });
  });

  it('suppliers: duplicate vendor references are refused', async () => {
    const dataSource = { query: jest.fn().mockResolvedValue([{ supplier_id: 's1', supplier_reference: 'B-1' }]) };
    const importer = new OpeningSupplierBalancesImporter(
      dataSource as any,
      accountRepo() as any,
      repo([{ id: 's1', code: 'S-1' }]) as any,
      autoPosting() as any,
      { find: jest.fn().mockResolvedValue(settings) } as any,
      openingApi() as any,
    );
    const out = await importer.validate(ctx({ offsetAccountCode: '330201' }), [
      row({ partnerCode: 'S-1', amount: 10, reference: 'b-1' }),
    ]);
    expect(out.issues.map((i) => i.code)).toEqual(['duplicate_reference']);
  });
});

describe('OpeningStockImporter', () => {
  it('converts alternate units, values the stock and posts Dr inventory / Cr offset', async () => {
    const products = repo([
      { id: 'p1', code: 'P-1', type: ProductType.GOODS, trackingType: TrackingType.NONE, costPrice: 7 },
      { id: 'p2', code: 'P-2', type: ProductType.GOODS, trackingType: TrackingType.LOT, hasExpiry: true, costPrice: 0 },
      { id: 's1', code: 'S-1', type: ProductType.SERVICE, trackingType: TrackingType.NONE },
    ]);
    const stockService = { receive: jest.fn() };
    const productsService = { unitFactor: jest.fn().mockResolvedValue(12) };
    const posting = { preflight: jest.fn(), post: jest.fn().mockResolvedValue({ id: 'je' }) };
    const importer = new OpeningStockImporter(
      products as any,
      repo([{ id: 'w1', code: 'WH1' }]) as any,
      repo([{ id: 'box', symbol: 'box' }]) as any,
      repo([{ productId: 'p1', warehouseId: 'w1', quantity: 5 }]) as any,
      repo() as any,
      stockService as any,
      productsService as any,
      posting as any,
      { find: jest.fn().mockResolvedValue({ stockAdjustmentAccountId: 'adj' }) } as any,
    );
    const context = ctx();
    const out = await importer.validate(context, [
      row({ productCode: 'P-1', warehouseCode: 'WH1', quantity: 2, unitCost: 120, unit: 'box' }),
      row({ productCode: 'P-2', warehouseCode: 'WH1', quantity: 3 }),
      row({ productCode: 'S-1', warehouseCode: 'WH1', quantity: 1 }),
      row({ productCode: 'P-2', warehouseCode: 'WH1', quantity: 4, unitCost: 2, lotNumber: 'L1', expiryDate: '2027-01-01' }),
    ]);
    expect(out.issues.filter((i) => i.severity === 'error').map((i) => i.code)).toEqual(['required', 'not_stockable']);
    expect(out.planned.map((p) => [p.data.quantity, p.data.unitCost])).toEqual([
      [24, 10],
      [4, 2],
    ]);
    expect(out.summary).toMatchObject({ totalValue: 248 });

    await importer.commit(context, out);
    expect(stockService.receive).toHaveBeenCalledWith('t1', 'u1', expect.objectContaining({
      productId: 'p2',
      quantity: 4,
      referenceType: 'opening_stock',
      referenceId: 'job-1',
      lots: [{ lotNumber: 'L1', quantity: 4, expiryDate: '2027-01-01' }],
    }));
    const lines = posting.post.mock.calls[0][0].buildLines({}, (k: string) => k);
    expect(lines).toEqual([
      { accountId: 'inventoryAccountId', debit: 248 },
      { accountId: 'adj', credit: 248 },
    ]);
  });
});
