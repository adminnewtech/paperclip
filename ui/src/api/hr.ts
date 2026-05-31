import { api } from "./client";

export interface EmployeeRow {
  id: string;
  companyId: string;
  userId: string | null;
  agentId: string | null;
  kind: string;
  departmentId: string | null;
  title: string | null;
  managerId: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface AttendanceRow {
  id: string;
  companyId: string;
  employeeId: string;
  date: string | null;
  checkIn: string | null;
  checkOut: string | null;
  hours: number;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface LeaveRequestRow {
  id: string;
  companyId: string;
  employeeId: string;
  kind: string | null;
  startDate: string | null;
  endDate: string | null;
  days: number;
  status: string;
  reason: string | null;
  approverUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LeavePolicyRow {
  id: string;
  companyId: string;
  name: string | null;
  kind: string | null;
  daysPerYear: number;
  createdAt: string;
  updatedAt: string;
}

export interface PayrollRunRow {
  id: string;
  companyId: string;
  period: string | null;
  status: string;
  grossMinor: number;
  deductionsMinor: number;
  netMinor: number;
  currency: string;
  processedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PayslipRow {
  id: string;
  companyId: string;
  payrollRunId: string | null;
  employeeId: string | null;
  employeeName: string | null;
  grossMinor: number;
  deductionsMinor: number;
  netMinor: number;
  currency: string;
  components: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface AttendanceCreateInput {
  employeeId: string;
  date?: string | null;
  checkIn?: string | null;
  checkOut?: string | null;
  hours?: number;
  status?: "present" | "absent" | "leave" | "holiday";
}

export interface LeaveRequestCreateInput {
  employeeId: string;
  kind: "annual" | "sick" | "unpaid" | "other";
  startDate: string;
  endDate: string;
  days?: number;
  reason?: string | null;
}

export interface LeavePolicyCreateInput {
  name: string;
  kind: "annual" | "sick" | "unpaid" | "other";
  daysPerYear?: number;
}

export interface PayslipInput {
  employeeId?: string | null;
  employeeName?: string | null;
  grossMinor: number;
  deductionsMinor?: number;
  currency?: string;
  components?: Record<string, unknown>;
}

export interface PayrollRunCreateInput {
  period: string;
  currency?: string;
  payslips?: PayslipInput[];
}

export const hrApi = {
  // Employees
  listEmployees: (companyId: string) =>
    api.get<{ employees: EmployeeRow[] }>(
      `/companies/${companyId}/hr/employees`,
    ),

  // Attendance
  listAttendance: (companyId: string, employeeId?: string) => {
    const params = new URLSearchParams();
    if (employeeId) params.set("employeeId", employeeId);
    const qs = params.toString();
    return api.get<{ attendance: AttendanceRow[] }>(
      `/companies/${companyId}/hr/attendance${qs ? `?${qs}` : ""}`,
    );
  },
  createAttendance: (companyId: string, body: AttendanceCreateInput) =>
    api.post<AttendanceRow>(`/companies/${companyId}/hr/attendance`, body),

  // Leave requests
  listLeaveRequests: (companyId: string) =>
    api.get<{ leaveRequests: LeaveRequestRow[] }>(
      `/companies/${companyId}/hr/leave-requests`,
    ),
  createLeaveRequest: (companyId: string, body: LeaveRequestCreateInput) =>
    api.post<LeaveRequestRow>(
      `/companies/${companyId}/hr/leave-requests`,
      body,
    ),
  approveLeaveRequest: (companyId: string, id: string) =>
    api.post<LeaveRequestRow>(
      `/companies/${companyId}/hr/leave-requests/${id}/approve`,
      {},
    ),

  // Leave policies
  listLeavePolicies: (companyId: string) =>
    api.get<{ leavePolicies: LeavePolicyRow[] }>(
      `/companies/${companyId}/hr/leave-policies`,
    ),
  createLeavePolicy: (companyId: string, body: LeavePolicyCreateInput) =>
    api.post<LeavePolicyRow>(
      `/companies/${companyId}/hr/leave-policies`,
      body,
    ),

  // Payroll
  listPayrollRuns: (companyId: string) =>
    api.get<{ payrollRuns: PayrollRunRow[] }>(
      `/companies/${companyId}/hr/payroll-runs`,
    ),
  createPayrollRun: (companyId: string, body: PayrollRunCreateInput) =>
    api.post<PayrollRunRow>(`/companies/${companyId}/hr/payroll-runs`, body),
  processPayrollRun: (companyId: string, id: string) =>
    api.post<PayrollRunRow>(
      `/companies/${companyId}/hr/payroll-runs/${id}/process`,
      {},
    ),
  listPayslips: (companyId: string, payrollRunId?: string) => {
    const params = new URLSearchParams();
    if (payrollRunId) params.set("payrollRunId", payrollRunId);
    const qs = params.toString();
    return api.get<{ payslips: PayslipRow[] }>(
      `/companies/${companyId}/hr/payslips${qs ? `?${qs}` : ""}`,
    );
  },
};
