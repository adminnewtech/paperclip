import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Users,
  UserCheck,
  Calendar,
  DollarSign,
  Building2,
  Plus,
  Check,
  X,
  Mail,
  Phone,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { businessApi, type BusinessEntityRow } from "../api/business";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCurrency(cents: number): string {
  return (cents / 100).toLocaleString("en-SA", {
    style: "currency",
    currency: "SAR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function formatHireDate(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-SA", { year: "numeric", month: "short" });
}

function formatDateRange(from: string, to: string): string {
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  const f = from ? new Date(from).toLocaleDateString("en-SA", opts) : "?";
  const t = to ? new Date(to).toLocaleDateString("en-SA", opts) : "?";
  return `${f} – ${t}`;
}

/** Deterministic color based on name string */
const AVATAR_COLORS = [
  "bg-violet-500",
  "bg-blue-500",
  "bg-emerald-500",
  "bg-amber-500",
  "bg-rose-500",
  "bg-teal-500",
  "bg-indigo-500",
  "bg-orange-500",
];

function avatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]!;
}

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

function EmployeeAvatar({ name, size = "md" }: { name: string; size?: "sm" | "md" | "lg" }) {
  const color = avatarColor(name);
  const sizeClass =
    size === "sm" ? "h-7 w-7 text-xs" : size === "lg" ? "h-12 w-12 text-lg" : "h-9 w-9 text-sm";
  return (
    <div
      className={`${sizeClass} ${color} rounded-full flex items-center justify-center text-white font-semibold shrink-0`}
    >
      {initials(name)}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status Badge
// ---------------------------------------------------------------------------

function LeaveStatusBadge({ status }: { status: string }) {
  const cls =
    status === "approved"
      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400"
      : status === "rejected"
        ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400"
        : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400";
  const label =
    status === "approved" ? "Approved" : status === "rejected" ? "Rejected" : "Pending";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cls}`}
    >
      {label}
    </span>
  );
}

function EmployeeStatusBadge({ status }: { status: string }) {
  const isActive = status === "active";
  const cls = isActive
    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400"
    : "bg-muted text-muted-foreground";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cls}`}
    >
      {isActive ? "Active" : "Inactive"}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Create Employee Dialog
// ---------------------------------------------------------------------------

interface CreateEmployeeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  prefillDepartment?: string;
}

