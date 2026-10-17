/**
 * Demo master data for Melstar's KIADB Doddaballapura plant.
 * Company, directors, address and work centres are real (public registry / website);
 * employees, customers, vendors and transactions are plausible DEMO data.
 */
import type { Gender, Permission, TaxRegime, EmploymentType } from '../types'

export const ALL_PERMISSIONS: Permission[] = [
  'dashboard.view', 'employees.view', 'employees.manage', 'attendance.view', 'attendance.manage', 'leaves.view', 'leaves.manage',
  'payroll.view', 'payroll.manage', 'petty_cash.view', 'petty_cash.manage', 'tasks.view', 'tasks.manage', 'announcements.manage',
  'machines.view', 'machines.manage', 'inventory.view', 'inventory.manage', 'purchase.view', 'purchase.manage', 'sales.view',
  'sales.manage', 'quality.view', 'quality.manage', 'reports.view', 'users.manage', 'audit.view', 'settings.manage',
]

export const ROLES: { key: string; name: string; description: string; permissions: Permission[]; is_admin_portal: boolean }[] = [
  { key: 'super_admin', name: 'Super Admin', description: 'Directors and system owner — full access to every module and setting.', permissions: ALL_PERMISSIONS, is_admin_portal: true },
  {
    key: 'hr_manager', name: 'HR Manager', description: 'People, attendance, leave and announcements. Can view payroll.',
    permissions: ['dashboard.view', 'employees.view', 'employees.manage', 'attendance.view', 'attendance.manage', 'leaves.view', 'leaves.manage', 'payroll.view', 'tasks.view', 'tasks.manage', 'announcements.manage', 'reports.view', 'audit.view'],
    is_admin_portal: true,
  },
  {
    key: 'accounts', name: 'Accounts', description: 'Payroll runs, petty cash, purchase orders and finance reports.',
    permissions: ['dashboard.view', 'employees.view', 'attendance.view', 'payroll.view', 'payroll.manage', 'petty_cash.view', 'petty_cash.manage', 'purchase.view', 'purchase.manage', 'sales.view', 'reports.view', 'tasks.view'],
    is_admin_portal: true,
  },
  {
    key: 'supervisor', name: 'Production Supervisor', description: 'Shop-floor: tasks, machines, maintenance, inventory, quality and team attendance.',
    permissions: ['dashboard.view', 'employees.view', 'attendance.view', 'leaves.view', 'tasks.view', 'tasks.manage', 'machines.view', 'machines.manage', 'inventory.view', 'inventory.manage', 'quality.view', 'quality.manage', 'sales.view', 'purchase.view'],
    is_admin_portal: true,
  },
  { key: 'employee', name: 'Employee', description: 'Self-service only: own attendance, leave, payslips, tasks, claims and profile.', permissions: [], is_admin_portal: false },
]

export const DEPARTMENTS = [
  { code: 'MGT', name: 'Management', color: '#6366f1', description: 'Plant leadership and directors’ office.' },
  { code: 'ENG', name: 'Design & Engineering', color: '#8b5cf6', description: 'Customised industrial design, DFM reviews, CAD/CAM and drawings.' },
  { code: 'PPC', name: 'Sales & Planning', color: '#0ea5e9', description: 'Customer enquiries, order booking and production planning & control.' },
  { code: 'MCH', name: 'Production – Machining', color: '#06b6d4', description: 'CNC turning and VMC milling cells.' },
  { code: 'FAB', name: 'Production – Fabrication', color: '#f59e0b', description: 'Press & bending, cutting and the welding bay.' },
  { code: 'ASM', name: 'Assembly', color: '#10b981', description: 'Sub-assembly line, testing and packing.' },
  { code: 'QA', name: 'Quality Assurance', color: '#ec4899', description: 'Incoming, in-process and final inspection; gauges and calibration.' },
  { code: 'MNT', name: 'Maintenance', color: '#f97316', description: 'Preventive and breakdown maintenance, utilities and electricals.' },
  { code: 'SCM', name: 'Stores & Purchase', color: '#14b8a6', description: 'Purchasing, stores, tool crib and dispatch.' },
  { code: 'HRA', name: 'HR & Administration', color: '#a855f7', description: 'People, payroll inputs, compliance, housekeeping and security.' },
  { code: 'ACC', name: 'Accounts & Finance', color: '#3b82f6', description: 'Books, payments, statutory remittances and MIS.' },
] as const

