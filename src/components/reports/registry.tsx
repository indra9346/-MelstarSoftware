/** Report id → icon + view component. Metadata lives in services/reports.ts. */
import type { ComponentType } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  AlarmClock, Banknote, BookOpenText, Building2, Cake, CalendarCheck2, CalendarClock, ClipboardCheck, Factory, Gauge, Hammer, Landmark, Boxes,
  PieChart, Plane, ReceiptText, ShoppingCart, TrendingUp, Users, Wallet, Wrench, Activity,
} from 'lucide-react'
import type { ReportGroupId, ReportId } from '@/services/reports'
import type { ReportProps } from './ReportKit'
import { AttendanceSummaryView, CelebrationsView, HeadcountReportView, LateOvertimeView, LeaveUtilisationView } from './PeopleReports'
import { DeptCostView, PayrollTrendView, SalaryRegisterView, StatutoryView } from './PayrollReports'
import { PettyStatementView, SpendByCategoryView } from './FinanceReports'
import { CalibrationView, DowntimeView, InventoryView, PmComplianceView, PurchaseVendorView, QualityView, ToolCribView, WorkOrdersView } from './OperationsReports'

export const GROUP_ICONS: Record<ReportGroupId, LucideIcon> = { people: Users, payroll: Banknote, finance: Wallet, operations: Factory }

export const REPORT_VIEWS: Record<ReportId, { icon: LucideIcon; View: ComponentType<ReportProps> }> = {
  headcount: { icon: Users, View: HeadcountReportView },
  attendance: { icon: CalendarCheck2, View: AttendanceSummaryView },
  'late-ot': { icon: AlarmClock, View: LateOvertimeView },
  leave: { icon: Plane, View: LeaveUtilisationView },
  celebrations: { icon: Cake, View: CelebrationsView },
  'salary-register': { icon: ReceiptText, View: SalaryRegisterView },
  statutory: { icon: Landmark, View: StatutoryView },
  'payroll-trend': { icon: TrendingUp, View: PayrollTrendView },
  'dept-cost': { icon: Building2, View: DeptCostView },
  'petty-statement': { icon: BookOpenText, View: PettyStatementView },
  'petty-category': { icon: PieChart, View: SpendByCategoryView },
  downtime: { icon: Activity, View: DowntimeView },
  'pm-compliance': { icon: CalendarClock, View: PmComplianceView },
  inventory: { icon: Boxes, View: InventoryView },
  'tool-crib': { icon: Hammer, View: ToolCribView },
  calibration: { icon: Gauge, View: CalibrationView },
  'purchase-vendor': { icon: ShoppingCart, View: PurchaseVendorView },
  'work-orders': { icon: Wrench, View: WorkOrdersView },
  quality: { icon: ClipboardCheck, View: QualityView },
}
