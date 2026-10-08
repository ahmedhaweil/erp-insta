import { Users, Factory, Handshake } from 'lucide-react';
import type { NavGroup } from './types';

/**
 * Navigation contributed by the people area (HR & payroll, manufacturing and
 * CRM). Items added to a group key that already exists are appended to it.
 */
export const peopleNav: NavGroup[] = [
  {
    key: 'crm',
    icon: Handshake,
    order: 45,
    items: [
      { key: 'crmPipeline', href: '/crm/pipeline' },
      { key: 'crmLeads', href: '/crm/leads' },
      { key: 'crmActivities', href: '/crm/activities' },
      { key: 'crmStages', href: '/crm/stages' },
      { key: 'crmPipelineReport', href: '/crm/reports/pipeline' },
    ],
  },
  {
    key: 'manufacturing',
    icon: Factory,
    order: 55,
    items: [
      { key: 'mfgBoms', href: '/manufacturing/boms' },
      { key: 'mfgProductionOrders', href: '/manufacturing/production-orders' },
      { key: 'mfgScraps', href: '/manufacturing/scraps' },
      { key: 'mfgRequirements', href: '/manufacturing/reports/requirements' },
      { key: 'mfgProductionCosts', href: '/manufacturing/reports/production-costs' },
    ],
  },
  {
    key: 'hr',
    icon: Users,
    order: 75,
    items: [
      { key: 'hrEmployees', href: '/hr/employees' },
      { key: 'hrAttendance', href: '/hr/attendance' },
      { key: 'hrLeaveRequests', href: '/hr/leave-requests' },
      { key: 'hrLeaveBalances', href: '/hr/leave-balances' },
      { key: 'hrLeaveEncashments', href: '/hr/leave-encashments' },
      { key: 'hrOvertime', href: '/hr/overtime' },
      { key: 'hrLoans', href: '/hr/loans' },
      { key: 'hrPayrollAdjustments', href: '/hr/payroll-adjustments' },
      { key: 'hrPayrollRuns', href: '/hr/payroll-runs' },
      { key: 'hrSocialInsurance', href: '/hr/reports/social-insurance' },
      { key: 'hrGratuity', href: '/hr/gratuity' },
      { key: 'hrEosProvisions', href: '/hr/eos-provisions' },
      { key: 'hrFinalSettlements', href: '/hr/final-settlements' },
      { key: 'hrDepartments', href: '/hr/departments' },
      { key: 'hrJobTitles', href: '/hr/job-titles' },
      { key: 'hrWorkSchedules', href: '/hr/work-schedules' },
      { key: 'hrHolidays', href: '/hr/holidays' },
      { key: 'hrLeaveTypes', href: '/hr/leave-types' },
      { key: 'hrSettings', href: '/hr/payroll-settings' },
    ],
  },
];