/** [title, dept code, grade] */
export const DESIGNATIONS: [string, string, string][] = [
  ['Plant Head & General Manager', 'MGT', 'M4'],
  ['Manager – Design & Engineering', 'ENG', 'M2'],
  ['Design Engineer', 'ENG', 'E2'],
  ['PPC Engineer', 'PPC', 'E1'],
  ['Sales Coordinator', 'PPC', 'E1'],
  ['Production Supervisor', 'MCH', 'S2'],
  ['CNC Programmer & Setter', 'MCH', 'S1'],
  ['CNC Operator', 'MCH', 'W2'],
  ['VMC Operator', 'MCH', 'W2'],
  ['Trainee Operator', 'MCH', 'T1'],
  ['Fabrication Supervisor', 'FAB', 'S2'],
  ['Welder', 'FAB', 'W2'],
  ['Press Brake Operator', 'FAB', 'W2'],
  ['Fitter', 'FAB', 'W1'],
  ['Assembly Lead', 'ASM', 'S1'],
  ['Assembly Technician', 'ASM', 'W1'],
  ['Apprentice', 'ASM', 'T1'],
  ['QA Lead', 'QA', 'E2'],
  ['Quality Inspector', 'QA', 'W2'],
  ['CMM Operator', 'QA', 'W2'],
  ['Maintenance Engineer', 'MNT', 'E1'],
  ['Electrician', 'MNT', 'W2'],
  ['Maintenance Technician', 'MNT', 'W1'],
  ['Purchase & Stores Executive', 'SCM', 'E1'],
  ['Storekeeper', 'SCM', 'W1'],
  ['HR & Admin Executive', 'HRA', 'E1'],
  ['Office Assistant', 'HRA', 'W1'],
  ['Accounts Manager', 'ACC', 'M1'],
  ['Accounts Executive', 'ACC', 'E1'],
]

export const WORK_CENTRES = [
  { code: 'CNC', name: 'CNC Turning Cell', color: '#06b6d4', description: 'CNC turning centres for shafts, pins, flanges and turned components.' },
  { code: 'VMC', name: 'VMC Milling Cell', color: '#6366f1', description: 'Vertical machining centres for housings, blocks, brackets and plates.' },
  { code: 'PRB', name: 'Press & Bending', color: '#ec4899', description: 'Shearing, press brake bending and power-press operations.' },
  { code: 'WLD', name: 'Welding Bay', color: '#f59e0b', description: 'MIG / TIG welding, plasma cutting and fabricated frames.' },
  { code: 'SAL', name: 'Sub-assembly Line', color: '#10b981', description: 'Fitting, pressing, torqueing and leak testing of sub-assemblies.' },
  { code: 'QAI', name: 'QA Inspection', color: '#8b5cf6', description: 'CMM, surface finish and gauge inspection; first-article reports.' },
] as const

export interface RosterEntry {
  code: string
  first: string
  last: string
  gender: Gender
  dob: string
  dept: string
  desig: string
  wc: string | null
  doj: string
  type: EmploymentType
  gross: number // fixed monthly gross ₹
  shift: 'GEN' | 'EARLY'
  reports: string | null // emp code
  blood: string
  married: boolean
  skills: string[]
  regime?: TaxRegime
  declared?: number
  exit?: { date: string; reason: string }
  notice?: boolean
  city?: string
}

export const DEMO_EMPLOYEE_CODE = 'MMS-1005'

