// API Response envelope
export interface ApiResponse<T> {
  data: T;
  meta?: {
    cursor: string | null;
    hasMore: boolean;
    total: number;
  };
}

// Auth
export interface LoginRequest {
  email: string;
  password: string;
  tenantSlug: string;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    name: string;
    email: string;
    roles: string[];
  };
}

export interface TwoFaResponse {
  requires2fa: true;
  tempToken: string;
}

// Accounting
export interface Account {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string;
  type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
  parentId: string | null;
  level: number;
  isActive: boolean;
  allowPosting: boolean;
  description: string | null;
  children?: Account[];
}

export interface JournalEntry {
  id: string;
  refNumber: string;
  date: string;
  description: string;
  status: 'draft' | 'posted' | 'cancelled';
  createdBy: string;
  postedAt: string | null;
  lines: JournalLine[];
}

export interface JournalLine {
  id: string;
  accountId: string;
  debit: number;
  credit: number;
  description: string;
  costCenterId: string | null;
}

// Inventory
export interface Product {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string;
  type: 'goods' | 'service';
  barcode: string | null;
  sku: string | null;
  categoryId: string | null;
  costPrice: number;
  sellPrice: number;
  isActive: boolean;
}

export interface Warehouse {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string;
  branchId: string;
  isActive: boolean;
}

export interface Stock {
  productId: string;
  warehouseId: string;
  quantity: number;
  reservedQty: number;
}

// Sales
export interface Customer {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string;
  phone: string;
  email: string | null;
  taxId: string | null;
  creditLimit: number;
  balance: number;
  isActive: boolean;
}

export interface SalesOrder {
  id: string;
  customerId: string;
  orderNumber: string;
  date: string;
  status: 'draft' | 'confirmed' | 'delivered' | 'cancelled';
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  lines: OrderLine[];
}

export interface OrderLine {
  id: string;
  productId: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  taxRate: number;
  lineTotal: number;
}

export interface SalesInvoice {
  id: string;
  customerId: string;
  invoiceNumber: string;
  date: string;
  dueDate: string;
  status: 'draft' | 'sent' | 'paid' | 'partial' | 'overdue' | 'cancelled';
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  paidAmount: number;
  lines: OrderLine[];
}

// Purchasing
export interface Supplier {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string;
  phone: string;
  email: string | null;
  taxId: string | null;
  creditLimit: number;
  balance: number;
  isActive: boolean;
}

export interface PurchaseOrder {
  id: string;
  supplierId: string;
  orderNumber: string;
  date: string;
  status: 'draft' | 'confirmed' | 'received' | 'cancelled';
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  lines: OrderLine[];
}

export interface PurchaseInvoice {
  id: string;
  supplierId: string;
  invoiceNumber: string;
  date: string;
  dueDate: string;
  status: 'draft' | 'approved' | 'paid' | 'partial' | 'overdue' | 'cancelled';
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  paidAmount: number;
  lines: OrderLine[];
}

// POS
export interface PosSession {
  id: string;
  terminalId: string;
  openedAt: string;
  closedAt: string | null;
  openingCash: number;
  closingCash: number | null;
  status: 'open' | 'closed';
}

export interface PosOrder {
  id: string;
  sessionId: string;
  orderNumber: string;
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  paymentMethod: 'cash' | 'card' | 'split';
  status: 'completed' | 'refunded' | 'void';
}

// Compliance
export interface TaxConfig {
  id: string;
  country: 'EG' | 'SA';
  taxType: string;
  rate: number;
  nameAr: string;
  nameEn: string;
  isActive: boolean;
}

export interface EInvoice {
  id: string;
  invoiceId: string;
  invoiceType: 'sales' | 'purchase';
  status: 'pending' | 'submitted' | 'accepted' | 'rejected';
  submittedAt: string | null;
  provider: 'eta' | 'zatca';
}

// Notifications
export interface Notification {
  id: string;
  title: string;
  body: string;
  type: 'info' | 'warning' | 'error' | 'success';
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
}

// Tenant
export interface Tenant {
  id: string;
  slug: string;
  name: string;
  plan: string;
  isActive: boolean;
  country: string;
}
