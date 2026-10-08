import { NotificationType } from '@modules/notifications/entities/notification.entity';

export enum AlertType {
  CHEQUES_DUE = 'cheques_due',
  CHEQUES_BOUNCED = 'cheques_bounced',
  OVERDUE_INVOICES = 'overdue_invoices',
  OVERDUE_INSTALLMENTS = 'overdue_installments',
  SUPPLIER_BILLS_DUE = 'supplier_bills_due',
  LOTS_EXPIRING = 'lots_expiring',
  EXPIRED_STOCK = 'expired_stock',
  LOW_STOCK = 'low_stock',
  PAYROLL_NOT_RUN = 'payroll_not_run',
  PERIOD_NOT_LOCKED = 'period_not_locked',
  EINVOICE_REJECTED = 'einvoice_rejected',
  POS_SESSION_OPEN = 'pos_session_open',
}

export interface AlertTypeDefinition {
  type: AlertType;
  title: { en: string; ar: string };
  description: { en: string; ar: string };
  /** Meaning of thresholdDays for this type (null when unused). */
  days: { default: number; meaning: { en: string; ar: string } } | null;
  hours: { default: number; meaning: { en: string; ar: string } } | null;
  severity: NotificationType;
  /** Frontend route of the related screen. */
  link: string;
  /** Extra params accepted in `params`. */
  params?: string[];
}

