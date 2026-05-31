import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UsersRound, CalendarClock, Plane, Wallet, Plus } from "lucide-react";
import { currencyFractionDigits, minorToMajor } from "@paperclipai/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useToast } from "../context/ToastContext";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { hrApi, type PayrollRunRow } from "../api/hr";

const DEFAULT_CURRENCY = "KWD";
const TABS = [
  { key: "employees", label: "Employees", icon: UsersRound },
  { key: "attendance", label: "Attendance", icon: CalendarClock },
  { key: "leave", label: "Leave Requests", icon: Plane },
  { key: "payroll", label: "Payroll", icon: Wallet },
] as const;

type TabKey = (typeof TABS)[number]["key"];

function formatMinor(amountMinor: number, currency: string): string {
  const digits = currencyFractionDigits(currency);
  return `${minorToMajor(amountMinor, currency).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })} ${currency}`;
}

export function HR() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const [tab, setTab] = useState<TabKey>("employees");

  useEffect(() => {
    setBreadcrumbs([{ label: "HR" }]);
  }, [setBreadcrumbs]);

  if (!selectedCompanyId) {
    return (
      <EmptyState icon={UsersRound} message="Select a workspace to manage HR." />
    );
  }

  return (
    <div className="space-y-6" dir="auto">
      <div>
        <h1 className="text-2xl font-semibold">HR &amp; Payroll</h1>
        <p className="text-sm text-muted-foreground">
          Manage employees, attendance, leave, and payroll runs.
        </p>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-border">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 -mb-px transition-colors ${
                active
                  ? "border-primary text-foreground font-medium"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-4 w-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === "employees" && <EmployeesTab companyId={selectedCompanyId} />}
      {tab === "attendance" && <AttendanceTab companyId={selectedCompanyId} />}
      {tab === "leave" && <LeaveTab companyId={selectedCompanyId} />}
      {tab === "payroll" && <PayrollTab companyId={selectedCompanyId} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Employees tab (read)
// ---------------------------------------------------------------------------
function EmployeesTab({ companyId }: { companyId: string }) {
  const employeesQuery = useQuery({
    queryKey: ["hr", "employees", companyId],
    queryFn: () => hrApi.listEmployees(companyId),
    enabled: !!companyId,
  });

  if (employeesQuery.isLoading) return <PageSkeleton variant="list" />;
  if (employeesQuery.isError) {
    return (
      <EmptyState
        icon={UsersRound}
        message={
          (employeesQuery.error as Error)?.message ?? "Failed to load employees."
        }
      />
    );
  }

  const employees = employeesQuery.data?.employees ?? [];

  if (employees.length === 0) {
    return <EmptyState icon={UsersRound} message="No employees yet." />;
  }

  return (
    <Card>
      <CardContent className="p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-muted-foreground">
              <th className="text-start font-medium px-4 py-2">Title</th>
              <th className="text-start font-medium px-4 py-2">Kind</th>
              <th className="text-start font-medium px-4 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {employees.map((emp) => (
              <tr key={emp.id} className="border-b border-border last:border-0">
                <td className="px-4 py-2">{emp.title ?? "—"}</td>
                <td className="px-4 py-2 capitalize">{emp.kind}</td>
                <td className="px-4 py-2 capitalize">{emp.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Attendance tab
// ---------------------------------------------------------------------------
function AttendanceTab({ companyId }: { companyId: string }) {
  const { pushToast } = useToast();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [employeeId, setEmployeeId] = useState("");
  const [date, setDate] = useState("");
  const [hours, setHours] = useState("8");
  const [status, setStatus] = useState<
    "present" | "absent" | "leave" | "holiday"
  >("present");

  const attendanceQuery = useQuery({
    queryKey: ["hr", "attendance", companyId],
    queryFn: () => hrApi.listAttendance(companyId),
    enabled: !!companyId,
  });

  const createMutation = useMutation({
    mutationFn: () =>
      hrApi.createAttendance(companyId, {
        employeeId: employeeId.trim(),
        date: date ? new Date(date).toISOString() : undefined,
        hours: Number(hours) || 0,
        status,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["hr", "attendance", companyId],
      });
      setDialogOpen(false);
      setEmployeeId("");
      setDate("");
      setHours("8");
      setStatus("present");
      pushToast({ title: "Attendance recorded", tone: "success" });
    },
    onError: (e) =>
      pushToast({
        title: "Failed to record attendance",
        body: (e as Error)?.message,
        tone: "error",
      }),
  });

  if (attendanceQuery.isLoading) return <PageSkeleton variant="list" />;
  if (attendanceQuery.isError) {
    return (
      <EmptyState
        icon={CalendarClock}
        message={
          (attendanceQuery.error as Error)?.message ??
          "Failed to load attendance."
        }
      />
    );
  }

  const records = attendanceQuery.data?.attendance ?? [];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setDialogOpen(true)}>
          <Plus className="me-1.5 h-4 w-4" />
          Record attendance
        </Button>
      </div>

      {records.length === 0 ? (
        <EmptyState icon={CalendarClock} message="No attendance records yet." />
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="text-start font-medium px-4 py-2">Date</th>
                  <th className="text-start font-medium px-4 py-2">Employee</th>
                  <th className="text-end font-medium px-4 py-2">Hours</th>
                  <th className="text-start font-medium px-4 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {records.map((rec) => (
                  <tr
                    key={rec.id}
                    className="border-b border-border last:border-0"
                  >
                    <td className="px-4 py-2">
                      {rec.date ? new Date(rec.date).toLocaleDateString() : "—"}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs">
                      {rec.employeeId}
                    </td>
                    <td className="px-4 py-2 text-end font-mono">{rec.hours}</td>
                    <td className="px-4 py-2 capitalize">{rec.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Record attendance</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="emp-id">Employee ID</Label>
              <Input
                id="emp-id"
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
                placeholder="employee uuid"
                autoFocus
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="att-date">Date</Label>
                <Input
                  id="att-date"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="att-hours">Hours</Label>
                <Input
                  id="att-hours"
                  type="number"
                  min={0}
                  value={hours}
                  onChange={(e) => setHours(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="att-status">Status</Label>
              <select
                id="att-status"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={status}
                onChange={(e) =>
                  setStatus(
                    e.target.value as "present" | "absent" | "leave" | "holiday",
                  )
                }
              >
                <option value="present">Present</option>
                <option value="absent">Absent</option>
                <option value="leave">Leave</option>
                <option value="holiday">Holiday</option>
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={createMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={!employeeId.trim() || createMutation.isPending}
            >
              {createMutation.isPending ? "Saving…" : "Record"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Leave requests tab
// ---------------------------------------------------------------------------
function LeaveTab({ companyId }: { companyId: string }) {
  const { pushToast } = useToast();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [employeeId, setEmployeeId] = useState("");
  const [kind, setKind] = useState<"annual" | "sick" | "unpaid" | "other">(
    "annual",
  );
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");

  const leaveQuery = useQuery({
    queryKey: ["hr", "leave-requests", companyId],
    queryFn: () => hrApi.listLeaveRequests(companyId),
    enabled: !!companyId,
  });

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: ["hr", "leave-requests", companyId],
    });

  const createMutation = useMutation({
    mutationFn: () =>
      hrApi.createLeaveRequest(companyId, {
        employeeId: employeeId.trim(),
        kind,
        startDate: new Date(startDate).toISOString(),
        endDate: new Date(endDate).toISOString(),
        reason: reason.trim() || undefined,
      }),
    onSuccess: () => {
      invalidate();
      setDialogOpen(false);
      setEmployeeId("");
      setKind("annual");
      setStartDate("");
      setEndDate("");
      setReason("");
      pushToast({ title: "Leave requested", tone: "success" });
    },
    onError: (e) =>
      pushToast({
        title: "Failed to request leave",
        body: (e as Error)?.message,
        tone: "error",
      }),
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => hrApi.approveLeaveRequest(companyId, id),
    onSuccess: () => {
      invalidate();
      pushToast({ title: "Leave approved", tone: "success" });
    },
    onError: (e) =>
      pushToast({
        title: "Failed to approve leave",
        body: (e as Error)?.message,
        tone: "error",
      }),
  });

  if (leaveQuery.isLoading) return <PageSkeleton variant="list" />;
  if (leaveQuery.isError) {
    return (
      <EmptyState
        icon={Plane}
        message={
          (leaveQuery.error as Error)?.message ?? "Failed to load leave requests."
        }
      />
    );
  }

  const requests = leaveQuery.data?.leaveRequests ?? [];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setDialogOpen(true)}>
          <Plus className="me-1.5 h-4 w-4" />
          New leave request
        </Button>
      </div>

      {requests.length === 0 ? (
        <EmptyState icon={Plane} message="No leave requests yet." />
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="text-start font-medium px-4 py-2">Employee</th>
                  <th className="text-start font-medium px-4 py-2">Kind</th>
                  <th className="text-start font-medium px-4 py-2">Dates</th>
                  <th className="text-end font-medium px-4 py-2">Days</th>
                  <th className="text-start font-medium px-4 py-2">Status</th>
                  <th className="text-end font-medium px-4 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((req) => (
                  <tr
                    key={req.id}
                    className="border-b border-border last:border-0"
                  >
                    <td className="px-4 py-2 font-mono text-xs">
                      {req.employeeId}
                    </td>
                    <td className="px-4 py-2 capitalize">{req.kind ?? "—"}</td>
                    <td className="px-4 py-2 text-xs">
                      {req.startDate
                        ? new Date(req.startDate).toLocaleDateString()
                        : "—"}
                      {" → "}
                      {req.endDate
                        ? new Date(req.endDate).toLocaleDateString()
                        : "—"}
                    </td>
                    <td className="px-4 py-2 text-end font-mono">{req.days}</td>
                    <td className="px-4 py-2">
                      <span
                        className={`text-xs capitalize ${
                          req.status === "approved"
                            ? "text-emerald-500"
                            : req.status === "rejected"
                              ? "text-red-500"
                              : "text-amber-500"
                        }`}
                      >
                        {req.status}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-end whitespace-nowrap">
                      {req.status === "pending" && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={approveMutation.isPending}
                          onClick={() => approveMutation.mutate(req.id)}
                        >
                          Approve
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New leave request</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="leave-emp">Employee ID</Label>
              <Input
                id="leave-emp"
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
                placeholder="employee uuid"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="leave-kind">Kind</Label>
              <select
                id="leave-kind"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={kind}
                onChange={(e) =>
                  setKind(
                    e.target.value as "annual" | "sick" | "unpaid" | "other",
                  )
                }
              >
                <option value="annual">Annual</option>
                <option value="sick">Sick</option>
                <option value="unpaid">Unpaid</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="leave-start">Start date</Label>
                <Input
                  id="leave-start"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="leave-end">End date</Label>
                <Input
                  id="leave-end"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="leave-reason">Reason</Label>
              <Input
                id="leave-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={createMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={
                !employeeId.trim() ||
                !startDate ||
                !endDate ||
                createMutation.isPending
              }
            >
              {createMutation.isPending ? "Submitting…" : "Submit request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Payroll tab
// ---------------------------------------------------------------------------
function PayrollTab({ companyId }: { companyId: string }) {
  const { pushToast } = useToast();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [period, setPeriod] = useState("");
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  const runsQuery = useQuery({
    queryKey: ["hr", "payroll-runs", companyId],
    queryFn: () => hrApi.listPayrollRuns(companyId),
    enabled: !!companyId,
  });

  const payslipsQuery = useQuery({
    queryKey: ["hr", "payslips", companyId, selectedRunId],
    queryFn: () => hrApi.listPayslips(companyId, selectedRunId ?? undefined),
    enabled: !!companyId && !!selectedRunId,
  });

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: ["hr", "payroll-runs", companyId],
    });

  const createMutation = useMutation({
    mutationFn: () =>
      hrApi.createPayrollRun(companyId, {
        period: period.trim(),
        currency: DEFAULT_CURRENCY,
      }),
    onSuccess: () => {
      invalidate();
      setDialogOpen(false);
      setPeriod("");
      pushToast({ title: "Payroll run created", tone: "success" });
    },
    onError: (e) =>
      pushToast({
        title: "Failed to create payroll run",
        body: (e as Error)?.message,
        tone: "error",
      }),
  });

  const processMutation = useMutation({
    mutationFn: (id: string) => hrApi.processPayrollRun(companyId, id),
    onSuccess: () => {
      invalidate();
      pushToast({ title: "Payroll processed", tone: "success" });
    },
    onError: (e) =>
      pushToast({
        title: "Failed to process payroll",
        body: (e as Error)?.message,
        tone: "error",
      }),
  });

  if (runsQuery.isLoading) return <PageSkeleton variant="list" />;
  if (runsQuery.isError) {
    return (
      <EmptyState
        icon={Wallet}
        message={
          (runsQuery.error as Error)?.message ?? "Failed to load payroll runs."
        }
      />
    );
  }

  const runs = runsQuery.data?.payrollRuns ?? [];
  const payslips = payslipsQuery.data?.payslips ?? [];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setDialogOpen(true)}>
          <Plus className="me-1.5 h-4 w-4" />
          New payroll run
        </Button>
      </div>

      {runs.length === 0 ? (
        <EmptyState icon={Wallet} message="No payroll runs yet." />
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="text-start font-medium px-4 py-2">Period</th>
                  <th className="text-end font-medium px-4 py-2">Gross</th>
                  <th className="text-end font-medium px-4 py-2">Deductions</th>
                  <th className="text-end font-medium px-4 py-2">Net</th>
                  <th className="text-start font-medium px-4 py-2">Status</th>
                  <th className="text-end font-medium px-4 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run: PayrollRunRow) => (
                  <tr
                    key={run.id}
                    className="border-b border-border last:border-0"
                  >
                    <td className="px-4 py-2">{run.period ?? "—"}</td>
                    <td className="px-4 py-2 text-end font-mono">
                      {formatMinor(run.grossMinor, run.currency)}
                    </td>
                    <td className="px-4 py-2 text-end font-mono text-muted-foreground">
                      {formatMinor(run.deductionsMinor, run.currency)}
                    </td>
                    <td className="px-4 py-2 text-end font-mono">
                      {formatMinor(run.netMinor, run.currency)}
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className={`text-xs capitalize ${
                          run.status === "paid"
                            ? "text-emerald-500"
                            : run.status === "processed"
                              ? "text-blue-500"
                              : "text-amber-500"
                        }`}
                      >
                        {run.status}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-end space-x-2 whitespace-nowrap">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setSelectedRunId(run.id)}
                      >
                        Payslips
                      </Button>
                      {run.status === "draft" && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={processMutation.isPending}
                          onClick={() => processMutation.mutate(run.id)}
                        >
                          Process
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {selectedRunId && (
        <div>
          <h2 className="text-sm font-medium mb-2">Payslips</h2>
          {payslipsQuery.isLoading ? (
            <PageSkeleton variant="list" />
          ) : payslips.length === 0 ? (
            <EmptyState icon={Wallet} message="No payslips for this run." />
          ) : (
            <Card>
              <CardContent className="p-0">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-xs text-muted-foreground">
                      <th className="text-start font-medium px-4 py-2">
                        Employee
                      </th>
                      <th className="text-end font-medium px-4 py-2">Gross</th>
                      <th className="text-end font-medium px-4 py-2">
                        Deductions
                      </th>
                      <th className="text-end font-medium px-4 py-2">Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payslips.map((slip) => (
                      <tr
                        key={slip.id}
                        className="border-b border-border last:border-0"
                      >
                        <td className="px-4 py-2">
                          {slip.employeeName ?? slip.employeeId ?? "—"}
                        </td>
                        <td className="px-4 py-2 text-end font-mono">
                          {formatMinor(slip.grossMinor, slip.currency)}
                        </td>
                        <td className="px-4 py-2 text-end font-mono text-muted-foreground">
                          {formatMinor(slip.deductionsMinor, slip.currency)}
                        </td>
                        <td className="px-4 py-2 text-end font-mono">
                          {formatMinor(slip.netMinor, slip.currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New payroll run</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="period">Period</Label>
              <Input
                id="period"
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                placeholder="2026-06"
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={createMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={!period.trim() || createMutation.isPending}
            >
              {createMutation.isPending ? "Creating…" : "Create run"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
