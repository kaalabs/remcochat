"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

import type { I18nContextValue } from "@/components/i18n-provider";
import type { AccessibleChat } from "@/domain/chats/types";
import type { Profile } from "@/domain/profiles/types";
import {
  compareChatsForSidebar,
} from "@/app/home-client-chat-actions";
import type { ModelOption } from "@/lib/models";
import {
  parseErrorMessage,
  parseProvidersResponse,
  type ProvidersResponse,
} from "@/lib/providers-response";
import {
  allowedReasoningEfforts,
  normalizeReasoningEffort,
  type ReasoningEffortChoice,
} from "@/lib/reasoning-effort";

type UseHomeClientModelSelectionInput = {
  activeChat: AccessibleChat | null;
  activeProfile: Profile | null;
  isTemporaryChat: boolean;
  setChats: Dispatch<SetStateAction<AccessibleChat[]>>;
  setTemporaryModelId: Dispatch<SetStateAction<string>>;
  t: I18nContextValue["t"];
  temporaryModelId: string;
};

type ProviderFetchState = {
  providersConfig: ProvidersResponse | null;
  providersLoadError: string | null;
};

export function buildLastUsedModelKey(profileId: string): string {
  return `remcochat:lastModelId:${profileId}`;
}

export function resolveActiveProvider(
  providersConfig: ProvidersResponse | null
): ProvidersResponse["providers"][number] | null {
  const providers = providersConfig?.providers;
  if (!providers || providers.length === 0) return null;

  return (
    providers.find((provider) => provider.id === providersConfig.activeProviderId) ??
    providers.find((provider) => provider.id === providersConfig.defaultProviderId) ??
    providers[0] ??
    null
  );
}

export function resolveProfileDefaultModelId(input: {
  activeProfileDefaultModelId: string;
  isAllowedModel: (modelId: unknown) => modelId is string;
  providerDefaultModelId: string;
}): string {
  return input.isAllowedModel(input.activeProfileDefaultModelId)
    ? input.activeProfileDefaultModelId
    : input.providerDefaultModelId || input.activeProfileDefaultModelId;
}

export function resolveEffectiveModelId(input: {
  activeChatModelId: string;
  isAllowedModel: (modelId: unknown) => modelId is string;
  isTemporaryChat: boolean;
  profileDefaultModelId: string;
  temporaryModelId: string;
}): string {
  const chatModelId = input.isAllowedModel(input.activeChatModelId)
    ? input.activeChatModelId
    : input.profileDefaultModelId;

  if (!input.isTemporaryChat) return chatModelId;

  return input.isAllowedModel(input.temporaryModelId)
    ? input.temporaryModelId
    : input.profileDefaultModelId;
}

export function resolvePreferredNewChatModelId(input: {
  activeProfileId: string;
  effectiveModelId: string;
  isAllowedModel: (modelId: unknown) => modelId is string;
  profileDefaultModelId: string;
  profileId: string;
  storedModelId: string;
}): string {
  if (!input.profileId) return "";
  if (input.isAllowedModel(input.storedModelId)) return input.storedModelId;
  if (
    input.activeProfileId === input.profileId &&
    input.isAllowedModel(input.effectiveModelId)
  ) {
    return input.effectiveModelId;
  }
  return input.profileDefaultModelId;
}

function useProviderFetchState(
  t: I18nContextValue["t"]
): ProviderFetchState {
  const [providersConfig, setProvidersConfig] =
    useState<ProvidersResponse | null>(null);
  const [providersLoadError, setProvidersLoadError] = useState<string | null>(null);

  useEffect(() => {
    let canceled = false;

    fetch("/api/providers")
      .then(async (response) => {
        const data = (await response.json().catch(() => null)) as unknown;
        if (canceled) return;

        const parsed = parseProvidersResponse(data);
        if (!response.ok || !parsed) {
          setProvidersConfig(null);
          setProvidersLoadError(
            parseErrorMessage(data) ?? t("error.admin.providers_load_failed")
          );
          return;
        }

        setProvidersConfig(parsed);
        setProvidersLoadError(null);
      })
      .catch(() => {
        if (canceled) return;
        setProvidersConfig(null);
        setProvidersLoadError(t("error.admin.providers_load_failed"));
      });

    return () => {
      canceled = true;
    };
  }, [t]);

  return { providersConfig, providersLoadError };
}

