"use client";

import type { ComponentProps } from "react";

import type {
  ModelsInventoryResponse,
} from "@/app/admin/admin-client-api";
import {
  AdminLocalAccessCard,
  AdminWebSearchCard,
} from "@/app/admin/admin-client-integrations-cards";
import {
  AdminBackupCard,
  AdminDangerResetCard,
} from "@/app/admin/admin-client-maintenance-cards";
import {
  AdminAllowedModelsCard,
  AdminRouterCard,
} from "@/app/admin/admin-client-models-cards";
import { AdminProvidersCard } from "@/app/admin/admin-client-providers-card";
import { AdminSkillsCard } from "@/app/admin/admin-client-skills-card";

export type AdminBackupSectionProps = ComponentProps<typeof AdminBackupCard>;
export type AdminWebSearchSectionProps = ComponentProps<typeof AdminWebSearchCard>;
export type AdminProvidersSectionProps = ComponentProps<typeof AdminProvidersCard>;
export type AdminLocalAccessSectionProps = ComponentProps<typeof AdminLocalAccessCard>;
export type AdminRouterSectionProps = ComponentProps<typeof AdminRouterCard>;
export type AdminAllowedModelsSectionProps = ComponentProps<typeof AdminAllowedModelsCard>;
export type AdminSkillsSectionProps = ComponentProps<typeof AdminSkillsCard>;
export type AdminMaintenanceSectionProps = ComponentProps<typeof AdminDangerResetCard>;

export type AdminClientCardsGridProps = {
  allowedModels: AdminAllowedModelsSectionProps;
  backup: AdminBackupSectionProps;
  localAccess: AdminLocalAccessSectionProps;
  maintenance: AdminMaintenanceSectionProps;
  providers: AdminProvidersSectionProps;
  router: AdminRouterSectionProps | null;
  skills: AdminSkillsSectionProps;
  webSearch: AdminWebSearchSectionProps;
};

export function hasAdminRouterConfig(
  inventory: ModelsInventoryResponse | null
): inventory is ModelsInventoryResponse & {
  router: NonNullable<ModelsInventoryResponse["router"]>;
} {
  return Boolean(inventory?.router);
}

export function resolveAdminClientRouterSectionProps(
  input: Omit<AdminRouterSectionProps, "inventory"> & {
    inventory: ModelsInventoryResponse | null;
  }
): AdminRouterSectionProps | null {
  if (!hasAdminRouterConfig(input.inventory)) return null;
  return { ...input, inventory: input.inventory };
}

export function AdminClientCardsGrid({
  allowedModels,
  backup,
  localAccess,
  maintenance,
  providers,
  router,
  skills,
  webSearch,
}: AdminClientCardsGridProps) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <div className="mx-auto grid w-full max-w-7xl grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <AdminBackupCard {...backup} />
        <AdminWebSearchCard {...webSearch} />
        <AdminProvidersCard {...providers} />
        <AdminLocalAccessCard {...localAccess} />
        {router ? <AdminRouterCard {...router} /> : null}
        <AdminAllowedModelsCard {...allowedModels} />
        <AdminSkillsCard {...skills} />
        <AdminDangerResetCard {...maintenance} />
      </div>
    </div>
  );
}
