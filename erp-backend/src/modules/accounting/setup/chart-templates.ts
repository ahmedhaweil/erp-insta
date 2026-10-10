import { AccountType } from '../entities/account.entity';
import type { SettingsAccountKey } from '../services/auto-posting.service';

/**
 * Chart-of-accounts templates used by the accounting setup wizard.
 *
 * Numbering (both templates): a 4-level hierarchy where every level extends
 * its parent's code.
 *
 *   level 0  1 digit   class         1 Assets, 2 Liabilities, 3 Equity, 4 Revenue, 5/6 Expenses
 *   level 1  2 digits  group         11 Non-current assets, 12 Current assets, 21 Non-current liabilities...
 *   level 2  4 digits  sub-group     1201 Inventory, 2202 Taxes payable...
 *   level 3  6 digits  postable leaf 120101 Merchandise inventory...
 *
 * Only the 6-digit leaves allow posting; the classes, groups and sub-groups
 * are view accounts (allowPosting = false). Users add their own leaves (e.g. a
 * second bank 120404, a customer sub-ledger account) under any sub-group.
 *
 * Conventions relied upon by the reports (cash-flow classification):
 * `11xx` = non-current assets (investing), `21xx` = non-current liabilities
 * (financing), class 3 = equity (financing).
 *
 * Egypt ("eg"): the widely used 1..5 layout of Egyptian SME software
 * (1 assets, 2 liabilities, 3 equity, 4 revenue, 5 expenses) rather than the
 * public-sector Unified Accounting System (where 2 = liabilities AND equity,
 * 3 = uses and 4 = resources), with VAT 14 %, withholding (خصم وإضافة),
 * salary tax (كسب العمل) and social insurance accounts.
 *
 * Saudi Arabia ("sa"): SOCPA / IFRS-for-SMEs style layout with a separate
 * cost-of-revenue class (5) and operating expenses (6), VAT 15 %, zakat,
 * GOSI and end-of-service benefit accounts.
 */
export type ChartTemplateCode = 'eg' | 'sa';

/** [code, Arabic name, English name, accounting-settings key filled with this leaf] */
export type ChartTemplateRow = [string, string, string, SettingsAccountKey?];

export interface ChartTemplate {
  code: ChartTemplateCode;
  nameAr: string;
  nameEn: string;
  country: 'EG' | 'SA';
  baseCurrency: 'EGP' | 'SAR';
  /** Account type per class digit. */
  classTypes: Record<string, AccountType>;
  rows: ChartTemplateRow[];
}

const STANDARD_CLASSES: Record<string, AccountType> = {
  '1': AccountType.ASSET,
  '2': AccountType.LIABILITY,
  '3': AccountType.EQUITY,
  '4': AccountType.REVENUE,
  '5': AccountType.EXPENSE,
  '6': AccountType.EXPENSE,
};

