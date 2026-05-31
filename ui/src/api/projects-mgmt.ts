import { api } from "./client";

export interface ProjectRow {
  id: string;
  companyId: string;
  name: string;
  description: string | null;
  status: string;
  customerName: string | null;
  budgetMinor: number;
  currency: string;
  startDate: string | null;
  dueDate: string | null;
  ownerUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskRow {
  id: string;
  companyId: string;
  projectId: string | null;
  title: string | null;
  description: string | null;
  status: string;
  priority: string;
  assigneeUserId: string | null;
  dependsOnId: string | null;
  estimateHours: number;
  dueAt: string | null;
  sort: number;
  createdAt: string;
  updatedAt: string;
}

export interface TimesheetRow {
  id: string;
  companyId: string;
  projectId: string | null;
  taskId: string | null;
  employeeId: string | null;
  date: string | null;
  hours: number;
  billable: boolean;
  rateMinor: number;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MilestoneRow {
  id: string;
  companyId: string;
  projectId: string | null;
  name: string;
  dueDate: string | null;
  completed: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectCreateInput {
  name: string;
  description?: string | null;
  status?: string;
  customerName?: string | null;
  budgetMinor?: number;
  currency?: string;
  startDate?: string | null;
  dueDate?: string | null;
  ownerUserId?: string | null;
}

export interface TaskCreateInput {
  projectId?: string | null;
  title: string;
  description?: string | null;
  status?: string;
  priority?: string;
  assigneeUserId?: string | null;
  dependsOnId?: string | null;
  estimateHours?: number;
  dueAt?: string | null;
  sort?: number;
}

export interface TimesheetCreateInput {
  projectId?: string | null;
  taskId?: string | null;
  employeeId?: string | null;
  date?: string | null;
  hours?: number;
  billable?: boolean;
  rateMinor?: number;
  note?: string | null;
}

export interface MilestoneCreateInput {
  projectId?: string | null;
  name: string;
  dueDate?: string | null;
  completed?: boolean;
}

const BASE = (companyId: string) => `/companies/${companyId}/projects-mgmt`;

export const projectsMgmtApi = {
  // Projects
  listProjects: (companyId: string) =>
    api.get<{ projects: ProjectRow[] }>(BASE(companyId)),
  createProject: (companyId: string, body: ProjectCreateInput) =>
    api.post<ProjectRow>(BASE(companyId), body),

  // Tasks
  listTasks: (companyId: string, projectId?: string) => {
    const qs = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
    return api.get<{ tasks: TaskRow[] }>(`${BASE(companyId)}/tasks${qs}`);
  },
  createTask: (companyId: string, body: TaskCreateInput) =>
    api.post<TaskRow>(`${BASE(companyId)}/tasks`, body),
  completeTask: (companyId: string, id: string) =>
    api.post<TaskRow>(`${BASE(companyId)}/tasks/${id}/complete`, {}),

  // Timesheets
  listTimesheets: (companyId: string, projectId?: string) => {
    const qs = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
    return api.get<{ timesheets: TimesheetRow[] }>(
      `${BASE(companyId)}/timesheets${qs}`,
    );
  },
  createTimesheet: (companyId: string, body: TimesheetCreateInput) =>
    api.post<TimesheetRow>(`${BASE(companyId)}/timesheets`, body),

  // Milestones
  listMilestones: (companyId: string, projectId?: string) => {
    const qs = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
    return api.get<{ milestones: MilestoneRow[] }>(
      `${BASE(companyId)}/milestones${qs}`,
    );
  },
  createMilestone: (companyId: string, body: MilestoneCreateInput) =>
    api.post<MilestoneRow>(`${BASE(companyId)}/milestones`, body),
};