function CreateEmployeeDialog({
  open,
  onOpenChange,
  companyId,
  prefillDepartment = "",
}: CreateEmployeeDialogProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [department, setDepartment] = useState(prefillDepartment);
  const [jobTitle, setJobTitle] = useState("");
  const [hireDate, setHireDate] = useState("");
  const [salaryStr, setSalaryStr] = useState("");

  // Keep department in sync when prefillDepartment changes (dialog re-open)
  useEffect(() => {
    setDepartment(prefillDepartment);
  }, [prefillDepartment]);

  function resetForm() {
    setName("");
    setEmail("");
    setPhone("");
    setDepartment(prefillDepartment);
    setJobTitle("");
    setHireDate("");
    setSalaryStr("");
  }

  const createMutation = useMutation({
    mutationFn: () => {
      const salaryNum = parseFloat(salaryStr) || 0;
      return businessApi.createEntity(companyId, "hr", "employee", {
        entityType: "employee",
        name: name.trim(),
        status: "active",
        amountCents: Math.round(salaryNum * 100),
        data: {
          email: email.trim(),
          phone: phone.trim(),
          department: department.trim(),
          jobTitle: jobTitle.trim(),
          hireDate: hireDate,
        },
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.business.entities(companyId, "hr", "employee"),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.business.financialSummary(companyId),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.business.summary(companyId),
      });
      resetForm();
      onOpenChange(false);
    },
  });

  function handleSubmit() {
    if (!name.trim()) return;
    createMutation.mutate();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) resetForm();
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Employee</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">
              Full Name <span className="text-destructive">*</span>
            </Label>
            <Input
              placeholder="e.g. Fatima Al-Hassan"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Email</Label>
              <Input
                type="email"
                placeholder="fatima@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Phone</Label>
              <Input
                type="tel"
                placeholder="+966 5X XXX XXXX"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Department</Label>
              <Input
                placeholder="e.g. Engineering"
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Job Title</Label>
              <Input
                placeholder="e.g. Software Engineer"
                value={jobTitle}
                onChange={(e) => setJobTitle(e.target.value)}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Hire Date</Label>
              <Input
                type="date"
                value={hireDate}
                onChange={(e) => setHireDate(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Monthly Salary (SAR)</Label>
              <Input
                type="number"
                min={0}
                placeholder="e.g. 15000"
                value={salaryStr}
                onChange={(e) => setSalaryStr(e.target.value)}
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => {
              resetForm();
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!name.trim() || createMutation.isPending}
          >
            {createMutation.isPending ? "Saving…" : "Add Employee"}
          </Button>
        </DialogFooter>
        {createMutation.error && (
          <p className="text-sm text-destructive mt-2">
            {(createMutation.error as Error).message}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Create Leave Request Dialog
// ---------------------------------------------------------------------------

interface CreateLeaveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  employees: BusinessEntityRow[];
}

function CreateLeaveDialog({ open, onOpenChange, companyId, employees }: CreateLeaveDialogProps) {
  const queryClient = useQueryClient();
  const [employeeId, setEmployeeId] = useState("");
  const [kind, setKind] = useState("annual");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [reason, setReason] = useState("");

  function resetForm() {
    setEmployeeId("");
    setKind("annual");
    setFrom("");
    setTo("");
    setReason("");
  }

  const createMutation = useMutation({
    mutationFn: () => {
      const emp = employees.find((e) => e.id === employeeId);
      return businessApi.createEntity(companyId, "hr", "leave_request", {
        entityType: "leave_request",
        name: emp?.name ?? "Leave Request",
        status: "pending",
        data: {
          employeeId,
          kind,
          from,
          to,
          reason: reason.trim(),
        },
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.business.entities(companyId, "hr", "leave_request"),
      });
      resetForm();
      onOpenChange(false);
    },
  });

  function handleSubmit() {
    if (!employeeId || !from || !to) return;
    createMutation.mutate();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) resetForm();
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New Leave Request</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">
              Employee <span className="text-destructive">*</span>
            </Label>
            <Select value={employeeId} onValueChange={setEmployeeId}>
              <SelectTrigger>
                <SelectValue placeholder="Select employee…" />
              </SelectTrigger>
              <SelectContent>
                {employees.map((emp) => (
                  <SelectItem key={emp.id} value={emp.id}>
                    {emp.name ?? emp.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Leave Type</Label>
            <Select value={kind} onValueChange={setKind}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="annual">Annual Leave</SelectItem>
                <SelectItem value="sick">Sick Leave</SelectItem>
                <SelectItem value="unpaid">Unpaid Leave</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">
                From <span className="text-destructive">*</span>
              </Label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">
                To <span className="text-destructive">*</span>
              </Label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Reason</Label>
            <Input
              placeholder="Optional reason…"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => {
              resetForm();
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!employeeId || !from || !to || createMutation.isPending}
          >
            {createMutation.isPending ? "Submitting…" : "Submit Request"}
          </Button>
        </DialogFooter>
        {createMutation.error && (
          <p className="text-sm text-destructive mt-2">
            {(createMutation.error as Error).message}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Employees Tab
// ---------------------------------------------------------------------------

function EmployeesTab({
  companyId,
  employees,
  isLoading,
  onAddEmployee,
}: {
  companyId: string;
  employees: BusinessEntityRow[];
  isLoading: boolean;
  onAddEmployee: (dept?: string) => void;
}) {
  const [deptFilter, setDeptFilter] = useState("all");
  const [search, setSearch] = useState("");

  const departments = useMemo(() => {
    const depts = new Set<string>();
    for (const emp of employees) {
      const dept = (emp.data as Record<string, string>).department;
      if (dept) depts.add(dept);
    }
    return Array.from(depts).sort();
  }, [employees]);

  const filtered = useMemo(() => {
    return employees.filter((emp) => {
      const d = (emp.data as Record<string, string>).department ?? "";
      if (deptFilter !== "all" && d !== deptFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        const name = (emp.name ?? "").toLowerCase();
        const email = ((emp.data as Record<string, string>).email ?? "").toLowerCase();
        const dept = d.toLowerCase();
        if (!name.includes(q) && !email.includes(q) && !dept.includes(q)) return false;
      }
      return true;
    });
  }, [employees, deptFilter, search]);

  if (isLoading) return <PageSkeleton variant="list" />;

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 flex-1 max-w-md">
          <Input
            placeholder="Search employees…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8"
          />
          {departments.length > 0 && (
            <Select value={deptFilter} onValueChange={setDeptFilter}>
              <SelectTrigger className="h-8 w-44 shrink-0">
                <SelectValue placeholder="All departments" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All departments</SelectItem>
                {departments.map((d) => (
                  <SelectItem key={d} value={d}>
                    {d}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        <Button size="sm" onClick={() => onAddEmployee()}>
          <Plus className="h-4 w-4 mr-1.5" />
          Add Employee
        </Button>
      </div>

      {filtered.length === 0 && (
        <EmptyState
          icon={Users}
          message={
            employees.length === 0
              ? "No employees yet. Add your first team member."
              : "No employees match your search."
          }
          action={employees.length === 0 ? "Add Employee" : undefined}
          onAction={employees.length === 0 ? () => onAddEmployee() : undefined}
        />
      )}

      {filtered.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((emp) => {
            const d = emp.data as Record<string, string>;
            const empName = emp.name ?? "Unknown";
            return (
              <Card key={emp.id} className="hover:shadow-md transition-shadow">
                <CardContent className="p-4">
                  <div className="flex items-start gap-3 mb-3">
                    <EmployeeAvatar name={empName} size="lg" />
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm leading-tight truncate">{empName}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {[d.jobTitle, d.department].filter(Boolean).join(" · ") || "—"}
                      </p>
                    </div>
                  </div>
                  <div className="space-y-1.5 text-xs text-muted-foreground">
                    {d.email && (
                      <div className="flex items-center gap-1.5 min-w-0">
                        <Mail className="h-3 w-3 shrink-0" />
                        <span className="truncate">{d.email}</span>
                      </div>
                    )}
                    {d.phone && (
                      <div className="flex items-center gap-1.5">
                        <Phone className="h-3 w-3 shrink-0" />
                        <span>{d.phone}</span>
                      </div>
                    )}
                  </div>
                  <div className="mt-3 pt-3 border-t flex items-center justify-between gap-2 text-xs">
                    <div className="space-y-0.5">
                      {d.hireDate && (
                        <p className="text-muted-foreground">
                          Hired: <span className="text-foreground font-medium">{formatHireDate(d.hireDate)}</span>
                        </p>
                      )}
                      {emp.amountCents != null && emp.amountCents > 0 && (
                        <p className="text-muted-foreground">
                          Salary:{" "}
                          <span className="text-foreground font-medium tabular-nums">
                            {formatCurrency(emp.amountCents)}/mo
                          </span>
                        </p>
                      )}
                    </div>
                    <EmployeeStatusBadge status={emp.status} />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Leave Requests Tab
// ---------------------------------------------------------------------------

const LEAVE_KIND_LABELS: Record<string, string> = {
  annual: "Annual",
  sick: "Sick",
  unpaid: "Unpaid",
  other: "Other",
};

function LeaveRequestsTab({
  companyId,
  employees,
  leaveRequests,
  isLoading,
  onAddRequest,
}: {
  companyId: string;
  employees: BusinessEntityRow[];
  leaveRequests: BusinessEntityRow[];
  isLoading: boolean;
  onAddRequest: () => void;
}) {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("all");

  const employeeMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of employees) {
      if (e.name) m.set(e.id, e.name);
    }
    return m;
  }, [employees]);

  const approveMutation = useMutation({
    mutationFn: (id: string) =>
      businessApi.updateStatus(companyId, "hr", "leave_request", id, "approved"),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.business.entities(companyId, "hr", "leave_request"),
      });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: (id: string) =>
      businessApi.updateStatus(companyId, "hr", "leave_request", id, "rejected"),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.business.entities(companyId, "hr", "leave_request"),
      });
    },
  });

  const filtered = useMemo(() => {
    if (statusFilter === "all") return leaveRequests;
    return leaveRequests.filter((r) => r.status === statusFilter);
  }, [leaveRequests, statusFilter]);

  const pendingCount = leaveRequests.filter((r) => r.status === "pending").length;

  if (isLoading) return <PageSkeleton variant="list" />;

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-8 w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All requests</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
            </SelectContent>
          </Select>
          {pendingCount > 0 && (
            <Badge variant="secondary" className="text-[10px]">
              {pendingCount} pending
            </Badge>
          )}
        </div>
        <Button size="sm" onClick={onAddRequest}>
          <Plus className="h-4 w-4 mr-1.5" />
          New Request
        </Button>
      </div>

      {filtered.length === 0 && (
        <EmptyState
          icon={Calendar}
          message={
            leaveRequests.length === 0
              ? "No leave requests yet."
              : "No requests match the selected filter."
          }
          action={leaveRequests.length === 0 ? "New Request" : undefined}
          onAction={leaveRequests.length === 0 ? onAddRequest : undefined}
        />
      )}

      {filtered.length > 0 && (
        <div className="border rounded-lg overflow-hidden">
          {/* Header */}
          <div className="hidden sm:grid sm:grid-cols-[2fr_1fr_1fr_1fr_auto] gap-3 px-4 py-2 bg-muted/50 border-b text-xs font-medium text-muted-foreground uppercase tracking-wide">
            <span>Employee</span>
            <span>Type</span>
            <span>Period</span>
            <span>Status</span>
            <span className="w-24 text-right">Actions</span>
          </div>
          <div className="divide-y">
            {filtered.map((req) => {
              const d = req.data as Record<string, string>;
              const empName = employeeMap.get(d.employeeId ?? "") ?? d.employeeId ?? "Unknown";
              const isPending = req.status === "pending";
              const isApproving = approveMutation.isPending && approveMutation.variables === req.id;
              const isRejecting = rejectMutation.isPending && rejectMutation.variables === req.id;

              return (
                <div
                  key={req.id}
                  className="grid grid-cols-1 sm:grid-cols-[2fr_1fr_1fr_1fr_auto] gap-2 sm:gap-3 items-start sm:items-center px-4 py-3 bg-card hover:bg-muted/30"
                >
                  {/* Employee */}
                  <div className="flex items-center gap-2 min-w-0">
                    <EmployeeAvatar name={empName} size="sm" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{empName}</p>
                      {d.reason && (
                        <p className="text-xs text-muted-foreground truncate max-w-xs">{d.reason}</p>
                      )}
                    </div>
                  </div>

                  {/* Type */}
                  <div>
                    <span className="text-sm">
                      {LEAVE_KIND_LABELS[d.kind ?? ""] ?? d.kind ?? "—"}
                    </span>
                    <p className="text-[10px] text-muted-foreground sm:hidden">
                      {d.from && d.to ? formatDateRange(d.from, d.to) : "—"}
                    </p>
                  </div>

                  {/* Period */}
                  <div className="hidden sm:block text-sm text-muted-foreground">
                    {d.from && d.to ? formatDateRange(d.from, d.to) : "—"}
                  </div>

                  {/* Status */}
                  <div>
                    <LeaveStatusBadge status={req.status} />
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 sm:justify-end w-24 shrink-0">
                    {isPending && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-emerald-600 border-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950"
                          disabled={isApproving || isRejecting}
                          onClick={() => approveMutation.mutate(req.id)}
                          title="Approve"
                        >
                          <Check className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-red-600 border-red-300 hover:bg-red-50 dark:hover:bg-red-950"
                          disabled={isApproving || isRejecting}
                          onClick={() => rejectMutation.mutate(req.id)}
                          title="Reject"
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Payroll Tab
// ---------------------------------------------------------------------------

function PayrollTab({
  companyId,
  employees,
  isLoading,
}: {
  companyId: string;
  employees: BusinessEntityRow[];
  isLoading: boolean;
}) {
  const queryClient = useQueryClient();
  const [runningPayroll, setRunningPayroll] = useState(false);

  const activeEmployees = useMemo(
    () => employees.filter((e) => e.status === "active"),
    [employees],
  );

  const sortedByPayroll = useMemo(
    () =>
      [...activeEmployees].sort((a, b) => (b.amountCents ?? 0) - (a.amountCents ?? 0)),
    [activeEmployees],
  );

  const totalCents = useMemo(
    () => activeEmployees.reduce((sum, e) => sum + (e.amountCents ?? 0), 0),
    [activeEmployees],
  );

  const runPayrollMutation = useMutation({
    mutationFn: () => {
      const now = new Date();
      const monthYear = now.toLocaleDateString("en-SA", { month: "long", year: "numeric" });
      return businessApi.createEntity(companyId, "finance", "expense", {
        entityType: "expense",
        name: `Payroll ${monthYear}`,
        status: "paid",
        amountCents: totalCents,
        data: {
          category: "payroll",
          headcount: activeEmployees.length,
          period: monthYear,
        },
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.business.financialSummary(companyId),
      });
      setRunningPayroll(false);
    },
    onError: () => {
      setRunningPayroll(false);
    },
  });

  function handleRunPayroll() {
    setRunningPayroll(true);
    runPayrollMutation.mutate();
  }

  if (isLoading) return <PageSkeleton variant="list" />;

  const now = new Date();
  const monthLabel = now.toLocaleDateString("en-SA", { month: "long", year: "numeric" });

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="bg-blue-100 dark:bg-blue-900/30 p-2 rounded-lg">
              <Users className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Active Headcount
              </p>
              <p className="text-2xl font-bold tabular-nums">{activeEmployees.length}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="bg-emerald-100 dark:bg-emerald-900/30 p-2 rounded-lg">
              <DollarSign className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Total Monthly Cost
              </p>
              <p className="text-2xl font-bold tabular-nums">{formatCurrency(totalCents)}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="bg-violet-100 dark:bg-violet-900/30 p-2 rounded-lg">
              <Calendar className="h-5 w-5 text-violet-600 dark:text-violet-400" />
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Pay Period
              </p>
              <p className="text-lg font-semibold">{monthLabel}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Payroll table */}
      {activeEmployees.length === 0 ? (
        <EmptyState icon={DollarSign} message="No active employees to include in payroll." />
      ) : (
        <div className="border rounded-lg overflow-hidden">
          {/* Header */}
          <div className="grid grid-cols-[2fr_1fr_1fr_1fr] gap-3 px-4 py-2.5 bg-muted/50 border-b text-xs font-medium text-muted-foreground uppercase tracking-wide">
            <span>Employee</span>
            <span>Department</span>
            <span>Job Title</span>
            <span className="text-right">Monthly Salary</span>
          </div>
          <div className="divide-y">
            {sortedByPayroll.map((emp) => {
              const d = emp.data as Record<string, string>;
              const empName = emp.name ?? "Unknown";
              return (
                <div
                  key={emp.id}
                  className="grid grid-cols-[2fr_1fr_1fr_1fr] gap-3 items-center px-4 py-3 bg-card hover:bg-muted/30"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <EmployeeAvatar name={empName} size="sm" />
                    <span className="text-sm font-medium truncate">{empName}</span>
                  </div>
                  <span className="text-sm text-muted-foreground truncate">
                    {d.department || "—"}
                  </span>
                  <span className="text-sm text-muted-foreground truncate">
                    {d.jobTitle || "—"}
                  </span>
                  <span className="text-sm font-mono font-medium text-right tabular-nums">
                    {emp.amountCents != null && emp.amountCents > 0
                      ? formatCurrency(emp.amountCents)
                      : "—"}
                  </span>
                </div>
              );
            })}
          </div>
          {/* Footer total */}
          <div className="grid grid-cols-[2fr_1fr_1fr_1fr] gap-3 items-center px-4 py-3 bg-muted/30 border-t">
            <span className="text-sm font-semibold col-span-3">Total Payroll</span>
            <span className="text-base font-bold tabular-nums text-right">
              {formatCurrency(totalCents)}
            </span>
          </div>
        </div>
      )}

      {/* Run payroll button */}
      {activeEmployees.length > 0 && (
        <div className="flex justify-end">
          <Button
            onClick={handleRunPayroll}
            disabled={runPayrollMutation.isPending || runningPayroll}
            className="min-w-36"
          >
            <DollarSign className="h-4 w-4 mr-1.5" />
            {runPayrollMutation.isPending ? "Running Payroll…" : `Run Payroll – ${monthLabel}`}
          </Button>
        </div>
      )}
      {runPayrollMutation.isSuccess && (
        <p className="text-sm text-emerald-600 dark:text-emerald-400 text-right">
          Payroll record created successfully.
        </p>
      )}
      {runPayrollMutation.error && (
        <p className="text-sm text-destructive text-right">
          {(runPayrollMutation.error as Error).message}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Departments Tab
// ---------------------------------------------------------------------------

interface DepartmentInfo {
  name: string;
  employees: BusinessEntityRow[];
  totalCents: number;
  avgCents: number;
}

function DepartmentsTab({
  companyId,
  employees,
  isLoading,
  onAddEmployee,
}: {
  companyId: string;
  employees: BusinessEntityRow[];
  isLoading: boolean;
  onAddEmployee: (dept: string) => void;
}) {
  const departments = useMemo<DepartmentInfo[]>(() => {
    const map = new Map<string, BusinessEntityRow[]>();

    for (const emp of employees) {
      const dept = ((emp.data as Record<string, string>).department ?? "").trim() || "Unassigned";
      const existing = map.get(dept) ?? [];
      existing.push(emp);
      map.set(dept, existing);
    }

    return Array.from(map.entries())
      .map(([name, emps]) => {
        const total = emps.reduce((s, e) => s + (e.amountCents ?? 0), 0);
        return {
          name,
          employees: emps,
          totalCents: total,
          avgCents: emps.length > 0 ? Math.round(total / emps.length) : 0,
        };
      })
      .sort((a, b) => b.employees.length - a.employees.length);
  }, [employees]);

  if (isLoading) return <PageSkeleton variant="list" />;

  if (employees.length === 0) {
    return (
      <EmptyState
        icon={Building2}
        message="No departments yet. Add employees to see departments."
      />
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {departments.length} department{departments.length !== 1 ? "s" : ""} ·{" "}
        {employees.length} employee{employees.length !== 1 ? "s" : ""} total
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {departments.map((dept) => (
          <Card key={dept.name}>
            <CardHeader className="pb-2 pt-4 px-4">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="bg-muted rounded-md p-1.5">
                    <Building2 className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div>
                    <CardTitle className="text-base">{dept.name}</CardTitle>
                    <p className="text-xs text-muted-foreground">
                      {dept.employees.length} employee{dept.employees.length !== 1 ? "s" : ""}
                    </p>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs shrink-0"
                  onClick={() => onAddEmployee(dept.name === "Unassigned" ? "" : dept.name)}
                >
                  <Plus className="h-3 w-3 mr-1" />
                  Add
                </Button>
              </div>
            </CardHeader>
            <CardContent className="px-4 pb-4 space-y-3">
              {/* Stats */}
              <div className="grid grid-cols-2 gap-2 text-xs">
                {dept.totalCents > 0 && (
                  <>
                    <div className="bg-muted/50 rounded p-2">
                      <p className="text-muted-foreground">Total Payroll</p>
                      <p className="font-semibold tabular-nums">{formatCurrency(dept.totalCents)}</p>
                    </div>
                    <div className="bg-muted/50 rounded p-2">
                      <p className="text-muted-foreground">Avg. Salary</p>
                      <p className="font-semibold tabular-nums">{formatCurrency(dept.avgCents)}</p>
                    </div>
                  </>
                )}
              </div>

              {/* Employee list */}
              <div className="space-y-1.5">
                {dept.employees.map((emp) => {
                  const d = emp.data as Record<string, string>;
                  const empName = emp.name ?? "Unknown";
                  return (
                    <div
                      key={emp.id}
                      className="flex items-center gap-2 py-1 text-sm"
                    >
                      <EmployeeAvatar name={empName} size="sm" />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate leading-tight">{empName}</p>
                        {d.jobTitle && (
                          <p className="text-xs text-muted-foreground truncate">{d.jobTitle}</p>
                        )}
                      </div>
                      <EmployeeStatusBadge status={emp.status} />
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export function BusinessHRPage() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const [activeTab, setActiveTab] = useState("employees");
  const [addEmployeeOpen, setAddEmployeeOpen] = useState(false);
  const [addEmployeeDept, setAddEmployeeDept] = useState("");
  const [addLeaveOpen, setAddLeaveOpen] = useState(false);

  useEffect(() => {
    setBreadcrumbs([
      { label: "Business", href: "/business" },
      { label: "HR" },
    ]);
  }, [setBreadcrumbs]);

  const companyId = selectedCompanyId ?? "";

  const employeesQuery = useQuery({
    queryKey: queryKeys.business.entities(companyId, "hr", "employee"),
    queryFn: () => businessApi.listEntities(companyId, "hr", "employee"),
    enabled: !!companyId,
  });

  const leaveQuery = useQuery({
    queryKey: queryKeys.business.entities(companyId, "hr", "leave_request"),
    queryFn: () => businessApi.listEntities(companyId, "hr", "leave_request"),
    enabled: !!companyId,
  });

  const employees = employeesQuery.data?.entities ?? [];
  const leaveRequests = leaveQuery.data?.entities ?? [];

  const pendingLeave = leaveRequests.filter((r) => r.status === "pending").length;
  const activeEmployees = employees.filter((e) => e.status === "active").length;

  if (!companyId) {
    return <EmptyState icon={Users} message="Select a workspace first." />;
  }

  function openAddEmployee(dept = "") {
    setAddEmployeeDept(dept);
    setAddEmployeeOpen(true);
  }

  return (
    <div className="space-y-5">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Human Resources</h1>
          <p className="text-sm text-muted-foreground">
            {activeEmployees} active employee{activeEmployees !== 1 ? "s" : ""}
            {pendingLeave > 0 && ` · ${pendingLeave} pending leave request${pendingLeave !== 1 ? "s" : ""}`}
          </p>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="employees" className="gap-1.5">
            <Users className="h-3.5 w-3.5" />
            Employees
            {employees.length > 0 && (
              <Badge variant="secondary" className="text-[10px] px-1.5 ml-0.5">
                {employees.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="leave" className="gap-1.5">
            <Calendar className="h-3.5 w-3.5" />
            Leave Requests
            {pendingLeave > 0 && (
              <Badge
                variant="secondary"
                className="text-[10px] px-1.5 ml-0.5 bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400"
              >
                {pendingLeave}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="payroll" className="gap-1.5">
            <DollarSign className="h-3.5 w-3.5" />
            Payroll
          </TabsTrigger>
          <TabsTrigger value="departments" className="gap-1.5">
            <Building2 className="h-3.5 w-3.5" />
            Departments
          </TabsTrigger>
        </TabsList>

        <TabsContent value="employees" className="mt-4">
          <EmployeesTab
            companyId={companyId}
            employees={employees}
            isLoading={employeesQuery.isLoading}
            onAddEmployee={openAddEmployee}
          />
        </TabsContent>

        <TabsContent value="leave" className="mt-4">
          <LeaveRequestsTab
            companyId={companyId}
            employees={employees}
            leaveRequests={leaveRequests}
            isLoading={leaveQuery.isLoading}
            onAddRequest={() => setAddLeaveOpen(true)}
          />
        </TabsContent>

        <TabsContent value="payroll" className="mt-4">
          <PayrollTab
            companyId={companyId}
            employees={employees}
            isLoading={employeesQuery.isLoading}
          />
        </TabsContent>

        <TabsContent value="departments" className="mt-4">
          <DepartmentsTab
            companyId={companyId}
            employees={employees}
            isLoading={employeesQuery.isLoading}
            onAddEmployee={openAddEmployee}
          />
        </TabsContent>
      </Tabs>

      {/* Dialogs */}
      <CreateEmployeeDialog
        open={addEmployeeOpen}
        onOpenChange={setAddEmployeeOpen}
        companyId={companyId}
        prefillDepartment={addEmployeeDept}
      />
      <CreateLeaveDialog
        open={addLeaveOpen}
        onOpenChange={setAddLeaveOpen}
        companyId={companyId}
        employees={employees}
      />
    </div>
  );
}
