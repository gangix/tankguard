import DashboardClient from "@/components/dashboard/dashboard-client";
import { getDashboardSnapshot } from "@/lib/dashboard/queries";

export const dynamic = "force-dynamic";

export default function Home() {
  return <DashboardClient snapshot={getDashboardSnapshot()} />;
}