export function useHomeClientModelSelection({
  activeChat,
  activeProfile,
  isTemporaryChat,
  setChats,
  setTemporaryModelId,
  t,
  temporaryModelId,
}: UseHomeClientModelSelectionInput) {
  const { providersConfig, providersLoadError } = useProviderFetchState(t);
  const activeProvider = useMemo(
    () => resolveActiveProvider(providersConfig),
    [providersConfig]
  );
  const modelOptions = useMemo<ModelOption[]>(
    () => activeProvider?.models ?? [],
    [activeProvider]
  );
  const allowedModelIds = useMemo(
    () => new Set(modelOptions.map((model) => model.id)),
    [modelOptions]
  );

  const isAllowedModel = useCallback(
    (modelId: unknown): modelId is string =>
      typeof modelId === "string" && allowedModelIds.has(modelId),
    [allowedModelIds]
  );

  const providerDefaultModelId =
    activeProvider?.defaultModelId ?? modelOptions[0]?.id ?? "";
  const profileDefaultModelId = resolveProfileDefaultModelId({
    activeProfileDefaultModelId: activeProfile?.defaultModelId ?? "",
    isAllowedModel,
    providerDefaultModelId,
  });

  const effectiveModelId = resolveEffectiveModelId({
    activeChatModelId: activeChat?.modelId ?? "",
    isAllowedModel,
    isTemporaryChat,
    profileDefaultModelId,
    temporaryModelId,
  });

  const selectedModel = useMemo(
    () => modelOptions.find((model) => model.id === effectiveModelId) ?? null,
    [effectiveModelId, modelOptions]
  );

  const reasoningOptions = useMemo(() => {
    if (!selectedModel?.capabilities?.reasoning) return [];
    return allowedReasoningEfforts({
      modelType: selectedModel.type,
      providerModelId: selectedModel.id,
      webToolsEnabled: Boolean(providersConfig?.webToolsEnabled),
    });
  }, [providersConfig?.webToolsEnabled, selectedModel]);

  const reasoningKey = useMemo(() => {
    if (!activeProfile) return "";
    return `remcochat:reasoningEffort:${activeProfile.id}:${effectiveModelId}`;
  }, [activeProfile, effectiveModelId]);

  const [reasoningSelection, setReasoningSelection] = useState<{
    key: string;
    value: ReasoningEffortChoice;
  } | null>(null);

  const reasoningEffort = useMemo(() => {
    if (!selectedModel?.capabilities?.reasoning) return "auto";

    const stored =
      reasoningSelection?.key === reasoningKey
        ? reasoningSelection.value
        : window.localStorage.getItem(reasoningKey) ?? "auto";
    return normalizeReasoningEffort(stored, reasoningOptions);
  }, [reasoningKey, reasoningOptions, reasoningSelection, selectedModel]);

  const setReasoningEffort = useCallback(
    (value: ReasoningEffortChoice) => {
      setReasoningSelection({ key: reasoningKey, value });
    },
    [reasoningKey]
  );

  useEffect(() => {
    if (!reasoningKey) return;
    if (!selectedModel?.capabilities?.reasoning) return;
    window.localStorage.setItem(reasoningKey, reasoningEffort);
  }, [reasoningEffort, reasoningKey, selectedModel]);

  useEffect(() => {
    if (!activeProfile) return;
    if (!isAllowedModel(effectiveModelId)) return;
    window.localStorage.setItem(
      buildLastUsedModelKey(activeProfile.id),
      effectiveModelId
    );
  }, [activeProfile, effectiveModelId, isAllowedModel]);

  const setChatModel = useCallback(
    async (nextModelId: string) => {
      if (!activeProfile) return;
      if (!activeChat) return;
      if (!isAllowedModel(nextModelId)) return;
      if (nextModelId === activeChat.modelId) return;

      const response = await fetch(`/api/chats/${activeChat.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profileId: activeProfile.id,
          modelId: nextModelId,
        }),
      });

      const data = (await response.json()) as { chat?: AccessibleChat };
      if (!response.ok || !data.chat) return;

      setChats((previous) => {
        const next = previous.map((chat) =>
          chat.id === data.chat!.id ? data.chat! : chat
        );
        next.sort(compareChatsForSidebar);
        return next;
      });
    },
    [activeChat, activeProfile, isAllowedModel, setChats]
  );

  const handleHeaderModelChange = useCallback(
    (modelId: string) => {
      if (activeProfile && isAllowedModel(modelId)) {
        window.localStorage.setItem(
          buildLastUsedModelKey(activeProfile.id),
          modelId
        );
      }

      if (isTemporaryChat) {
        if (isAllowedModel(modelId)) setTemporaryModelId(modelId);
        return;
      }

      setChatModel(modelId);
    },
    [
      activeProfile,
      isAllowedModel,
      isTemporaryChat,
      setChatModel,
      setTemporaryModelId,
    ]
  );

  const preferredNewChatModelId = useCallback(
    (profileId: string) => {
      return resolvePreferredNewChatModelId({
        activeProfileId: activeProfile?.id ?? "",
        effectiveModelId,
        isAllowedModel,
        profileDefaultModelId,
        profileId,
        storedModelId:
          window.localStorage.getItem(buildLastUsedModelKey(profileId)) ?? "",
      });
    },
    [activeProfile?.id, effectiveModelId, isAllowedModel, profileDefaultModelId]
  );

  return {
    effectiveModelId,
    handleHeaderModelChange,
    isAllowedModel,
    modelOptions,
    preferredNewChatModelId,
    profileDefaultModelId,
    providersLoadError,
    reasoningEffort,
    reasoningOptions,
    selectedModel,
    setReasoningEffort,
  };
}
