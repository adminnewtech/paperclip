import { Navigate, Outlet, Route, Routes, useLocation, useParams } from "@/lib/router";
import { Button } from "@/components/ui/button";
import { Layout } from "./components/Layout";
import { OnboardingWizard } from "./components/OnboardingWizard";
import { CloudAccessGate } from "./components/CloudAccessGate";
import { OfflineIndicator } from "./components/OfflineIndicator";
import { PwaInstallBanner } from "./components/PwaInstallBanner";
import { Dashboard } from "./pages/Dashboard";
import { DashboardLive } from "./pages/DashboardLive";
import { Companies } from "./pages/Companies";
import { Agents } from "./pages/Agents";
import { AgentDetail } from "./pages/AgentDetail";
import { Projects } from "./pages/Projects";
import { ProjectDetail } from "./pages/ProjectDetail";
import { ProjectWorkspaceDetail } from "./pages/ProjectWorkspaceDetail";
import { Workspaces } from "./pages/Workspaces";
import { Issues } from "./pages/Issues";
import { Search } from "./pages/Search";
import { IssueDetail } from "./pages/IssueDetail";
import { IssueChatLongThreadPerf } from "./pages/IssueChatLongThreadPerf";
import { Routines } from "./pages/Routines";
import { RoutineDetail } from "./pages/RoutineDetail";
import { UserProfile } from "./pages/UserProfile";
import { ExecutionWorkspaceDetail } from "./pages/ExecutionWorkspaceDetail";
import { Goals } from "./pages/Goals";
import { GoalDetail } from "./pages/GoalDetail";
import { Business } from "./pages/Business";
import { BusinessSetup } from "./pages/BusinessSetup";
import { BusinessModuleView } from "./pages/BusinessModuleView";
import { BusinessDashboard } from "./pages/BusinessDashboard";
import { BusinessFinancePage } from "./pages/BusinessFinancePage";
import { BusinessAccountingPage } from "./pages/BusinessAccountingPage";
import { BusinessChartOfAccountsPage } from "./pages/BusinessChartOfAccountsPage";
import { BusinessJournalPage } from "./pages/BusinessJournalPage";
import { BusinessLedgerPage } from "./pages/BusinessLedgerPage";
import { BusinessFinancialStatementsPage } from "./pages/BusinessFinancialStatementsPage";
import { BusinessSalesPage } from "./pages/BusinessSalesPage";
import { BusinessAnalyticsPage } from "./pages/BusinessAnalyticsPage";
import { BusinessHRPage } from "./pages/BusinessHRPage";
import { BusinessInventoryPage } from "./pages/BusinessInventoryPage";
import { BusinessCRMPage } from "./pages/BusinessCRMPage";
import { BusinessHelpdeskPage } from "./pages/BusinessHelpdeskPage";
import { BusinessMarketingPage } from "./pages/BusinessMarketingPage";
import { BusinessMarketingFlowsPage } from "./pages/BusinessMarketingFlowsPage";
import { BusinessEcommercePage } from "./pages/BusinessEcommercePage";
import { BusinessBrainPage } from "./pages/BusinessBrainPage";
import { BusinessKnowledgePage } from "./pages/BusinessKnowledgePage";
import { BusinessAutomationsPage } from "./pages/BusinessAutomationsPage";
import { BusinessMessagingPage } from "./pages/BusinessMessagingPage";
import { BusinessPaymentsPage } from "./pages/BusinessPaymentsPage";
import { BusinessBankingPage } from "./pages/BusinessBankingPage";
import { BusinessAnalystPage } from "./pages/BusinessAnalystPage";
import { BusinessAiCofounderPage } from "./pages/BusinessAiCofounderPage";
import { BusinessHealthPage } from "./pages/BusinessHealthPage";
import { BusinessSimulationPage } from "./pages/BusinessSimulationPage";
import { BusinessAgentsHirePage } from "./pages/BusinessAgentsHirePage";
import { BusinessAgentDetailPage } from "./pages/BusinessAgentDetailPage";
import { BusinessAgentMemoryPage } from "./pages/BusinessAgentMemoryPage";
import { BusinessStorefrontBuilderPage } from "./pages/BusinessStorefrontBuilderPage";
import { BusinessImportPage } from "./pages/BusinessImportPage";
import { BusinessAuditLogPage } from "./pages/BusinessAuditLogPage";
import { BusinessRolesPermissionsPage } from "./pages/BusinessRolesPermissionsPage";
import { SalonDashboardPage } from "./pages/verticals/SalonDashboardPage";
import { SalonAppointmentsPage } from "./pages/verticals/SalonAppointmentsPage";
import { SalonServicesPage } from "./pages/verticals/SalonServicesPage";
import { SalonStaffPage } from "./pages/verticals/SalonStaffPage";
import { RestaurantDashboardPage } from "./pages/verticals/RestaurantDashboardPage";
import { RestaurantPosPage } from "./pages/verticals/RestaurantPosPage";
import { RestaurantMenuPage } from "./pages/verticals/RestaurantMenuPage";
import { RestaurantTablesPage } from "./pages/verticals/RestaurantTablesPage";
import { RestaurantKitchenPage } from "./pages/verticals/RestaurantKitchenPage";
import { ClinicDashboardPage } from "./pages/verticals/ClinicDashboardPage";
import { ClinicPatientsPage } from "./pages/verticals/ClinicPatientsPage";
import { ClinicPatientDetailPage } from "./pages/verticals/ClinicPatientDetailPage";
import { ClinicAppointmentsPage } from "./pages/verticals/ClinicAppointmentsPage";
import { ClinicVisitPage } from "./pages/verticals/ClinicVisitPage";
import { RetailDashboardPage } from "./pages/verticals/RetailDashboardPage";
import { RetailPosPage } from "./pages/verticals/RetailPosPage";
import { RetailInventoryPage } from "./pages/verticals/RetailInventoryPage";
import { RetailLoyaltyPage } from "./pages/verticals/RetailLoyaltyPage";
import { RetailEndOfDayPage } from "./pages/verticals/RetailEndOfDayPage";
import { Approvals } from "./pages/Approvals";
import { ApprovalDetail } from "./pages/ApprovalDetail";
import { Costs } from "./pages/Costs";
import { Activity } from "./pages/Activity";
import { Inbox } from "./pages/Inbox";
import { CompanySettings } from "./pages/CompanySettings";
import { CompanyEnvironments } from "./pages/CompanyEnvironments";
import { CompanyAccess } from "./pages/CompanyAccess";
import { CompanyInvites } from "./pages/CompanyInvites";
import { CompanySkills } from "./pages/CompanySkills";
import { Secrets } from "./pages/Secrets";
import { CompanyExport } from "./pages/CompanyExport";
import { CompanyImport } from "./pages/CompanyImport";
import { DesignGuide } from "./pages/DesignGuide";
import { InstanceGeneralSettings } from "./pages/InstanceGeneralSettings";
import { InstanceAccess } from "./pages/InstanceAccess";
import { InstanceSettings } from "./pages/InstanceSettings";
import { InstanceExperimentalSettings } from "./pages/InstanceExperimentalSettings";
import { ProfileSettings } from "./pages/ProfileSettings";
import { PluginManager } from "./pages/PluginManager";
import { PluginSettings } from "./pages/PluginSettings";
import { AdapterManager } from "./pages/AdapterManager";
import { PluginPage } from "./pages/PluginPage";
import { OrgChart } from "./pages/OrgChart";
import { NewAgent } from "./pages/NewAgent";
import { AuthPage } from "./pages/Auth";
import { BoardClaimPage } from "./pages/BoardClaim";
import { CliAuthPage } from "./pages/CliAuth";
import { InviteLandingPage } from "./pages/InviteLanding";
import { JoinRequestQueue } from "./pages/JoinRequestQueue";
import { NotFoundPage } from "./pages/NotFound";
import { StorefrontLayout } from "./pages/public/StorefrontLayout";
import { StorefrontHomePage } from "./pages/public/StorefrontHomePage";
import { StorefrontProductsPage } from "./pages/public/StorefrontProductsPage";
import { StorefrontProductDetailPage } from "./pages/public/StorefrontProductDetailPage";
import { StorefrontCartPage } from "./pages/public/StorefrontCartPage";
import { StorefrontCheckoutPage } from "./pages/public/StorefrontCheckoutPage";
import { StorefrontOrderPage } from "./pages/public/StorefrontOrderPage";
import { StorefrontAccountPage } from "./pages/public/StorefrontAccountPage";
import { useCompany } from "./context/CompanyContext";
import { useDialogActions } from "./context/DialogContext";
import { loadLastInboxTab } from "./lib/inbox";
import { shouldRedirectCompanylessRouteToOnboarding } from "./lib/onboarding-route";