const EG_ROWS: ChartTemplateRow[] = [
  ['1', 'الأصول', 'Assets'],
  ['11', 'الأصول غير المتداولة', 'Non-current assets'],
  ['1101', 'الأصول الثابتة', 'Fixed assets'],
  ['110101', 'الأراضي', 'Land'],
  ['110102', 'المباني والإنشاءات', 'Buildings'],
  ['110103', 'الآلات والمعدات', 'Machinery and equipment'],
  ['110104', 'وسائل النقل والانتقال', 'Vehicles'],
  ['110105', 'الأثاث والتجهيزات المكتبية', 'Furniture and office equipment'],
  ['110106', 'أجهزة الحاسب الآلي', 'Computer equipment'],
  ['1102', 'مجمع الإهلاك', 'Accumulated depreciation'],
  ['110201', 'مجمع إهلاك الأصول الثابتة', 'Accumulated depreciation of fixed assets', 'accumulatedDepreciationAccountId'],
  ['1103', 'الأصول غير الملموسة', 'Intangible assets'],
  ['110301', 'البرامج والتراخيص', 'Software and licences'],
  ['1104', 'الاستثمارات طويلة الأجل', 'Long-term investments'],
  ['110401', 'استثمارات في شركات', 'Investments in companies'],
  ['12', 'الأصول المتداولة', 'Current assets'],
  ['1201', 'المخزون', 'Inventory'],
  ['120101', 'مخزون البضاعة', 'Merchandise inventory', 'inventoryAccountId'],
  ['120102', 'مخزون الخامات', 'Raw materials'],
  ['120103', 'مخزون الإنتاج التام', 'Finished goods'],
  ['120104', 'بضاعة بالطريق', 'Goods in transit'],
  ['1202', 'العملاء وأوراق القبض', 'Receivables'],
  ['120201', 'العملاء', 'Trade receivables', 'receivableAccountId'],
  ['120202', 'أوراق القبض', 'Notes receivable', 'notesReceivableAccountId'],
  ['120203', 'شيكات تحت التحصيل', 'Cheques under collection', 'chequesUnderCollectionAccountId'],
  ['120204', 'سلف وقروض العاملين', 'Employee advances and loans', 'employeeAdvancesAccountId'],
  ['120205', 'مدينون متنوعون', 'Sundry debtors'],
  ['120206', 'مخصص الديون المشكوك في تحصيلها', 'Allowance for doubtful debts'],
  ['120207', 'كوبونات وقود تحت التحصيل', 'Fuel coupons receivable', 'fuelCouponAccountId'],
  ['1203', 'أرصدة مدينة أخرى', 'Other debit balances'],
  ['120301', 'ضريبة القيمة المضافة على المشتريات', 'Input VAT', 'inputTaxAccountId'],
  ['120302', 'ضريبة الخصم والإضافة - مدينة', 'Withholding tax receivable', 'withholdingTaxReceivableAccountId'],
  ['120303', 'مصروفات مدفوعة مقدماً', 'Prepaid expenses'],
  ['120304', 'دفعات مقدمة للموردين', 'Advances to suppliers'],
  ['120305', 'تأمينات لدى الغير', 'Deposits with others'],
  ['1204', 'النقدية وما في حكمها', 'Cash and cash equivalents'],
  ['120401', 'الخزينة الرئيسية', 'Main cash box', 'cashAccountId'],
  ['120402', 'العهد النقدية', 'Petty cash'],
  ['120403', 'البنك - الحساب الجاري', 'Bank - current account', 'bankAccountId'],
  ['120404', 'ودائع بنكية قصيرة الأجل', 'Short-term bank deposits'],

  ['2', 'الالتزامات', 'Liabilities'],
  ['21', 'الالتزامات غير المتداولة', 'Non-current liabilities'],
  ['2101', 'القروض طويلة الأجل', 'Long-term loans'],
  ['210101', 'قروض بنكية طويلة الأجل', 'Long-term bank loans'],
  ['22', 'الالتزامات المتداولة', 'Current liabilities'],
  ['2201', 'الموردون وأوراق الدفع', 'Payables'],
  ['220101', 'الموردون', 'Trade payables', 'payableAccountId'],
  ['220102', 'أوراق الدفع', 'Notes payable', 'notesPayableAccountId'],
  ['220103', 'دائنون متنوعون', 'Sundry creditors'],
  ['220104', 'دفعات مقدمة من العملاء', 'Customer advances'],
  ['2202', 'الضرائب المستحقة', 'Taxes payable'],
  ['220201', 'ضريبة القيمة المضافة على المبيعات', 'Output VAT', 'outputTaxAccountId'],
  ['220202', 'ضريبة الخصم والإضافة - دائنة', 'Withholding tax payable', 'withholdingTaxPayableAccountId'],
  ['220203', 'ضريبة كسب العمل', 'Salary (payroll) tax payable', 'payrollTaxPayableAccountId'],
  ['220204', 'ضريبة الدخل المستحقة', 'Income tax payable'],
  ['220205', 'مصلحة الضرائب - تسوية ضريبة القيمة المضافة', 'VAT settlement account'],
  ['2203', 'مستحقات العاملين', 'Employee liabilities'],
  ['220301', 'رواتب وأجور مستحقة', 'Salaries payable', 'salariesPayableAccountId'],
  ['220302', 'الهيئة القومية للتأمين الاجتماعي', 'Social insurance payable', 'socialInsurancePayableAccountId'],
  ['220303', 'عمولات مستحقة', 'Commissions payable', 'commissionPayableAccountId'],
  ['2204', 'مصروفات مستحقة وأرصدة دائنة أخرى', 'Accruals and other credit balances'],
  ['220401', 'مصروفات مستحقة', 'Accrued expenses'],
  ['220402', 'إيرادات مقدمة', 'Deferred revenue'],
  ['220403', 'قروض وتسهيلات بنكية قصيرة الأجل', 'Short-term bank facilities'],

  ['3', 'حقوق الملكية', 'Equity'],
  ['31', 'رأس المال', 'Capital'],
  ['3101', 'رأس المال', 'Capital'],
  ['310101', 'رأس المال المدفوع', 'Paid-up capital'],
  ['32', 'الاحتياطيات', 'Reserves'],
  ['3201', 'الاحتياطيات', 'Reserves'],
  ['320101', 'الاحتياطي القانوني', 'Legal reserve'],
  ['320102', 'الاحتياطي العام', 'General reserve'],
  ['33', 'الأرباح المرحلة', 'Retained earnings'],
  ['3301', 'الأرباح والخسائر المرحلة', 'Retained earnings'],
  ['330101', 'أرباح (خسائر) مرحلة', 'Retained earnings (accumulated losses)', 'retainedEarningsAccountId'],
  ['330102', 'جاري الشركاء / المالك', "Partners' / owner's current account"],

  ['4', 'الإيرادات', 'Revenue'],
  ['41', 'إيرادات النشاط', 'Operating revenue'],
  ['4101', 'المبيعات', 'Sales'],
  ['410101', 'المبيعات', 'Sales of goods', 'salesAccountId'],
  ['410102', 'إيرادات الخدمات', 'Service revenue'],
  ['410103', 'مردودات المبيعات', 'Sales returns', 'salesReturnAccountId'],
  ['410104', 'خصم مسموح به', 'Sales discounts allowed', 'salesDiscountAccountId'],
  ['42', 'إيرادات أخرى', 'Other income'],
  ['4201', 'إيرادات أخرى', 'Other income'],
  ['420101', 'فوائد البيع بالتقسيط', 'Instalment sales interest', 'installmentInterestAccountId'],
  ['420102', 'أرباح فروق العملة', 'Foreign exchange gains', 'fxGainAccountId'],
  ['420103', 'أرباح وخسائر بيع الأصول الثابتة', 'Gain / loss on disposal of fixed assets', 'assetDisposalAccountId'],
  ['420104', 'إيرادات متنوعة', 'Miscellaneous income'],

  ['5', 'المصروفات', 'Expenses'],
  ['51', 'تكلفة المبيعات', 'Cost of sales'],
  ['5101', 'تكلفة المبيعات', 'Cost of sales'],
  ['510101', 'تكلفة البضاعة المباعة', 'Cost of goods sold', 'cogsAccountId'],
  ['510102', 'المشتريات والخدمات المشتراة', 'Purchases and purchased services', 'purchaseAccountId'],
  ['510103', 'مردودات المشتريات', 'Purchase returns', 'purchaseReturnAccountId'],
  ['510104', 'فروق جرد وتسويات المخزون', 'Inventory differences and adjustments', 'stockAdjustmentAccountId'],
  ['510105', 'تكاليف صناعية غير مباشرة محملة', 'Manufacturing overhead absorbed', 'manufacturingOverheadAccountId'],
  ['52', 'المصروفات الإدارية والعمومية', 'General and administrative expenses'],
  ['5201', 'مصروفات العاملين', 'Staff costs'],
  ['520101', 'الرواتب والأجور', 'Salaries and wages', 'salariesExpenseAccountId'],
  ['520102', 'حصة المنشأة في التأمينات الاجتماعية', 'Employer social insurance', 'socialInsuranceExpenseAccountId'],
  ['520103', 'مكافآت وحوافز', 'Bonuses and incentives'],
  ['5202', 'المصروفات الإدارية', 'Administrative expenses'],
  ['520201', 'الإيجارات', 'Rent'],
  ['520202', 'الكهرباء والمياه', 'Electricity and water'],
  ['520203', 'الاتصالات والإنترنت', 'Telephone and internet'],
  ['520204', 'أدوات كتابية ومطبوعات', 'Stationery and printing'],
  ['520205', 'الصيانة والإصلاحات', 'Repairs and maintenance'],
  ['520206', 'أتعاب مهنية واستشارات', 'Professional fees'],
  ['520207', 'رسوم حكومية وتراخيص', 'Government fees and licences'],
  ['520208', 'إهلاك الأصول الثابتة', 'Depreciation expense', 'depreciationExpenseAccountId'],
  ['53', 'مصروفات البيع والتوزيع', 'Selling and distribution expenses'],
  ['5301', 'مصروفات البيع والتوزيع', 'Selling and distribution expenses'],
  ['530101', 'عمولات البيع', 'Sales commissions', 'commissionExpenseAccountId'],
  ['530102', 'الدعاية والإعلان', 'Advertising'],
  ['530103', 'مصروفات النقل والشحن', 'Freight and delivery'],
  ['54', 'المصروفات التمويلية والأخرى', 'Finance and other expenses'],
  ['5401', 'المصروفات التمويلية', 'Finance costs'],
  ['540101', 'مصروفات وعمولات بنكية', 'Bank charges', 'bankChargesAccountId'],
  ['540102', 'خسائر فروق العملة', 'Foreign exchange losses', 'fxLossAccountId'],
  ['540103', 'فوائد القروض', 'Loan interest'],
  ['5402', 'مصروفات أخرى', 'Other expenses'],
  ['540201', 'ديون معدومة', 'Bad debts'],
  ['540202', 'مصروفات متنوعة', 'Miscellaneous expenses'],
  ['540203', 'ضريبة الدخل', 'Income tax expense'],
  ['540204', 'عجز وزيادة النقدية', 'Cash over and short', 'cashOverShortAccountId'],
];

