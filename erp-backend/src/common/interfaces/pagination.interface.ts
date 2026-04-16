export interface CursorPaginationMeta {
  cursor: string | null;
  hasMore: boolean;
  total?: number;
}

export interface OffsetPaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export type PaginationMeta = CursorPaginationMeta | OffsetPaginationMeta;