export const ALERT_TYPES: AlertTypeDefinition[] = [
  {
    type: AlertType.CHEQUES_DUE,
    title: { en: 'Cheques due', ar: 'شيكات مستحقة' },
    description: {
      en: 'Received cheques in portfolio / under collection and issued cheques due within N days (or overdue)',
      ar: 'الشيكات الواردة بالحافظة أو تحت التحصيل والشيكات الصادرة المستحقة خلال N يوم أو المتأخرة',
    },
    days: { default: 3, meaning: { en: 'Days ahead', ar: 'عدد الأيام القادمة' } },
    hours: null,
    severity: NotificationType.WARNING,
    link: '/treasury/cheques',
    params: ['chequeType (received | issued)'],
  },
  {
    type: AlertType.CHEQUES_BOUNCED,
    title: { en: 'Bounced cheques', ar: 'شيكات مرتدة' },
    description: { en: 'Cheques bounced in the last N days', ar: 'الشيكات المرتدة خلال آخر N يوم' },
    days: { default: 7, meaning: { en: 'Look-back days', ar: 'عدد الأيام السابقة' } },
    hours: null,
    severity: NotificationType.ERROR,
    link: '/treasury/cheques',
  },
  {
    type: AlertType.OVERDUE_INVOICES,
    title: { en: 'Overdue customer invoices', ar: 'فواتير عملاء متأخرة السداد' },
    description: {
      en: 'Posted customer invoices with a balance, past due by more than N days',
      ar: 'فواتير العملاء المرحّلة بها رصيد ومتأخرة أكثر من N يوم عن الاستحقاق',
    },
    days: { default: 0, meaning: { en: 'Grace days after due date', ar: 'أيام السماح بعد الاستحقاق' } },
    hours: null,
    severity: NotificationType.WARNING,
    link: '/sales/invoices',
    params: ['minAmount'],
  },
  {
    type: AlertType.OVERDUE_INSTALLMENTS,
    title: { en: 'Overdue installments', ar: 'أقساط متأخرة' },
    description: {
      en: 'Unpaid installments of active plans past due by more than N days',
      ar: 'أقساط خطط التقسيط النشطة غير المسددة والمتأخرة أكثر من N يوم',
    },
    days: { default: 0, meaning: { en: 'Grace days after due date', ar: 'أيام السماح بعد الاستحقاق' } },
    hours: null,
    severity: NotificationType.WARNING,
    link: '/sales/installments',
  },
  {
    type: AlertType.SUPPLIER_BILLS_DUE,
    title: { en: 'Supplier bills due', ar: 'فواتير موردين مستحقة' },
    description: {
      en: 'Approved vendor bills with a balance due within N days (or overdue)',
      ar: 'فواتير الموردين المعتمدة غير المسددة المستحقة خلال N يوم أو المتأخرة',
    },
    days: { default: 7, meaning: { en: 'Days ahead', ar: 'عدد الأيام القادمة' } },
    hours: null,
    severity: NotificationType.INFO,
    link: '/purchasing/invoices',
  },
  {
    type: AlertType.LOTS_EXPIRING,
    title: { en: 'Lots expiring', ar: 'تشغيلات قاربت على الانتهاء' },
    description: { en: 'Lots in stock expiring within N days', ar: 'التشغيلات بالمخزون التي تنتهي صلاحيتها خلال N يوم' },
    days: { default: 30, meaning: { en: 'Days ahead', ar: 'عدد الأيام القادمة' } },
    hours: null,
    severity: NotificationType.WARNING,
    link: '/inventory/lots',
  },
  {
    type: AlertType.EXPIRED_STOCK,
    title: { en: 'Expired stock', ar: 'مخزون منتهي الصلاحية' },
    description: { en: 'Lots in stock whose expiry date has passed', ar: 'تشغيلات بالمخزون انتهت صلاحيتها' },
    days: null,
    hours: null,
    severity: NotificationType.ERROR,
    link: '/inventory/lots',
  },
  {
    type: AlertType.LOW_STOCK,
    title: { en: 'Low stock / reorder', ar: 'نقص المخزون / حد الطلب' },
    description: {
      en: 'Active goods whose available quantity (on hand - reserved) is at or below the reorder level',
      ar: 'الأصناف التي وصلت الكمية المتاحة بها إلى حد الطلب أو أقل',
    },
    days: null,
    hours: null,
    severity: NotificationType.WARNING,
    link: '/purchasing/replenishment',
    params: ['warehouseId'],
  },
  {
    type: AlertType.PAYROLL_NOT_RUN,
    title: { en: 'Payroll not run', ar: 'لم يتم تشغيل الرواتب' },
    description: {
      en: 'No payroll run for the month although there are active employees; checked from day N of the month (earlier days check the previous month)',
      ar: 'لا يوجد مسير رواتب للشهر رغم وجود موظفين نشطين؛ يُفحص بدءًا من اليوم N من الشهر (قبله يُفحص الشهر السابق)',
    },
    days: { default: 25, meaning: { en: 'Day of month', ar: 'يوم الشهر' } },
    hours: null,
    severity: NotificationType.WARNING,
    link: '/hr/payroll',
  },
  {
    type: AlertType.PERIOD_NOT_LOCKED,
    title: { en: 'Fiscal period not locked', ar: 'فترة محاسبية غير مقفلة' },
    description: {
      en: 'The lock date is before the end of the last month that ended more than N days ago',
      ar: 'تاريخ الإقفال قبل نهاية آخر شهر انتهى منذ أكثر من N يوم',
    },
    days: { default: 10, meaning: { en: 'Grace days after month end', ar: 'أيام السماح بعد نهاية الشهر' } },
    hours: null,
    severity: NotificationType.INFO,
    link: '/accounting/settings',
  },
  {
    type: AlertType.EINVOICE_REJECTED,
    title: { en: 'E-invoices invalid / rejected', ar: 'فواتير إلكترونية مرفوضة / غير صالحة' },
    description: {
      en: 'ETA / ZATCA documents invalid, rejected or failed in the last N days',
      ar: 'مستندات منظومة الفاتورة الإلكترونية / فاتورة غير الصالحة أو المرفوضة أو الفاشلة خلال آخر N يوم',
    },
    days: { default: 7, meaning: { en: 'Look-back days', ar: 'عدد الأيام السابقة' } },
    hours: null,
    severity: NotificationType.ERROR,
    link: '/compliance/e-invoices',
  },
  {
    type: AlertType.POS_SESSION_OPEN,
    title: { en: 'POS sessions left open', ar: 'جلسات نقاط بيع مفتوحة' },
    description: { en: 'POS sessions open for more than X hours', ar: 'جلسات نقاط البيع المفتوحة أكثر من X ساعة' },
    days: null,
    hours: { default: 12, meaning: { en: 'Hours open', ar: 'عدد ساعات الفتح' } },
    severity: NotificationType.WARNING,
    link: '/pos/sessions',
  },
];

export const ALERT_TYPE_MAP = new Map(ALERT_TYPES.map((t) => [t.type, t]));
