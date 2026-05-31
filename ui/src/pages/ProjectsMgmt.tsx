import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  FolderKanban,
  ListChecks,
  Clock,
  Flag,
  Plus,
} from "lucide-react";
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
import {
  projectsMgmtApi,
  type ProjectRow,
  type TaskRow,
} from "../api/projects-mgmt";

const DEFAULT_CURRENCY = "KWD";
const TABS = [
  { key: "projects", label: "Projects", icon: FolderKanban },
  { key: "tasks", label: "Tasks", icon: ListChecks },
  { key: "timesheets", label: "Timesheets", icon: Clock },
  { key: "milestones", label: "Milestones", icon: Flag },
] as const;

type TabKey = (typeof TABS)[number]["key"];

const TASK_COLUMNS = [
  { key: "todo", label: "To Do" },
  { key: "in_progress", label: "In Progress" },
  { key: "done", label: "Done" },
  { key: "blocked", label: "Blocked" },
] as const;

function formatMinor(amountMinor: number, currency: string): string {
  const digits = currencyFractionDigits(currency);
  return `${minorToMajor(amountMinor, currency).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })} ${currency}`;
}

export function ProjectsMgmt() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const [tab, setTab] = useState<TabKey>("projects");

  useEffect(() => {
    setBreadcrumbs([{ label: "Projects" }]);
  }, [setBreadcrumbs]);

  if (!selectedCompanyId) {
    return (
      <EmptyState
        icon={FolderKanban}
        message="Select a workspace to manage projects."
      />
    );
  }

  return (
    <div className="space-y-6" dir="auto">
      <div>
        <h1 className="text-2xl font-semibold">Projects</h1>
        <p className="text-sm text-muted-foreground">
          Manage projects, tasks, timesheets, and milestones.
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

      {tab === "projects" && <ProjectsTab companyId={selectedCompanyId} />}
      {tab === "tasks" && <TasksTab companyId={selectedCompanyId} />}
      {tab === "timesheets" && <TimesheetsTab companyId={selectedCompanyId} />}
      {tab === "milestones" && <MilestonesTab companyId={selectedCompanyId} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Projects tab
// ---------------------------------------------------------------------------
function ProjectsTab({ companyId }: { companyId: string }) {
  const { pushToast } = useToast();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [customerName, setCustomerName] = useState("");

  const projectsQuery = useQuery({
    queryKey: ["projects-mgmt", "projects", companyId],
    queryFn: () => projectsMgmtApi.listProjects(companyId),
    enabled: !!companyId,
  });

  const createMutation = useMutation({
    mutationFn: () =>
      projectsMgmtApi.createProject(companyId, {
        name: name.trim(),
        customerName: customerName.trim() || undefined,
        currency: DEFAULT_CURRENCY,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["projects-mgmt", "projects", companyId],
      });
      setDialogOpen(false);
      setName("");
      setCustomerName("");
      pushToast({ title: "Project created", tone: "success" });
    },
    onError: (e) =>
      pushToast({
        title: "Failed to create project",
        body: (e as Error)?.message,
        tone: "error",
      }),
  });

  if (projectsQuery.isLoading) return <PageSkeleton variant="list" />;
  if (projectsQuery.isError) {
    return (
      <EmptyState
        icon={FolderKanban}
        message={
          (projectsQuery.error as Error)?.message ?? "Failed to load projects."
        }
      />
    );
  }

  const projects = projectsQuery.data?.projects ?? [];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setDialogOpen(true)}>
          <Plus className="me-1.5 h-4 w-4" />
          New project
        </Button>
      </div>

      {projects.length === 0 ? (
        <EmptyState icon={FolderKanban} message="No projects yet." />
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="text-start font-medium px-4 py-2">Name</th>
                  <th className="text-start font-medium px-4 py-2">Customer</th>
                  <th className="text-end font-medium px-4 py-2">Budget</th>
                  <th className="text-start font-medium px-4 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((p: ProjectRow) => (
                  <tr key={p.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-2 font-medium">{p.name}</td>
                    <td className="px-4 py-2">{p.customerName ?? "—"}</td>
                    <td className="px-4 py-2 text-end font-mono">
                      {formatMinor(p.budgetMinor, p.currency)}
                    </td>
                    <td className="px-4 py-2">
                      <StatusBadge status={p.status} />
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
            <DialogTitle>New project</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="project-name">Name</Label>
              <Input
                id="project-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Website redesign"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="project-customer">Customer</Label>
              <Input
                id="project-customer"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
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
              disabled={!name.trim() || createMutation.isPending}
            >
              {createMutation.isPending ? "Creating…" : "Create project"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tasks tab (kanban)
// ---------------------------------------------------------------------------
function TasksTab({ companyId }: { companyId: string }) {
  const { pushToast } = useToast();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [title, setTitle] = useState("");

  const tasksQuery = useQuery({
    queryKey: ["projects-mgmt", "tasks", companyId],
    queryFn: () => projectsMgmtApi.listTasks(companyId),
    enabled: !!companyId,
  });

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: ["projects-mgmt", "tasks", companyId],
    });

  const createMutation = useMutation({
    mutationFn: () =>
      projectsMgmtApi.createTask(companyId, { title: title.trim() }),
    onSuccess: () => {
      invalidate();
      setDialogOpen(false);
      setTitle("");
      pushToast({ title: "Task created", tone: "success" });
    },
    onError: (e) =>
      pushToast({
        title: "Failed to create task",
        body: (e as Error)?.message,
        tone: "error",
      }),
  });

  const completeMutation = useMutation({
    mutationFn: (id: string) => projectsMgmtApi.completeTask(companyId, id),
    onSuccess: () => {
      invalidate();
      pushToast({ title: "Task completed", tone: "success" });
    },
    onError: (e) =>
      pushToast({
        title: "Failed to complete task",
        body: (e as Error)?.message,
        tone: "error",
      }),
  });

  const tasksByStatus = useMemo(() => {
    const map: Record<string, TaskRow[]> = {
      todo: [],
      in_progress: [],
      done: [],
      blocked: [],
    };
    for (const task of tasksQuery.data?.tasks ?? []) {
      (map[task.status] ?? (map[task.status] = [])).push(task);
    }
    return map;
  }, [tasksQuery.data]);

  if (tasksQuery.isLoading) return <PageSkeleton variant="list" />;
  if (tasksQuery.isError) {
    return (
      <EmptyState
        icon={ListChecks}
        message={(tasksQuery.error as Error)?.message ?? "Failed to load tasks."}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setDialogOpen(true)}>
          <Plus className="me-1.5 h-4 w-4" />
          New task
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {TASK_COLUMNS.map((col) => {
          const items = tasksByStatus[col.key] ?? [];
          return (
            <div key={col.key} className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground flex items-center justify-between">
                <span>{col.label}</span>
                <span>{items.length}</span>
              </div>
              <div className="space-y-2">
                {items.length === 0 ? (
                  <div className="text-xs text-muted-foreground border border-dashed border-border rounded-md p-3 text-center">
                    Empty
                  </div>
                ) : (
                  items.map((task) => (
                    <Card key={task.id}>
                      <CardContent className="p-3 space-y-2">
                        <div className="text-sm font-medium">
                          {task.title ?? "—"}
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-muted-foreground capitalize">
                            {task.priority}
                          </span>
                          {task.status !== "done" && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={completeMutation.isPending}
                              onClick={() => completeMutation.mutate(task.id)}
                            >
                              Complete
                            </Button>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New task</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="task-title">Title</Label>
              <Input
                id="task-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
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
              disabled={!title.trim() || createMutation.isPending}
            >
              {createMutation.isPending ? "Creating…" : "Create task"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Timesheets tab
// ---------------------------------------------------------------------------
function TimesheetsTab({ companyId }: { companyId: string }) {
  const { pushToast } = useToast();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [hours, setHours] = useState("0");
  const [note, setNote] = useState("");

  const tsQuery = useQuery({
    queryKey: ["projects-mgmt", "timesheets", companyId],
    queryFn: () => projectsMgmtApi.listTimesheets(companyId),
    enabled: !!companyId,
  });

  const createMutation = useMutation({
    mutationFn: () =>
      projectsMgmtApi.createTimesheet(companyId, {
        hours: Number(hours) || 0,
        note: note.trim() || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["projects-mgmt", "timesheets", companyId],
      });
      setDialogOpen(false);
      setHours("0");
      setNote("");
      pushToast({ title: "Time logged", tone: "success" });
    },
    onError: (e) =>
      pushToast({
        title: "Failed to log time",
        body: (e as Error)?.message,
        tone: "error",
      }),
  });

  if (tsQuery.isLoading) return <PageSkeleton variant="list" />;
  if (tsQuery.isError) {
    return (
      <EmptyState
        icon={Clock}
        message={
          (tsQuery.error as Error)?.message ?? "Failed to load timesheets."
        }
      />
    );
  }

  const timesheets = tsQuery.data?.timesheets ?? [];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setDialogOpen(true)}>
          <Plus className="me-1.5 h-4 w-4" />
          Log time
        </Button>
      </div>

      {timesheets.length === 0 ? (
        <EmptyState icon={Clock} message="No timesheet entries yet." />
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="text-start font-medium px-4 py-2">Date</th>
                  <th className="text-end font-medium px-4 py-2">Hours</th>
                  <th className="text-start font-medium px-4 py-2">Billable</th>
                  <th className="text-end font-medium px-4 py-2">Rate</th>
                  <th className="text-start font-medium px-4 py-2">Note</th>
                </tr>
              </thead>
              <tbody>
                {timesheets.map((ts) => (
                  <tr key={ts.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-2">
                      {ts.date ? new Date(ts.date).toLocaleDateString() : "—"}
                    </td>
                    <td className="px-4 py-2 text-end font-mono">{ts.hours}</td>
                    <td className="px-4 py-2">
                      {ts.billable ? (
                        <span className="text-emerald-500 text-xs">Billable</span>
                      ) : (
                        <span className="text-muted-foreground text-xs">No</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-end font-mono">
                      {formatMinor(ts.rateMinor, DEFAULT_CURRENCY)}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {ts.note ?? "—"}
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
            <DialogTitle>Log time</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="ts-hours">Hours</Label>
              <Input
                id="ts-hours"
                type="number"
                min={0}
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ts-note">Note</Label>
              <Input
                id="ts-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
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
              disabled={createMutation.isPending}
            >
              {createMutation.isPending ? "Saving…" : "Log time"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Milestones tab
// ---------------------------------------------------------------------------
function MilestonesTab({ companyId }: { companyId: string }) {
  const { pushToast } = useToast();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [dueDate, setDueDate] = useState("");

  const msQuery = useQuery({
    queryKey: ["projects-mgmt", "milestones", companyId],
    queryFn: () => projectsMgmtApi.listMilestones(companyId),
    enabled: !!companyId,
  });

  const createMutation = useMutation({
    mutationFn: () =>
      projectsMgmtApi.createMilestone(companyId, {
        name: name.trim(),
        dueDate: dueDate ? new Date(dueDate).toISOString() : undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["projects-mgmt", "milestones", companyId],
      });
      setDialogOpen(false);
      setName("");
      setDueDate("");
      pushToast({ title: "Milestone created", tone: "success" });
    },
    onError: (e) =>
      pushToast({
        title: "Failed to create milestone",
        body: (e as Error)?.message,
        tone: "error",
      }),
  });

  if (msQuery.isLoading) return <PageSkeleton variant="list" />;
  if (msQuery.isError) {
    return (
      <EmptyState
        icon={Flag}
        message={
          (msQuery.error as Error)?.message ?? "Failed to load milestones."
        }
      />
    );
  }

  const milestones = msQuery.data?.milestones ?? [];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setDialogOpen(true)}>
          <Plus className="me-1.5 h-4 w-4" />
          New milestone
        </Button>
      </div>

      {milestones.length === 0 ? (
        <EmptyState icon={Flag} message="No milestones yet." />
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="text-start font-medium px-4 py-2">Name</th>
                  <th className="text-start font-medium px-4 py-2">Due</th>
                  <th className="text-start font-medium px-4 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {milestones.map((ms) => (
                  <tr key={ms.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-2 font-medium">{ms.name}</td>
                    <td className="px-4 py-2">
                      {ms.dueDate
                        ? new Date(ms.dueDate).toLocaleDateString()
                        : "—"}
                    </td>
                    <td className="px-4 py-2">
                      {ms.completed ? (
                        <span className="text-emerald-500 text-xs">
                          Completed
                        </span>
                      ) : (
                        <span className="text-amber-500 text-xs">Open</span>
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
            <DialogTitle>New milestone</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="ms-name">Name</Label>
              <Input
                id="ms-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ms-due">Due date</Label>
              <Input
                id="ms-due"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
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
              disabled={!name.trim() || createMutation.isPending}
            >
              {createMutation.isPending ? "Creating…" : "Create milestone"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------
function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "completed"
      ? "text-emerald-500"
      : status === "cancelled"
        ? "text-red-500"
        : status === "on_hold"
          ? "text-muted-foreground"
          : "text-amber-500";
  return (
    <span className={`text-xs capitalize ${tone}`}>
      {status.replace("_", " ")}
    </span>
  );
}
