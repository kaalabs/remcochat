"use client";

import { useAdminClientIntegrations } from "@/app/admin/admin-client-integrations";
import { useAdminClientMaintenance } from "@/app/admin/admin-client-maintenance";
import { useAdminClientModelInventory } from "@/app/admin/admin-client-model-inventory";
import { useAdminClientProviders } from "@/app/admin/admin-client-providers";
import {
  useAdminClientReadiness,
} from "@/app/admin/admin-client-readiness";
import { useAdminClientSkills } from "@/app/admin/admin-client-skills";

type AdminClientFeedbackState = {
  clearError: () => void;
  clearSaveNotice: () => void;
  showError: (nextError: string) => void;
  showSaveNotice: (notice: string) => void;
};

type BuildAdminHeaders = () => Record<string, string>;

type UseAdminClientControllersInput = {
  buildAdminHeaders: BuildAdminHeaders;
  feedback: AdminClientFeedbackState;
};

type SaveActiveProviderFn = (input: {
  afterSave: () => Promise<void>;
}) => Promise<void> | void;

type ReadinessInput = Parameters<typeof useAdminClientReadiness>[0];

type CreateAdminClientReadinessInput = {
  buildAdminHeaders: BuildAdminHeaders;
  integrations: Pick<
    ReturnType<typeof useAdminClientIntegrations>,
    "webSearchConfig"
  >;
  modelInventory: Pick<
    ReturnType<typeof useAdminClientModelInventory>,
    "refreshInventory"
  >;
  providers: Pick<
    ReturnType<typeof useAdminClientProviders>,
    "providerSwitcher"
  >;
  skills: Pick<
    ReturnType<typeof useAdminClientSkills>,
    "refreshSkills" | "skills"
  >;
};

export function createAdminClientReadinessInput({
  buildAdminHeaders,
  integrations,
  modelInventory,
  providers,
  skills,
}: CreateAdminClientReadinessInput): ReadinessInput {
  return {
    buildAdminHeaders,
    providerSwitcher: providers.providerSwitcher,
    refreshInventory: modelInventory.refreshInventory,
    refreshSkills: skills.refreshSkills,
    skills: skills.skills,
    webSearchConfig: integrations.webSearchConfig,
  };
}

export function createAdminClientSaveActiveProviderAction(input: {
  refreshInventory: () => Promise<unknown>;
  resetLlmAutoStart: () => void;
  saveActiveProvider: SaveActiveProviderFn;
}) {
  return () =>
    input.saveActiveProvider({
      afterSave: async () => {
        input.resetLlmAutoStart();
        await input.refreshInventory().catch(() => null);
      },
    });
}

export function useAdminClientControllers({
  buildAdminHeaders,
  feedback,
}: UseAdminClientControllersInput) {
  const modelInventory = useAdminClientModelInventory({
    clearSaveNotice: feedback.clearSaveNotice,
    showSaveNotice: feedback.showSaveNotice,
  });

  const providers = useAdminClientProviders({
    clearError: feedback.clearError,
    clearSaveNotice: feedback.clearSaveNotice,
    showError: feedback.showError,
    showSaveNotice: feedback.showSaveNotice,
  });

  const skills = useAdminClientSkills({
    buildAdminHeaders,
  });

  const integrations = useAdminClientIntegrations({
    clearSaveNotice: feedback.clearSaveNotice,
    showSaveNotice: feedback.showSaveNotice,
  });

  const maintenance = useAdminClientMaintenance({
    clearError: feedback.clearError,
    clearSaveNotice: feedback.clearSaveNotice,
    showError: feedback.showError,
    showSaveNotice: feedback.showSaveNotice,
  });

  const readiness = useAdminClientReadiness(
    createAdminClientReadinessInput({
      buildAdminHeaders,
      integrations,
      modelInventory,
      providers,
      skills,
    })
  );

  const onSaveActiveProvider = createAdminClientSaveActiveProviderAction({
    refreshInventory: modelInventory.refreshInventory,
    resetLlmAutoStart: readiness.resetLlmAutoStart,
    saveActiveProvider: providers.saveActiveProvider,
  });

  return {
    integrations,
    maintenance,
    modelInventory,
    onSaveActiveProvider,
    providers,
    readiness,
    skills,
  };
}