function boardRoutes() {
  return (
    <>
      <Route index element={<Navigate to="dashboard" replace />} />
      <Route path="dashboard" element={<Dashboard />} />
      <Route path="dashboard/live" element={<DashboardLive />} />
      <Route path="onboarding" element={<OnboardingRoutePage />} />
      <Route path="companies" element={<Companies />} />
      <Route path="company/settings" element={<CompanySettings />} />
      <Route path="company/settings/environments" element={<CompanyEnvironments />} />
      <Route path="company/settings/access" element={<CompanyAccess />} />
      <Route path="company/settings/invites" element={<CompanyInvites />} />
      <Route path="company/export/*" element={<CompanyExport />} />
      <Route path="company/import" element={<CompanyImport />} />
      <Route path="company/settings/secrets" element={<Secrets />} />
      <Route path="skills/*" element={<CompanySkills />} />
      <Route path="settings" element={<LegacySettingsRedirect />} />
      <Route path="settings/*" element={<LegacySettingsRedirect />} />
      <Route path="plugins/:pluginId" element={<PluginPage />} />
      <Route path="org" element={<OrgChart />} />
      <Route path="agents" element={<Navigate to="/agents/all" replace />} />
      <Route path="agents/all" element={<Agents />} />
      <Route path="agents/active" element={<Agents />} />
      <Route path="agents/paused" element={<Agents />} />
      <Route path="agents/error" element={<Agents />} />
      <Route path="agents/new" element={<NewAgent />} />
      <Route path="agents/:agentId" element={<AgentDetail />} />
      <Route path="agents/:agentId/:tab" element={<AgentDetail />} />
      <Route path="agents/:agentId/runs/:runId" element={<AgentDetail />} />
      <Route path="projects" element={<Projects />} />
      <Route path="projects/:projectId" element={<ProjectDetail />} />
      <Route path="projects/:projectId/overview" element={<ProjectDetail />} />
      <Route path="projects/:projectId/issues" element={<ProjectDetail />} />
      <Route path="projects/:projectId/issues/:filter" element={<ProjectDetail />} />
      <Route path="projects/:projectId/workspaces/:workspaceId" element={<ProjectWorkspaceDetail />} />
      <Route path="projects/:projectId/workspaces" element={<ProjectDetail />} />
      <Route path="projects/:projectId/configuration" element={<ProjectDetail />} />
      <Route path="projects/:projectId/budget" element={<ProjectDetail />} />
      <Route path="workspaces" element={<Workspaces />} />
      <Route path="issues" element={<Issues />} />
      <Route path="search" element={<Search />} />
      <Route path="issues/all" element={<Navigate to="/issues" replace />} />
      <Route path="issues/active" element={<Navigate to="/issues" replace />} />
      <Route path="issues/backlog" element={<Navigate to="/issues" replace />} />
      <Route path="issues/done" element={<Navigate to="/issues" replace />} />
      <Route path="issues/recent" element={<Navigate to="/issues" replace />} />
      <Route path="issues/:issueId" element={<IssueDetail />} />
      {import.meta.env.DEV ? (
        <Route path="tests/perf/long-thread" element={<IssueChatLongThreadPerf />} />
      ) : null}
      <Route path="routines" element={<Routines />} />
      <Route path="routines/:routineId" element={<RoutineDetail />} />
      <Route path="execution-workspaces/:workspaceId" element={<ExecutionWorkspaceDetail />} />
      <Route path="execution-workspaces/:workspaceId/services" element={<ExecutionWorkspaceDetail />} />
      <Route path="execution-workspaces/:workspaceId/configuration" element={<ExecutionWorkspaceDetail />} />
      <Route path="execution-workspaces/:workspaceId/runtime-logs" element={<ExecutionWorkspaceDetail />} />
      <Route path="execution-workspaces/:workspaceId/issues" element={<ExecutionWorkspaceDetail />} />
      <Route path="execution-workspaces/:workspaceId/routines" element={<ExecutionWorkspaceDetail />} />
      <Route path="goals" element={<Goals />} />
      <Route path="goals/:goalId" element={<GoalDetail />} />
      <Route path="business" element={<Business />} />
      <Route path="business/setup" element={<BusinessSetup />} />
      <Route path="business/dashboard" element={<BusinessDashboard />} />
      <Route path="business/analytics" element={<BusinessAnalyticsPage />} />
      <Route path="business/finance" element={<BusinessFinancePage />} />
      <Route path="business/finance/:tab" element={<BusinessFinancePage />} />
      <Route path="business/accounting" element={<BusinessAccountingPage />} />
      <Route path="business/accounting/coa" element={<BusinessChartOfAccountsPage />} />
      <Route path="business/accounting/journal" element={<BusinessJournalPage />} />
      <Route path="business/accounting/ledger" element={<BusinessLedgerPage />} />
      <Route path="business/accounting/statements" element={<BusinessFinancialStatementsPage />} />
      <Route path="business/sales" element={<BusinessSalesPage />} />
      <Route path="business/sales/:tab" element={<BusinessSalesPage />} />
      <Route path="business/hr" element={<BusinessHRPage />} />
      <Route path="business/hr/:tab" element={<BusinessHRPage />} />
      <Route path="business/inventory" element={<BusinessInventoryPage />} />
      <Route path="business/inventory/:tab" element={<BusinessInventoryPage />} />
      <Route path="business/crm" element={<BusinessCRMPage />} />
      <Route path="business/crm/:tab" element={<BusinessCRMPage />} />
      <Route path="business/helpdesk" element={<BusinessHelpdeskPage />} />
      <Route path="business/helpdesk/:tab" element={<BusinessHelpdeskPage />} />
      <Route path="business/marketing" element={<BusinessMarketingPage />} />
      <Route path="business/marketing/flows" element={<BusinessMarketingFlowsPage />} />
      <Route path="business/marketing/:tab" element={<BusinessMarketingPage />} />
      <Route path="business/ecommerce" element={<BusinessEcommercePage />} />
      <Route path="business/ecommerce/:tab" element={<BusinessEcommercePage />} />
      <Route path="business/storefront-builder" element={<BusinessStorefrontBuilderPage />} />
      <Route path="business/import" element={<BusinessImportPage />} />
      <Route path="business/brain" element={<BusinessBrainPage />} />
      <Route path="business/knowledge" element={<BusinessKnowledgePage />} />
      <Route path="business/automations" element={<BusinessAutomationsPage />} />
      <Route path="business/analyst" element={<BusinessAnalystPage />} />
      <Route path="business/cofounder" element={<BusinessAiCofounderPage />} />
      <Route path="business/health" element={<BusinessHealthPage />} />
      <Route path="business/simulation" element={<BusinessSimulationPage />} />
      <Route path="business/agents/hire" element={<BusinessAgentsHirePage />} />
      <Route path="business/agents/:agentSlug" element={<BusinessAgentDetailPage />} />
      <Route path="business/agents/:agentSlug/memory" element={<BusinessAgentMemoryPage />} />
      <Route path="business/messaging" element={<BusinessMessagingPage />} />
      <Route path="business/payments" element={<BusinessPaymentsPage />} />
      <Route path="business/banking" element={<BusinessBankingPage />} />
      <Route path="business/audit" element={<BusinessAuditLogPage />} />
      <Route path="business/roles" element={<BusinessRolesPermissionsPage />} />
      <Route path="business/salon" element={<SalonDashboardPage />} />
      <Route path="business/salon/appointments" element={<SalonAppointmentsPage />} />
      <Route path="business/salon/services" element={<SalonServicesPage />} />
      <Route path="business/salon/staff" element={<SalonStaffPage />} />
      <Route path="business/restaurant" element={<RestaurantDashboardPage />} />
      <Route path="business/restaurant/pos" element={<RestaurantPosPage />} />
      <Route path="business/restaurant/menu" element={<RestaurantMenuPage />} />
      <Route path="business/restaurant/tables" element={<RestaurantTablesPage />} />
      <Route path="business/restaurant/kitchen" element={<RestaurantKitchenPage />} />
      <Route path="business/clinic" element={<ClinicDashboardPage />} />
      <Route path="business/clinic/patients" element={<ClinicPatientsPage />} />
      <Route path="business/clinic/patients/:id" element={<ClinicPatientDetailPage />} />
      <Route path="business/clinic/appointments" element={<ClinicAppointmentsPage />} />
      <Route path="business/clinic/visits/:id" element={<ClinicVisitPage />} />
      <Route path="business/:moduleKey" element={<BusinessModuleView />} />
      <Route path="approvals" element={<Navigate to="/approvals/pending" replace />} />
      <Route path="approvals/pending" element={<Approvals />} />
      <Route path="approvals/all" element={<Approvals />} />
      <Route path="approvals/:approvalId" element={<ApprovalDetail />} />
      <Route path="costs" element={<Costs />} />
      <Route path="activity" element={<Activity />} />
      <Route path="inbox" element={<InboxRootRedirect />} />
      <Route path="inbox/mine" element={<Inbox />} />
      <Route path="inbox/recent" element={<Inbox />} />
      <Route path="inbox/unread" element={<Inbox />} />
      <Route path="inbox/all" element={<Inbox />} />
      <Route path="inbox/requests" element={<JoinRequestQueue />} />
      <Route path="inbox/new" element={<Navigate to="/inbox/mine" replace />} />
      <Route path="u/:userSlug" element={<UserProfile />} />
      <Route path="design-guide" element={<DesignGuide />} />
      <Route path="instance/settings/adapters" element={<AdapterManager />} />
      <Route path=":pluginRoutePath/*" element={<PluginPage />} />
      <Route path="*" element={<NotFoundPage scope="board" />} />
    </>
  );
}