export const ROSTER: RosterEntry[] = [
  { code: 'MMS-1001', first: 'Prakash', last: 'Hegde', gender: 'male', dob: '1976-07-11', dept: 'MGT', desig: 'Plant Head & General Manager', wc: null, doj: '2012-03-05', type: 'permanent', gross: 145000, shift: 'GEN', reports: null, blood: 'B+', married: true, skills: ['Plant operations', 'Lean manufacturing', 'Customer management'], city: 'Bengaluru' },
  { code: 'MMS-1002', first: 'Arjun', last: 'Gowda', gender: 'male', dob: '1984-02-19', dept: 'ENG', desig: 'Manager – Design & Engineering', wc: null, doj: '2014-08-18', type: 'permanent', gross: 98000, shift: 'GEN', reports: 'MMS-1001', blood: 'O+', married: true, skills: ['SolidWorks', 'GD&T', 'DFM', 'Fixture design'] },
  { code: 'MMS-1003', first: 'Kavya', last: 'Shenoy', gender: 'female', dob: '1994-11-02', dept: 'ENG', desig: 'Design Engineer', wc: null, doj: '2019-07-01', type: 'permanent', gross: 56000, shift: 'GEN', reports: 'MMS-1002', blood: 'A+', married: false, skills: ['SolidWorks', 'AutoCAD', 'Mastercam', 'Sheet-metal design'] },
  { code: 'MMS-1004', first: 'Nikhil', last: 'Rao', gender: 'male', dob: '1993-05-27', dept: 'PPC', desig: 'PPC Engineer', wc: null, doj: '2018-01-08', type: 'permanent', gross: 48000, shift: 'GEN', reports: 'MMS-1001', blood: 'B+', married: true, skills: ['Production planning', 'MRP', 'Excel'] },
  { code: 'MMS-1005', first: 'Ravi', last: 'Kumar M', gender: 'male', dob: '1989-03-22', dept: 'MCH', desig: 'Production Supervisor', wc: 'CNC', doj: '2016-06-13', type: 'permanent', gross: 36000, shift: 'GEN', reports: 'MMS-1001', blood: 'O+', married: true, skills: ['Fanuc 0i-TF', 'Siemens 828D', 'Setting & proving', 'SPC', '5S'] },
  { code: 'MMS-1006', first: 'Manjunath', last: 'B', gender: 'male', dob: '1991-09-14', dept: 'MCH', desig: 'CNC Programmer & Setter', wc: 'CNC', doj: '2015-02-02', type: 'permanent', gross: 30000, shift: 'GEN', reports: 'MMS-1005', blood: 'A-', married: true, skills: ['Fanuc programming', 'CAM', 'Tool selection'] },
  { code: 'MMS-1007', first: 'Santosh', last: 'Naik', gender: 'male', dob: '1995-12-03', dept: 'MCH', desig: 'CNC Operator', wc: 'CNC', doj: '2018-10-15', type: 'permanent', gross: 22500, shift: 'GEN', reports: 'MMS-1005', blood: 'B+', married: true, skills: ['CNC turning', 'Vernier & micrometer'] },
  { code: 'MMS-1008', first: 'Shivakumar', last: 'K', gender: 'male', dob: '2002-04-09', dept: 'MCH', desig: 'Trainee Operator', wc: 'CNC', doj: '2026-06-01', type: 'trainee', gross: 15000, shift: 'GEN', reports: 'MMS-1005', blood: 'O+', married: false, skills: ['ITI Machinist'] },
  { code: 'MMS-1009', first: 'Yogesh', last: 'S', gender: 'male', dob: '1997-08-21', dept: 'MCH', desig: 'CNC Operator', wc: 'CNC', doj: '2021-03-01', type: 'contract', gross: 19500, shift: 'GEN', reports: 'MMS-1005', blood: 'AB+', married: false, skills: ['CNC turning'] },
  { code: 'MMS-1010', first: 'Lokesh', last: 'H', gender: 'male', dob: '1990-01-30', dept: 'MCH', desig: 'CNC Programmer & Setter', wc: 'VMC', doj: '2017-04-17', type: 'permanent', gross: 32000, shift: 'GEN', reports: 'MMS-1005', blood: 'B-', married: true, skills: ['VMC programming', 'Fanuc 0i-MF', '4th axis'] },
  { code: 'MMS-1011', first: 'Mahesh', last: 'Kumar R', gender: 'male', dob: '1994-06-18', dept: 'MCH', desig: 'VMC Operator', wc: 'VMC', doj: '2019-09-02', type: 'permanent', gross: 23500, shift: 'GEN', reports: 'MMS-1010', blood: 'O+', married: true, skills: ['VMC operation', 'Bore gauge'] },
  { code: 'MMS-1012', first: 'Girish', last: 'Patil', gender: 'male', dob: '1996-10-07', dept: 'MCH', desig: 'VMC Operator', wc: 'VMC', doj: '2022-01-10', type: 'permanent', gross: 21000, shift: 'GEN', reports: 'MMS-1010', blood: 'A+', married: false, skills: ['VMC operation'] },
  { code: 'MMS-1013', first: 'Ramesh', last: 'Babu', gender: 'male', dob: '1983-03-15', dept: 'FAB', desig: 'Fabrication Supervisor', wc: 'WLD', doj: '2013-05-06', type: 'permanent', gross: 38000, shift: 'GEN', reports: 'MMS-1001', blood: 'B+', married: true, skills: ['Fabrication drawings', 'Welding inspection', 'Jig making'] },
  { code: 'MMS-1014', first: 'Venkatesh', last: 'T', gender: 'male', dob: '1988-11-25', dept: 'FAB', desig: 'Welder', wc: 'WLD', doj: '2014-12-01', type: 'permanent', gross: 25000, shift: 'GEN', reports: 'MMS-1013', blood: 'O-', married: true, skills: ['MIG', 'TIG', 'Plasma cutting'] },
  { code: 'MMS-1015', first: 'Imran', last: 'Pasha', gender: 'male', dob: '1992-02-08', dept: 'FAB', desig: 'Welder', wc: 'WLD', doj: '2020-02-17', type: 'permanent', gross: 22000, shift: 'GEN', reports: 'MMS-1013', blood: 'A+', married: true, skills: ['MIG', 'Stick welding'] },
  { code: 'MMS-1016', first: 'Suresh', last: 'Gowda', gender: 'male', dob: '1990-07-04', dept: 'FAB', desig: 'Press Brake Operator', wc: 'PRB', doj: '2016-09-19', type: 'permanent', gross: 23000, shift: 'GEN', reports: 'MMS-1013', blood: 'B+', married: true, skills: ['Press brake', 'Shearing', 'Bend allowance'] },
  { code: 'MMS-1017', first: 'Anand', last: 'Kulkarni', gender: 'male', dob: '1987-12-12', dept: 'FAB', desig: 'Fitter', wc: 'PRB', doj: '2015-06-22', type: 'permanent', gross: 20500, shift: 'GEN', reports: 'MMS-1013', blood: 'O+', married: true, skills: ['Fitting', 'Drilling', 'Marking'] },
  { code: 'MMS-1018', first: 'Harish', last: 'N', gender: 'male', dob: '1988-05-29', dept: 'ASM', desig: 'Assembly Lead', wc: 'SAL', doj: '2015-01-12', type: 'permanent', gross: 29000, shift: 'GEN', reports: 'MMS-1001', blood: 'A+', married: true, skills: ['Hydraulic assembly', 'Torque control', 'Leak testing'] },
  { code: 'MMS-1019', first: 'Chandrashekar', last: 'M', gender: 'male', dob: '1993-08-16', dept: 'ASM', desig: 'Assembly Technician', wc: 'SAL', doj: '2018-07-23', type: 'permanent', gross: 20000, shift: 'GEN', reports: 'MMS-1018', blood: 'B+', married: true, skills: ['Sub-assembly', 'Pneumatic tools'] },
  { code: 'MMS-1020', first: 'Bhavya', last: 'R', gender: 'female', dob: '1998-01-20', dept: 'ASM', desig: 'Assembly Technician', wc: 'SAL', doj: '2021-11-08', type: 'permanent', gross: 18500, shift: 'GEN', reports: 'MMS-1018', blood: 'O+', married: false, skills: ['Sub-assembly', 'Packing & labelling'] },
  { code: 'MMS-1021', first: 'Naveen', last: 'Kumar J', gender: 'male', dob: '2004-09-03', dept: 'ASM', desig: 'Apprentice', wc: 'SAL', doj: '2026-01-05', type: 'apprentice', gross: 13500, shift: 'GEN', reports: 'MMS-1018', blood: 'A+', married: false, skills: ['NAPS apprentice – Fitter'] },
  { code: 'MMS-1022', first: 'Deepa', last: 'Nagaraj', gender: 'female', dob: '1990-04-13', dept: 'QA', desig: 'QA Lead', wc: 'QAI', doj: '2016-03-14', type: 'permanent', gross: 52000, shift: 'GEN', reports: 'MMS-1001', blood: 'B+', married: true, skills: ['PPAP', 'FAI', '8D', 'CMM programming', 'MSA'] },
  { code: 'MMS-1023', first: 'Sandeep', last: 'Joshi', gender: 'male', dob: '1992-10-30', dept: 'QA', desig: 'Quality Inspector', wc: 'QAI', doj: '2019-05-20', type: 'permanent', gross: 24000, shift: 'GEN', reports: 'MMS-1022', blood: 'O+', married: true, skills: ['Dimensional inspection', 'Gauges', 'Inspection reports'] },
  { code: 'MMS-1024', first: 'Pooja', last: 'Shetty', gender: 'female', dob: '1996-07-07', dept: 'QA', desig: 'CMM Operator', wc: 'QAI', doj: '2022-08-01', type: 'permanent', gross: 23000, shift: 'GEN', reports: 'MMS-1022', blood: 'A-', married: false, skills: ['CMM', 'Surface roughness', 'Profile projector'] },
  { code: 'MMS-1025', first: 'Raghavendra', last: 'Bhat', gender: 'male', dob: '1986-12-21', dept: 'MNT', desig: 'Maintenance Engineer', wc: null, doj: '2014-10-06', type: 'permanent', gross: 45000, shift: 'EARLY', reports: 'MMS-1001', blood: 'B+', married: true, skills: ['CNC maintenance', 'Hydraulics', 'PLC basics', 'TPM'] },
  { code: 'MMS-1026', first: 'Kiran', last: 'Kumar', gender: 'male', dob: '1991-03-03', dept: 'MNT', desig: 'Electrician', wc: null, doj: '2017-11-13', type: 'permanent', gross: 24500, shift: 'EARLY', reports: 'MMS-1025', blood: 'O+', married: true, skills: ['HT/LT panels', 'Drives', 'DG set'] },
  { code: 'MMS-1027', first: 'Prasanna', last: 'D', gender: 'male', dob: '1997-05-11', dept: 'MNT', desig: 'Maintenance Technician', wc: null, doj: '2023-02-06', type: 'permanent', gross: 19000, shift: 'EARLY', reports: 'MMS-1025', blood: 'AB-', married: false, skills: ['Mechanical maintenance', 'Lubrication'] },
  { code: 'MMS-1028', first: 'Srinivas', last: 'Murthy', gender: 'male', dob: '1985-09-09', dept: 'SCM', desig: 'Purchase & Stores Executive', wc: null, doj: '2013-07-15', type: 'permanent', gross: 42000, shift: 'GEN', reports: 'MMS-1001', blood: 'A+', married: true, skills: ['Vendor development', 'Purchase', 'Inventory control'] },
  { code: 'MMS-1029', first: 'Mohan', last: 'Raj', gender: 'male', dob: '1990-06-02', dept: 'SCM', desig: 'Storekeeper', wc: null, doj: '2018-04-02', type: 'permanent', gross: 19500, shift: 'GEN', reports: 'MMS-1028', blood: 'B+', married: true, skills: ['Stores', 'Tool crib', 'Dispatch'] },
  { code: 'MMS-1030', first: 'Lakshmi', last: 'Narayan', gender: 'female', dob: '1988-08-08', dept: 'HRA', desig: 'HR & Admin Executive', wc: null, doj: '2017-01-16', type: 'permanent', gross: 40000, shift: 'GEN', reports: 'MMS-1001', blood: 'O+', married: true, skills: ['HR operations', 'Statutory compliance', 'Payroll inputs'] },
  { code: 'MMS-1031', first: 'Ganesh', last: 'P', gender: 'male', dob: '1980-02-14', dept: 'HRA', desig: 'Office Assistant', wc: null, doj: '2012-06-04', type: 'permanent', gross: 15500, shift: 'GEN', reports: 'MMS-1030', blood: 'B+', married: true, skills: ['Office support', 'Courier & bank runs'] },
  { code: 'MMS-1032', first: 'Vinay', last: 'Kamath', gender: 'male', dob: '1982-10-19', dept: 'ACC', desig: 'Accounts Manager', wc: null, doj: '2013-02-11', type: 'permanent', gross: 115000, shift: 'GEN', reports: 'MMS-1001', blood: 'A+', married: true, skills: ['Tally Prime', 'GST', 'TDS', 'MIS'], regime: 'old', declared: 210000 },
  { code: 'MMS-1033', first: 'Shilpa', last: 'Rao', gender: 'female', dob: '1995-03-26', dept: 'ACC', desig: 'Accounts Executive', wc: null, doj: '2020-09-14', type: 'permanent', gross: 30000, shift: 'GEN', reports: 'MMS-1032', blood: 'B+', married: true, skills: ['Tally Prime', 'Bank reconciliation', 'Petty cash'] },
  { code: 'MMS-1034', first: 'Aishwarya', last: 'Iyer', gender: 'female', dob: '1997-12-01', dept: 'PPC', desig: 'Sales Coordinator', wc: null, doj: '2023-07-03', type: 'probation', gross: 28000, shift: 'GEN', reports: 'MMS-1004', blood: 'O+', married: false, skills: ['Customer follow-up', 'Quotations', 'Dispatch planning'] },
  { code: 'MMS-1035', first: 'Dinesh', last: 'R', gender: 'male', dob: '1994-04-04', dept: 'MCH', desig: 'CNC Operator', wc: 'CNC', doj: '2019-02-11', type: 'permanent', gross: 22000, shift: 'GEN', reports: 'MMS-1005', blood: 'B+', married: true, skills: ['CNC turning'], exit: { date: '2026-06-30', reason: 'Resigned — relocated to Hubballi' } },
  { code: 'MMS-1036', first: 'Kusuma', last: 'G', gender: 'female', dob: '1999-06-15', dept: 'QA', desig: 'Quality Inspector', wc: 'QAI', doj: '2024-03-04', type: 'permanent', gross: 20000, shift: 'GEN', reports: 'MMS-1022', blood: 'A+', married: false, skills: ['Incoming inspection', 'Gauges'], notice: true },
]

