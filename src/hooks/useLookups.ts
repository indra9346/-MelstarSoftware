import { useMemo } from 'react'
import { useTable } from '@/data/store'
import type { Department, Designation, Employee, Shift, WorkCentre } from '@/data/types'
import { fullName } from '@/lib/format'

/**
 * Id → row lookups that nearly every page needs (employee names, departments, designations,
 * work centres, shifts, users). Memoised on the underlying tables, so it re-computes only when
 * one of them changes.
 */
export function useLookups() {
  const employees = useTable('employees')
  const departments = useTable('departments')
  const designations = useTable('designations')
  const workCentres = useTable('work_centres')
  const shifts = useTable('shifts')
  const users = useTable('app_users')
  return useMemo(() => {
    const emp = new Map<string, Employee>(employees.map((e) => [e.id, e]))
    const dept = new Map<string, Department>(departments.map((d) => [d.id, d]))
    const desig = new Map<string, Designation>(designations.map((d) => [d.id, d]))
    const wc = new Map<string, WorkCentre>(workCentres.map((w) => [w.id, w]))
    const shift = new Map<string, Shift>(shifts.map((s) => [s.id, s]))
    const user = new Map(users.map((u) => [u.id, u]))
    return {
      employees,
      activeEmployees: employees.filter((e) => e.status !== 'exited'),
      emp,
      dept,
      desig,
      wc,
      shift,
      user,
      empName: (id: string | null | undefined) => (id ? fullName(emp.get(id)) : '—'),
      deptName: (id: string | null | undefined) => (id ? dept.get(id)?.name ?? '—' : '—'),
      desigTitle: (id: string | null | undefined) => (id ? desig.get(id)?.title ?? '—' : '—'),
      wcName: (id: string | null | undefined) => (id ? wc.get(id)?.name ?? '—' : '—'),
      userName: (id: string | null | undefined) => (id ? user.get(id)?.display_name ?? '—' : '—'),
      employeeOptions: (filter: (e: Employee) => boolean = (e) => e.status !== 'exited') =>
        employees.filter(filter).sort((a, b) => fullName(a).localeCompare(fullName(b))).map((e) => ({ value: e.id, label: `${fullName(e)} · ${e.emp_code}` })),
    }
  }, [employees, departments, designations, workCentres, shifts, users])
}