const SA_ROWS: ChartTemplateRow[] = [
  ['1', 'الأصول', 'Assets'],
  ['11', 'الأصول غير المتداولة', 'Non-current assets'],
  ['1101', 'الممتلكات والآلات والمعدات', 'Property, plant and equipment'],
  ['110101', 'الأراضي', 'Land'],
  ['110102', 'المباني', 'Buildings'],
  ['110103', 'الآلات والمعدات', 'Machinery and equipment'],
  ['110104', 'السيارات', 'Vehicles'],
  ['110105', 'الأثاث والتجهيزات', 'Furniture and fixtures'],
  ['110106', 'أجهزة الحاسب الآلي', 'Computer equipment'],
  ['1102', 'الاستهلاك المتراكم', 'Accumulated depreciation'],
  ['110201', 'الاستهلاك المتراكم للممتلكات والآلات والمعدات', 'Accumulated depreciation of PP&E', 'accumulatedDepreciationAccountId'],
  ['1103', 'الأصول غير الملموسة', 'Intangible assets'],
  ['110301', 'البرامج والتراخيص', 'Software and licences'],
  ['12', 'الأصول المتداولة', 'Current assets'],
  ['1201', 'النقد وما في حكمه', 'Cash and cash equivalents'],
  ['120101', 'الصندوق', 'Cash on hand', 'cashAccountId'],
  ['120102', 'العهد النقدية', 'Petty cash'],
  ['120103', 'البنك - الحساب الجاري', 'Bank - current account', 'bankAccountId'],
  ['120104', 'ودائع قصيرة الأجل', 'Short-term deposits'],
  ['1202', 'الذمم المدينة', 'Receivables'],
  ['120201', 'العملاء', 'Trade receivables', 'receivableAccountId'],
  ['120202', 'أوراق القبض', 'Notes receivable', 'notesReceivableAccountId'],
  ['120203', 'شيكات تحت التحصيل', 'Cheques under collection', 'chequesUnderCollectionAccountId'],
  ['120204', 'سلف الموظفين', 'Employee advances', 'employeeAdvancesAccountId'],
  ['120205', 'مخصص الخسائر الائتمانية المتوقعة', 'Allowance for expected credit losses'],
  ['120206', 'كوبونات وقود تحت التحصيل', 'Fuel coupons receivable', 'fuelCouponAccountId'],
  ['1203', 'المخزون', 'Inventories'],
  ['120301', 'مخزون البضاعة', 'Merchandise inventory', 'inventoryAccountId'],
  ['120302', 'مخزون المواد الخام', 'Raw materials'],
  ['120303', 'بضاعة في الطريق', 'Goods in transit'],
  ['1204', 'المدفوعات المقدمة والأرصدة المدينة الأخرى', 'Prepayments and other receivables'],
  ['120401', 'ضريبة القيمة المضافة - المدخلات', 'VAT input', 'inputTaxAccountId'],
  ['120402', 'ضريبة الاستقطاع المدينة', 'Withholding tax receivable', 'withholdingTaxReceivableAccountId'],
  ['120403', 'مصروفات مدفوعة مقدماً', 'Prepaid expenses'],
  ['120404', 'دفعات مقدمة للموردين', 'Advances to suppliers'],
  ['120405', 'تأمينات مستردة', 'Refundable deposits'],

  ['2', 'المطلوبات', 'Liabilities'],
  ['21', 'المطلوبات غير المتداولة', 'Non-current liabilities'],
  ['2101', 'القروض طويلة الأجل', 'Long-term borrowings'],
  ['210101', 'قروض بنكية طويلة الأجل', 'Long-term bank loans'],
  ['2102', 'مخصص مكافأة نهاية الخدمة', 'End-of-service benefits'],
  ['210201', 'مخصص مكافأة نهاية الخدمة', 'Provision for end-of-service benefits'],
  ['22', 'المطلوبات المتداولة', 'Current liabilities'],
  ['2201', 'الذمم الدائنة', 'Payables'],
  ['220101', 'الموردون', 'Trade payables', 'payableAccountId'],
  ['220102', 'أوراق الدفع', 'Notes payable', 'notesPayableAccountId'],
  ['220103', 'دفعات مقدمة من العملاء', 'Customer advances'],
  ['2202', 'الضرائب والزكاة', 'Taxes and zakat'],
  ['220201', 'ضريبة القيمة المضافة - المخرجات', 'VAT output', 'outputTaxAccountId'],
  ['220202', 'ضريبة القيمة المضافة - التسوية', 'VAT settlement account'],
  ['220203', 'ضريبة الاستقطاع المستحقة', 'Withholding tax payable', 'withholdingTaxPayableAccountId'],
  ['220204', 'مخصص الزكاة', 'Zakat provision'],
  ['2203', 'مستحقات الموظفين', 'Employee liabilities'],
  ['220301', 'الرواتب المستحقة', 'Salaries payable', 'salariesPayableAccountId'],
  ['220302', 'المؤسسة العامة للتأمينات الاجتماعية', 'GOSI payable', 'socialInsurancePayableAccountId'],
  ['220303', 'استقطاعات رواتب أخرى مستحقة', 'Other payroll deductions payable', 'payrollTaxPayableAccountId'],
  ['220304', 'العمولات المستحقة', 'Commissions payable', 'commissionPayableAccountId'],
  ['2204', 'المصروفات المستحقة والأرصدة الدائنة الأخرى', 'Accruals and other payables'],
  ['220401', 'مصروفات مستحقة', 'Accrued expenses'],
  ['220402', 'إيرادات مؤجلة', 'Deferred revenue'],
  ['220403', 'قروض قصيرة الأجل', 'Short-term borrowings'],

  ['3', 'حقوق الملكية', 'Equity'],
  ['31', 'رأس المال', 'Share capital'],
  ['3101', 'رأس المال', 'Share capital'],
  ['310101', 'رأس المال', 'Paid-up capital'],
  ['32', 'الاحتياطيات', 'Reserves'],
  ['3201', 'الاحتياطي النظامي', 'Statutory reserve'],
  ['320101', 'الاحتياطي النظامي', 'Statutory reserve'],
  ['33', 'الأرباح المبقاة', 'Retained earnings'],
  ['3301', 'الأرباح المبقاة', 'Retained earnings'],
  ['330101', 'الأرباح المبقاة (الخسائر المتراكمة)', 'Retained earnings (accumulated losses)', 'retainedEarningsAccountId'],
  ['330102', 'جاري الشركاء', "Partners' current accounts"],

  ['4', 'الإيرادات', 'Revenue'],
  ['41', 'إيرادات النشاط الرئيسي', 'Operating revenue'],
  ['4101', 'المبيعات', 'Sales'],
  ['410101', 'مبيعات البضاعة', 'Sales of goods', 'salesAccountId'],
  ['410102', 'إيرادات الخدمات', 'Service revenue'],
  ['410103', 'مردودات المبيعات', 'Sales returns', 'salesReturnAccountId'],
  ['410104', 'الخصم المسموح به', 'Sales discounts allowed', 'salesDiscountAccountId'],
  ['42', 'الإيرادات الأخرى', 'Other income'],
  ['4201', 'الإيرادات الأخرى', 'Other income'],
  ['420101', 'إيرادات البيع بالتقسيط', 'Instalment sales income', 'installmentInterestAccountId'],
  ['420102', 'أرباح فروق العملة', 'Foreign exchange gains', 'fxGainAccountId'],
  ['420103', 'أرباح وخسائر استبعاد الأصول', 'Gain / loss on disposal of assets', 'assetDisposalAccountId'],
  ['420104', 'إيرادات متنوعة', 'Miscellaneous income'],

  ['5', 'تكلفة الإيرادات', 'Cost of revenue'],
  ['51', 'تكلفة المبيعات', 'Cost of sales'],
  ['5101', 'تكلفة المبيعات', 'Cost of sales'],
  ['510101', 'تكلفة البضاعة المباعة', 'Cost of goods sold', 'cogsAccountId'],
  ['510102', 'المشتريات والخدمات المشتراة', 'Purchases and purchased services', 'purchaseAccountId'],
  ['510103', 'مردودات المشتريات', 'Purchase returns', 'purchaseReturnAccountId'],
  ['510104', 'فروقات الجرد وتسويات المخزون', 'Inventory differences and adjustments', 'stockAdjustmentAccountId'],
  ['510105', 'التكاليف الصناعية غير المباشرة المحملة', 'Manufacturing overhead absorbed', 'manufacturingOverheadAccountId'],

  ['6', 'المصروفات التشغيلية', 'Operating expenses'],
  ['61', 'مصروفات البيع والتسويق', 'Selling and marketing expenses'],
  ['6101', 'مصروفات البيع والتسويق', 'Selling and marketing expenses'],
  ['610101', 'عمولات المبيعات', 'Sales commissions', 'commissionExpenseAccountId'],
  ['610102', 'الدعاية والإعلان', 'Advertising'],
  ['610103', 'مصروفات الشحن والتوصيل', 'Freight and delivery'],
  ['62', 'المصروفات العمومية والإدارية', 'General and administrative expenses'],
  ['6201', 'تكاليف الموظفين', 'Employee costs'],
  ['620101', 'الرواتب والأجور', 'Salaries and wages', 'salariesExpenseAccountId'],
  ['620102', 'حصة المنشأة في التأمينات الاجتماعية', 'Employer GOSI contribution', 'socialInsuranceExpenseAccountId'],
  ['620103', 'مصروف مكافأة نهاية الخدمة', 'End-of-service benefits expense'],
  ['620104', 'رسوم الإقامات والتأشيرات ورخص العمل', 'Iqama, visa and work permit fees'],
  ['6202', 'المصروفات الإدارية', 'Administrative expenses'],
  ['620201', 'الإيجارات', 'Rent'],
  ['620202', 'الكهرباء والمياه', 'Electricity and water'],
  ['620203', 'الاتصالات والإنترنت', 'Telephone and internet'],
  ['620204', 'القرطاسية والمطبوعات', 'Stationery and printing'],
  ['620205', 'الصيانة والإصلاحات', 'Repairs and maintenance'],
  ['620206', 'الأتعاب المهنية', 'Professional fees'],
  ['620207', 'الرسوم الحكومية والاشتراكات', 'Government fees and subscriptions'],
  ['620208', 'مصروف الاستهلاك', 'Depreciation expense', 'depreciationExpenseAccountId'],
  ['63', 'المصروفات التمويلية والأخرى', 'Finance and other expenses'],
  ['6301', 'المصروفات التمويلية', 'Finance costs'],
  ['630101', 'الرسوم والعمولات البنكية', 'Bank charges', 'bankChargesAccountId'],
  ['630102', 'خسائر فروق العملة', 'Foreign exchange losses', 'fxLossAccountId'],
  ['630103', 'تكاليف التمويل', 'Finance charges'],
  ['6302', 'مصروفات أخرى', 'Other expenses'],
  ['630201', 'الديون المعدومة', 'Bad debts'],
  ['630202', 'مصروفات متنوعة', 'Miscellaneous expenses'],
  ['630203', 'عجز وزيادة النقدية', 'Cash over and short', 'cashOverShortAccountId'],
  ['64', 'الزكاة وضريبة الدخل', 'Zakat and income tax'],
  ['6401', 'الزكاة وضريبة الدخل', 'Zakat and income tax'],
  ['640101', 'مصروف الزكاة', 'Zakat expense'],
  ['640102', 'مصروف ضريبة الدخل', 'Income tax expense'],
];