export const FIRST_NAMES_FAMILY = ['Shankar', 'Gowramma', 'Nagaraj', 'Savitha', 'Ramaiah', 'Latha', 'Suresh', 'Meena', 'Krishnappa', 'Asha', 'Venkatappa', 'Sudha']
export const RELATIONS_MARRIED = ['Spouse', 'Spouse', 'Father', 'Brother']
export const RELATIONS_SINGLE = ['Father', 'Mother', 'Brother', 'Sister']
export const LOCALITIES = [
  ['Doddaballapura', '561203'], ['Doddaballapura', '561203'], ['Rajanukunte', '560064'], ['Yelahanka', '560064'],
  ['Devanahalli', '562110'], ['Doddaballapura', '561203'], ['Hesaraghatta', '560088'], ['Tumakuru Road, Nelamangala', '562123'],
  ['Vidyaranyapura', '560097'], ['Doddaballapura', '561203'],
] as const

export const BANKS = [
  ['State Bank of India', 'SBIN0040170'], ['Canara Bank', 'CNRB0001546'], ['HDFC Bank', 'HDFC0002621'],
  ['Karnataka Bank', 'KARB0000318'], ['ICICI Bank', 'ICIC0001789'], ['Union Bank of India', 'UBIN0907561'],
] as const

export const HOLIDAYS: [string, string, 'national' | 'festival' | 'optional', string][] = [
  ['2026-01-14', 'Makara Sankranti', 'festival', 'Harvest festival'],
  ['2026-01-26', 'Republic Day', 'national', 'National holiday'],
  ['2026-03-19', 'Ugadi', 'festival', 'Kannada New Year'],
  ['2026-03-20', 'Ramzan (Id-ul-Fitr)', 'optional', 'Optional holiday — subject to moon sighting'],
  ['2026-04-03', 'Good Friday', 'optional', 'Optional holiday'],
  ['2026-05-01', 'May Day', 'national', 'Labour Day'],
  ['2026-05-27', 'Bakrid (Id-ul-Adha)', 'optional', 'Optional holiday — subject to moon sighting'],
  ['2026-08-15', 'Independence Day', 'national', 'National holiday'],
  ['2026-09-14', 'Ganesh Chaturthi', 'festival', 'Varasiddhi Vinayaka Vrata'],
  ['2026-10-02', 'Gandhi Jayanti', 'national', 'National holiday'],
  ['2026-10-19', 'Ayudha Pooja', 'festival', 'Mahanavami — machine & tool pooja on the shop floor'],
  ['2026-10-20', 'Vijayadashami', 'festival', 'Dasara'],
  ['2026-11-01', 'Kannada Rajyotsava', 'national', 'Karnataka Formation Day'],
  ['2026-11-10', 'Deepavali (Balipadyami)', 'festival', 'Festival of lights'],
  ['2026-12-25', 'Christmas', 'festival', 'Christmas Day'],
  ['2027-01-14', 'Makara Sankranti', 'festival', 'Harvest festival'],
  ['2027-01-26', 'Republic Day', 'national', 'National holiday'],
]

export const PETTY_CATEGORIES = [
  'Tea & Refreshments', 'Courier & Postage', 'Shop-floor Consumables', 'Local Conveyance', 'Minor Repairs',
  'Stationery & Printing', 'Housekeeping', 'Pooja & Festivals', 'First-aid & Medical', 'Miscellaneous',
]
