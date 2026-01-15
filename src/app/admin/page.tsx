import { AdminClient } from "@/app/admin/admin-client";
import { isAdminEnabled } from "@/server/admin";
import { getConfig } from "@/server/config";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default function AdminPage() {
  getConfig();

  if (!isAdminEnabled()) {
    notFound();
  }

  return <AdminClient />;
}

