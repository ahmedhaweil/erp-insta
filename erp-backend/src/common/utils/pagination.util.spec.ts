import { applyCursorPagination } from './pagination.util';

describe('applyCursorPagination', () => {
  let mockQb: Record<string, jest.Mock | any>;

  beforeEach(() => {
    mockQb = {
      alias: 'entity',
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      clone: jest.fn(),
      getMany: jest.fn(),
      getCount: jest.fn(),
    };
    mockQb.clone.mockReturnValue({ getCount: mockQb.getCount });
  });

  it('should return paginated results with defaults', async () => {
    const items = Array.from({ length: 5 }, (_, i) => ({
      id: `item-${i}`,
      createdAt: new Date(2024, 0, i + 1).toISOString(),
    }));
    mockQb.getMany.mockResolvedValue(items);
    mockQb.getCount.mockResolvedValue(5);

    const result = await applyCursorPagination(mockQb as any, {});

    expect(mockQb.orderBy).toHaveBeenCalledWith('entity.createdAt', 'DESC');
    expect(mockQb.take).toHaveBeenCalledWith(26); // default limit 25 + 1
    expect(result.data).toHaveLength(5);
    expect(result.meta.hasMore).toBe(false);
    expect(result.meta.cursor).toBeNull();
  });

  it('should indicate hasMore when there are more results', async () => {
    const items = Array.from({ length: 4 }, (_, i) => ({
      id: `item-${i}`,
      createdAt: new Date(2024, 0, i + 1).toISOString(),
    }));
    mockQb.getMany.mockResolvedValue(items);
    mockQb.getCount.mockResolvedValue(10);

    const result = await applyCursorPagination(mockQb as any, { limit: 3 });

    expect(mockQb.take).toHaveBeenCalledWith(4); // limit 3 + 1
    expect(result.data).toHaveLength(3);
    expect(result.meta.hasMore).toBe(true);
    expect(result.meta.cursor).toBeTruthy();
  });

  it('should apply cursor filter when cursor is provided', async () => {
    const cursor = Buffer.from('2024-01-15').toString('base64');
    mockQb.getMany.mockResolvedValue([]);
    mockQb.getCount.mockResolvedValue(0);

    await applyCursorPagination(mockQb as any, { cursor });

    expect(mockQb.andWhere).toHaveBeenCalledWith(
      'entity.createdAt < :cursor',
      { cursor: '2024-01-15' },
    );
  });

  it('should use ASC operator when sortOrder is ASC', async () => {
    const cursor = Buffer.from('2024-01-15').toString('base64');
    mockQb.getMany.mockResolvedValue([]);
    mockQb.getCount.mockResolvedValue(0);

    await applyCursorPagination(mockQb as any, { cursor, sortOrder: 'ASC' });

    expect(mockQb.andWhere).toHaveBeenCalledWith(
      'entity.createdAt > :cursor',
      { cursor: '2024-01-15' },
    );
  });

  it('should handle empty results', async () => {
    mockQb.getMany.mockResolvedValue([]);
    mockQb.getCount.mockResolvedValue(0);

    const result = await applyCursorPagination(mockQb as any, {});

    expect(result.data).toHaveLength(0);
    expect(result.meta.hasMore).toBe(false);
    expect(result.meta.cursor).toBeNull();
  });
});