function InboxRootRedirect() {
  return <Navigate to={`/inbox/${loadLastInboxTab()}`} replace />;
}

function LegacySettingsRedirect() {
  const location = useLocation();
  return <Navigate to={`/instance/settings/general${location.search}${location.hash}`} replace />;
}

function OnboardingRoutePage() {
  const { companies } = useCompany();
  const { openOnboarding } = useDialogActions();
  const { companyPrefix } = useParams<{ companyPrefix?: string }>();
  const matchedCompany = companyPrefix
    ? companies.find((company) => company.issuePrefix.toUpperCase() === companyPrefix.toUpperCase()) ?? null
    : null;

  const title = matchedCompany
    ? `Add another agent to ${matchedCompany.name}`
    : companies.length > 0
      ? "Create another company"
      : "Create your first company";
  const description = matchedCompany
    ? "Run onboarding again to add an agent and a starter task for this company."
    : companies.length > 0
      ? "Run onboarding again to create another company and seed its first agent."
      : "Get started by creating a company and your first agent.";

  return (
    <div className="mx-auto max-w-xl py-10">
      <div className="rounded-lg border border-border bg-card p-6">
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{description}</p>
        <div className="mt-4">
          <Button
            onClick={() =>
              matchedCompany
                ? openOnboarding({ initialStep: 2, companyId: matchedCompany.id })
                : openOnboarding()
            }
          >
            {matchedCompany ? "Add Agent" : "Start Onboarding"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function CompanyRootRedirect() {
  const { companies, selectedCompany, loading } = useCompany();
  const location = useLocation();

  if (loading) {
    return <div className="mx-auto max-w-xl py-10 text-sm text-muted-foreground">Loading...</div>;
  }

  const targetCompany = selectedCompany ?? companies[0] ?? null;
  if (!targetCompany) {
    if (
      shouldRedirectCompanylessRouteToOnboarding({
        pathname: location.pathname,
        hasCompanies: false,
      })
    ) {
      return <Navigate to="/onboarding" replace />;
    }
    return <NoCompaniesStartPage />;
  }

  return <Navigate to={`/${targetCompany.issuePrefix}/dashboard`} replace />;
}

function UnprefixedBoardRedirect() {
  const location = useLocation();
  const { companies, selectedCompany, loading } = useCompany();

  if (loading) {
    return <div className="mx-auto max-w-xl py-10 text-sm text-muted-foreground">Loading...</div>;
  }

  const targetCompany = selectedCompany ?? companies[0] ?? null;
  if (!targetCompany) {
    if (
      shouldRedirectCompanylessRouteToOnboarding({
        pathname: location.pathname,
        hasCompanies: false,
      })
    ) {
      return <Navigate to="/onboarding" replace />;
    }
    return <NoCompaniesStartPage />;
  }

  return (
    <Navigate
      to={`/${targetCompany.issuePrefix}${location.pathname}${location.search}${location.hash}`}
      replace
    />
  );
}

function NoCompaniesStartPage() {
  const { openOnboarding } = useDialogActions();

  return (
    <div className="mx-auto max-w-xl py-10">
      <div className="rounded-lg border border-border bg-card p-6">
        <h1 className="text-xl font-semibold">Create your first company</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Get started by creating a company.
        </p>
        <div className="mt-4">
          <Button onClick={() => openOnboarding()}>New Company</Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Wraps the CloudAccessGate so that authenticated/auth-gated routes also get
 * the PWA offline indicator + install prompt without leaking those into the
 * public auth/storefront/invite routes.
 */
function AuthGatedShell() {
  return (
    <>
      <OfflineIndicator />
      <PwaInstallBanner />
      <CloudAccessGate />
    </>
  );
}

export function App() {
  return (
    <>
      <Routes>
        <Route path="auth" element={<AuthPage />} />
        <Route path="board-claim/:token" element={<BoardClaimPage />} />
        <Route path="cli-auth/:id" element={<CliAuthPage />} />
        <Route path="invite/:token" element={<InviteLandingPage />} />
        <Route path="tests/perf/long-thread" element={<IssueChatLongThreadPerf />} />

        {/*
         * Public-facing storefront routes. These are mounted OUTSIDE the
         * CloudAccessGate auth wall so anonymous customers can browse, buy,
         * and track their orders without needing a Paperclip account. Each
         * storefront is scoped by its public slug.
         */}
        <Route path="shop/:storefrontSlug" element={<StorefrontLayout />}>
          <Route index element={<StorefrontHomePage />} />
          <Route path="products" element={<StorefrontProductsPage />} />
          <Route path="product/:productSlug" element={<StorefrontProductDetailPage />} />
          <Route path="cart" element={<StorefrontCartPage />} />
          <Route path="checkout" element={<StorefrontCheckoutPage />} />
          <Route path="order/:orderId" element={<StorefrontOrderPage />} />
          <Route path="account" element={<StorefrontAccountPage />} />
        </Route>

        <Route element={<AuthGatedShell />}>
          <Route index element={<CompanyRootRedirect />} />
          <Route path="onboarding" element={<OnboardingRoutePage />} />
          <Route path="instance" element={<Navigate to="/instance/settings/general" replace />} />
          <Route path="instance/settings" element={<Layout />}>
            <Route index element={<Navigate to="general" replace />} />
            <Route path="profile" element={<ProfileSettings />} />
            <Route path="general" element={<InstanceGeneralSettings />} />
            <Route path="access" element={<InstanceAccess />} />
            <Route path="heartbeats" element={<InstanceSettings />} />
            <Route path="experimental" element={<InstanceExperimentalSettings />} />
            <Route path="plugins" element={<PluginManager />} />
            <Route path="plugins/:pluginId" element={<PluginSettings />} />
            <Route path="adapters" element={<AdapterManager />} />
          </Route>
          <Route path="companies" element={<UnprefixedBoardRedirect />} />
          <Route path="issues" element={<UnprefixedBoardRedirect />} />
          <Route path="issues/:issueId" element={<UnprefixedBoardRedirect />} />
          <Route path="routines" element={<UnprefixedBoardRedirect />} />
          <Route path="routines/:routineId" element={<UnprefixedBoardRedirect />} />
          <Route path="u/:userSlug" element={<UnprefixedBoardRedirect />} />
          <Route path="skills/*" element={<UnprefixedBoardRedirect />} />
          <Route path="settings" element={<LegacySettingsRedirect />} />
          <Route path="settings/*" element={<LegacySettingsRedirect />} />
          <Route path="agents" element={<UnprefixedBoardRedirect />} />
          <Route path="agents/new" element={<UnprefixedBoardRedirect />} />
          <Route path="agents/:agentId" element={<UnprefixedBoardRedirect />} />
          <Route path="agents/:agentId/:tab" element={<UnprefixedBoardRedirect />} />
          <Route path="agents/:agentId/runs/:runId" element={<UnprefixedBoardRedirect />} />
          <Route path="projects" element={<UnprefixedBoardRedirect />} />
          <Route path="projects/:projectId" element={<UnprefixedBoardRedirect />} />
          <Route path="projects/:projectId/overview" element={<UnprefixedBoardRedirect />} />
          <Route path="projects/:projectId/issues" element={<UnprefixedBoardRedirect />} />
          <Route path="projects/:projectId/issues/:filter" element={<UnprefixedBoardRedirect />} />
          <Route path="projects/:projectId/workspaces" element={<UnprefixedBoardRedirect />} />
          <Route path="projects/:projectId/workspaces/:workspaceId" element={<UnprefixedBoardRedirect />} />
          <Route path="projects/:projectId/configuration" element={<UnprefixedBoardRedirect />} />
          <Route path="workspaces" element={<UnprefixedBoardRedirect />} />
          <Route path="business" element={<UnprefixedBoardRedirect />} />
          <Route path="business/setup" element={<UnprefixedBoardRedirect />} />
          <Route path="business/dashboard" element={<UnprefixedBoardRedirect />} />
          <Route path="business/analytics" element={<UnprefixedBoardRedirect />} />
          <Route path="business/finance" element={<UnprefixedBoardRedirect />} />
          <Route path="business/finance/:tab" element={<UnprefixedBoardRedirect />} />
          <Route path="business/accounting" element={<UnprefixedBoardRedirect />} />
          <Route path="business/accounting/coa" element={<UnprefixedBoardRedirect />} />
          <Route path="business/accounting/journal" element={<UnprefixedBoardRedirect />} />
          <Route path="business/accounting/ledger" element={<UnprefixedBoardRedirect />} />
          <Route path="business/accounting/statements" element={<UnprefixedBoardRedirect />} />
          <Route path="business/sales" element={<UnprefixedBoardRedirect />} />
          <Route path="business/sales/:tab" element={<UnprefixedBoardRedirect />} />
          <Route path="business/hr" element={<UnprefixedBoardRedirect />} />
          <Route path="business/hr/:tab" element={<UnprefixedBoardRedirect />} />
          <Route path="business/inventory" element={<UnprefixedBoardRedirect />} />
          <Route path="business/inventory/:tab" element={<UnprefixedBoardRedirect />} />
          <Route path="business/crm" element={<UnprefixedBoardRedirect />} />
          <Route path="business/crm/:tab" element={<UnprefixedBoardRedirect />} />
          <Route path="business/helpdesk" element={<UnprefixedBoardRedirect />} />
          <Route path="business/helpdesk/:tab" element={<UnprefixedBoardRedirect />} />
          <Route path="business/marketing" element={<UnprefixedBoardRedirect />} />
          <Route path="business/marketing/:tab" element={<UnprefixedBoardRedirect />} />
          <Route path="business/ecommerce" element={<UnprefixedBoardRedirect />} />
          <Route path="business/ecommerce/:tab" element={<UnprefixedBoardRedirect />} />
          <Route path="business/import" element={<UnprefixedBoardRedirect />} />
          <Route path="business/brain" element={<UnprefixedBoardRedirect />} />
          <Route path="business/automations" element={<UnprefixedBoardRedirect />} />
          <Route path="business/messaging" element={<UnprefixedBoardRedirect />} />
          <Route path="business/payments" element={<UnprefixedBoardRedirect />} />
          <Route path="business/audit" element={<UnprefixedBoardRedirect />} />
          <Route path="business/roles" element={<UnprefixedBoardRedirect />} />
          <Route path="business/:moduleKey" element={<UnprefixedBoardRedirect />} />
          <Route path="business/:moduleKey/:tab" element={<UnprefixedBoardRedirect />} />
          <Route path="execution-workspaces/:workspaceId" element={<UnprefixedBoardRedirect />} />
          <Route path="execution-workspaces/:workspaceId/services" element={<UnprefixedBoardRedirect />} />
          <Route path="execution-workspaces/:workspaceId/configuration" element={<UnprefixedBoardRedirect />} />
          <Route path="execution-workspaces/:workspaceId/runtime-logs" element={<UnprefixedBoardRedirect />} />
          <Route path="execution-workspaces/:workspaceId/issues" element={<UnprefixedBoardRedirect />} />
          <Route path="execution-workspaces/:workspaceId/routines" element={<UnprefixedBoardRedirect />} />
          <Route path=":companyPrefix" element={<Layout />}>
            {boardRoutes()}
          </Route>
          <Route path="*" element={<NotFoundPage scope="global" />} />
        </Route>
      </Routes>
      <OnboardingWizard />
    </>
  );
}
