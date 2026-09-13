import { Dashboard } from "@/components/demo/Dashboard";
import { DemoProvider } from "@/lib/demo/state";
import { getAllForecasts } from "@/lib/server/demo-data";

export const metadata = {
  title: "Agentic EMS — Portfolio demo-001",
};

/**
 * The forecast snapshots are read on the server (cached, one pass for all
 * protocols) and passed into the dashboard, so the page arrives with its data
 * already in the HTML instead of fetching it after hydration.
 */
export const revalidate = 3600;

export default async function DashboardPage() {
  const payloads = await getAllForecasts();

  return (
    <DemoProvider>
      <Dashboard payloads={payloads} />
    </DemoProvider>
  );
}
