import { Dashboard } from '@/components/Dashboard';
import { loadDashboardData } from '@/lib/registry';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const dashboardData = await loadDashboardData();

  return <Dashboard data={dashboardData} />;
}
