import { CrmDashboard } from '@/components/crm/crm-dashboard';

// The CRM component handles session and workspace loading. Keep the route
// mounted while Better Auth changes activeOrganizationId. Do not redirect
// to onboarding on a transient empty active organization.
export default function DashboardPage() {
  return <CrmDashboard />;
}
