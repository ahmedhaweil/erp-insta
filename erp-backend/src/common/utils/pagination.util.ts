import { ObjectLiteral, SelectQueryBuilder } from 'typeorm';

export interface CursorPaginationOptions {
  cursor?: string;
  limit?: number;
  sortField?: string;
  sortOrder?: 'ASC' | 'DESC';
}

export interface CursorPaginationResult<T> {
  data: T[];
  meta: {
    cursor: string | null;
    hasMore: boolean;
    total: number;
  };
}

export async function applyCursorPagination<T extends ObjectLiteral>(
  qb: SelectQueryBuilder<T>,
  options: CursorPaginationOptions,
): Promise<CursorPaginationResult<T>> {
  const { cursor, limit = 25, sortField = 'createdAt', sortOrder = 'DESC' } = options;
  const alias = qb.alias;

  if (cursor) {
    const decoded = Buffer.from(cursor, 'base64').toString('utf-8');
    const operator = sortOrder === 'DESC' ? '<' : '>';
    qb.andWhere(`${alias}.${sortField} ${operator} :cursor`, { cursor: decoded });
  }

  qb.orderBy(`${alias}.${sortField}`, sortOrder);
  qb.take(limit + 1);

  const total = await qb.clone().getCount();
  const items = await qb.getMany();
  const hasMore = items.length > limit;

  if (hasMore) {
    items.pop();
  }

  const lastItem = items[items.length - 1];
  const nextCursor = lastItem
    ? Buffer.from(String((lastItem as any)[sortField])).toString('base64')
    : null;

  return {
    data: items,
    meta: {
      cursor: hasMore ? nextCursor : null,
      hasMore,
      total,
    },
  };
}