export const CHART_TEMPLATES: Record<ChartTemplateCode, ChartTemplate> = {
  eg: {
    code: 'eg',
    nameAr: 'دليل حسابات المنشآت الصغيرة والمتوسطة - مصر',
    nameEn: 'Egyptian SME chart of accounts',
    country: 'EG',
    baseCurrency: 'EGP',
    classTypes: STANDARD_CLASSES,
    rows: EG_ROWS,
  },
  sa: {
    code: 'sa',
    nameAr: 'دليل حسابات المنشآت الصغيرة والمتوسطة - السعودية (SOCPA)',
    nameEn: 'Saudi SME chart of accounts (SOCPA style)',
    country: 'SA',
    baseCurrency: 'SAR',
    classTypes: STANDARD_CLASSES,
    rows: SA_ROWS,
  },
};

/** Parent code: 6 → 4 → 2 → 1 digits. */
export function parentCode(code: string): string | null {
  if (code.length <= 1) return null;
  if (code.length === 2) return code.slice(0, 1);
  return code.slice(0, code.length - 2);
}

export interface ExpandedTemplateAccount {
  code: string;
  nameAr: string;
  nameEn: string;
  type: AccountType;
  parentCode: string | null;
  level: number;
  allowPosting: boolean;
  settingsKey?: SettingsAccountKey;
}

