"use client";

import {
  type AdminClientCardsGridProps,
} from "@/app/admin/admin-client-cards";
import {
  useAdminClientControllers,
} from "@/app/admin/admin-client-controllers";
import { useAdminClientFeedbackState } from "@/app/admin/admin-client-feedback";
import type { AdminClientHeaderProps } from "@/app/admin/admin-client-header";
import {
  createAdminClientPageProps,
} from "@/app/admin/admin-client-page-composition";
import {
  buildLanAdminAuthHeaders,
  readLanAdminTokenFromWindow,
} from "@/app/lan-admin-token-storage";
import { useI18n } from "@/components/i18n-provider";

export function buildAdminClientHeaders(): Record<string, string> {
  return buildLanAdminAuthHeaders(readLanAdminTokenFromWindow());
}

export function useAdminClientPageState(): {
  cardsProps: AdminClientCardsGridProps;
  headerProps: AdminClientHeaderProps;
} {
  const { locale, t } = useI18n();
  const feedback = useAdminClientFeedbackState();
  const controllers = useAdminClientControllers({
    buildAdminHeaders: buildAdminClientHeaders,
    feedback,
  });

  return createAdminClientPageProps({
    controllers,
    feedback,
    locale,
    t,
  });
}
