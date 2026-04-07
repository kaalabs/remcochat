"use client";

import {
  AdminClientCardsGrid,
} from "@/app/admin/admin-client-cards";
import {
  AdminClientHeader,
} from "@/app/admin/admin-client-header";
import {
  useAdminClientPageState,
} from "@/app/admin/admin-client-page-state";

export function AdminClient() {
  const { cardsProps, headerProps } = useAdminClientPageState();

  return (
    <div className="h-dvh w-full overflow-hidden bg-background text-foreground">
      <div className="flex h-full min-h-0 flex-col">
        <AdminClientHeader {...headerProps} />
        <AdminClientCardsGrid {...cardsProps} />
      </div>
    </div>
  );
}