/** Resolves type, parent, level and postability of every template row. */
export function expandTemplate(template: ChartTemplate): ExpandedTemplateAccount[] {
  const codes = new Set(template.rows.map((r) => r[0]));
  const parents = new Set<string>();
  for (const [code] of template.rows) {
    const parent = parentCode(code);
    if (parent) {
      if (!codes.has(parent)) {
        throw new Error(`Template ${template.code}: parent ${parent} of ${code} is missing`);
      }
      parents.add(parent);
    }
  }
  return template.rows.map(([code, nameAr, nameEn, settingsKey]) => {
    const type = template.classTypes[code[0]];
    if (!type) throw new Error(`Template ${template.code}: unknown class for ${code}`);
    const level = code.length === 1 ? 0 : code.length === 2 ? 1 : code.length / 2;
    return {
      code,
      nameAr,
      nameEn,
      type,
      parentCode: parentCode(code),
      level,
      allowPosting: !parents.has(code),
      settingsKey,
    };
  });
}

/** Common currencies created with the chart (codes are global). */
export const COMMON_CURRENCIES: { code: string; nameAr: string; nameEn: string; symbol: string }[] = [
  { code: 'EGP', nameAr: 'جنيه مصري', nameEn: 'Egyptian Pound', symbol: 'ج.م' },
  { code: 'SAR', nameAr: 'ريال سعودي', nameEn: 'Saudi Riyal', symbol: 'ر.س' },
  { code: 'USD', nameAr: 'دولار أمريكي', nameEn: 'US Dollar', symbol: '$' },
  { code: 'EUR', nameAr: 'يورو', nameEn: 'Euro', symbol: '€' },
  { code: 'AED', nameAr: 'درهم إماراتي', nameEn: 'UAE Dirham', symbol: 'د.إ' },
];
