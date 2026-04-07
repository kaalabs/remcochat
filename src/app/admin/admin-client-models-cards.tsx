"use client";

import { Brain, Braces, FileText, FilterIcon, Layers3, ListIcon, Thermometer, Wrench } from "lucide-react";

import type { ModelsInventoryResponse } from "@/app/admin/admin-client-api";
import { AdminResetButton, AdminSaveButton } from "@/app/admin/admin-client-action-buttons";
import { AdminModelPicker, type AdminModelPickerOption } from "@/app/admin/admin-model-picker";
import { ReadinessDot, type ReadinessDotState } from "@/components/readiness-dot";
import { useI18n } from "@/components/i18n-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { formatContextWindow, listModelCapabilityBadges } from "@/lib/models";

type AdminInventoryProvider = ModelsInventoryResponse["providers"][number];
type AdminInventoryModel = AdminInventoryProvider["models"][number];
type AdminProviderFilter = { query: string; showAll: boolean };

const adminModelCapabilityColors = {
  reasoning: "text-emerald-700 dark:text-emerald-300",
  tools: "text-blue-700 dark:text-blue-300",
  temperature: "text-purple-700 dark:text-purple-300",
  attachments: "text-orange-700 dark:text-orange-300",
  structuredOutput: "text-cyan-700 dark:text-cyan-300",
} as const;

const adminModelCapabilityIcons = {
  reasoning: Brain,
  tools: Wrench,
  temperature: Thermometer,
  attachments: FileText,
  structuredOutput: Braces,
} as const;

export function toAdminModelPickerOptions(
  models: AdminInventoryModel[]
): AdminModelPickerOption[] {
  return models.map((model) => ({
    id: model.id,
    label: model.label,
    description: model.description,
    modelType: model.modelType,
    capabilities: model.capabilities,
    contextWindow: model.contextWindow,
  }));
}

export function resolveAdminRouterCardState(input: {
  inventory: ModelsInventoryResponse;
  routerDraftModelId: string;
  routerDraftProviderId: string;
  routerSaving: boolean;
}) {
  const providerId =
    input.routerDraftProviderId || input.inventory.router?.providerId || "";
  const provider = input.inventory.providers.find((item) => item.id === providerId);
  const options = toAdminModelPickerOptions(
    (provider?.models ?? []).filter((model) => model.supported)
  );
  const canSaveRouter =
    !input.routerSaving
    && providerId.trim().length > 0
    && input.routerDraftModelId.trim().length > 0
    && (
      providerId !== input.inventory.router?.providerId
      || input.routerDraftModelId !== input.inventory.router?.modelId
    );

  return { canSaveRouter, options, provider, providerId };
}

export function filterAdminInventoryModels(input: {
  draft: Set<string>;
  filter: AdminProviderFilter;
  models: AdminInventoryModel[];
}) {
  const query = input.filter.query.trim().toLowerCase();
  return (
    input.filter.showAll
      ? input.models
      : input.models.filter((model) => input.draft.has(model.id))
  ).filter((model) => {
    if (!query) return true;
    const haystack =
      `${model.id} ${model.label} ${model.description ?? ""}`.toLowerCase();
    return haystack.includes(query);
  });
}

export function AdminRouterCard(props: {
  inventory: ModelsInventoryResponse;
  inventoryLoading: boolean;
  llmReadinessByProviderId: Record<string, ReadinessDotState>;
  onSaveRouterModel: () => void;
  routerDraftModelId: string;
  routerDraftProviderId: string;
  routerError: string | null;
  routerSaving: boolean;
  setRouterModelDraft: (value: string) => void;
  setRouterProviderDraft: (value: string) => void;
}) {
  const { t } = useI18n();
  const { canSaveRouter, options, providerId } = resolveAdminRouterCardState({
    inventory: props.inventory,
    routerDraftModelId: props.routerDraftModelId,
    routerDraftProviderId: props.routerDraftProviderId,
    routerSaving: props.routerSaving,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("admin.router.title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {props.routerError ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {props.routerError}
          </div>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <div className="space-y-3">
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="admin:router-provider">
                {t("admin.router.provider")}
              </label>
              <Select
                disabled={props.inventoryLoading || props.routerSaving}
                onValueChange={(value) => props.setRouterProviderDraft(value)}
                value={providerId}
              >
                <SelectTrigger id="admin:router-provider">
                  <ReadinessDot
                    state={props.llmReadinessByProviderId[providerId] ?? "untested"}
                  />
                  <SelectValue>
                    {props.inventoryLoading
                      ? t("common.loading")
                      : (props.inventory.providers.find((provider) => provider.id === providerId)
                        ?.name ?? providerId) || t("admin.providers.active.placeholder")}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {props.inventory.providers.map((provider) => (
                    <SelectItem key={provider.id} value={provider.id}>
                      <div className="flex items-center gap-2">
                        <ReadinessDot
                          state={
                            props.llmReadinessByProviderId[provider.id] ?? "untested"
                          }
                        />
                        <span>{provider.name}</span>
                        <span className="font-mono text-muted-foreground">
                          {provider.id}
                        </span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="admin:router-model">
                {t("model.label")}
              </label>
              <div id="admin:router-model">
                <AdminModelPicker
                  disabled={
                    props.inventoryLoading || props.routerSaving || options.length === 0
                  }
                  onChange={(modelId) => props.setRouterModelDraft(modelId)}
                  options={options}
                  placeholder={
                    props.inventoryLoading ? t("common.loading") : t("model.select.title")
                  }
                  triggerTestId="admin:router-model-select"
                  value={props.routerDraftModelId}
                />
              </div>
            </div>
          </div>

          <AdminSaveButton
            disabled={!canSaveRouter}
            onClick={props.onSaveRouterModel}
            saving={props.routerSaving}
            testId="admin:router-model-save"
          />
        </div>
      </CardContent>
    </Card>
  );
}

export function AdminAllowedModelsCard(props: {
  allowedDraftByProviderId: Record<string, Set<string>>;
  defaultDraftByProviderId: Record<string, string>;
  defaultModelSavingByProvider: Record<string, boolean>;
  filtersByProviderId: Record<string, AdminProviderFilter>;
  inventory: ModelsInventoryResponse | null;
  inventoryError: string | null;
  inventoryLoading: boolean;
  modelsError: string | null;
  modelsSavingByProvider: Record<string, boolean>;
  onResetProviderDefaultDraft: (providerId: string) => void;
  onResetProviderDraft: (providerId: string) => void;
  onSaveProviderDefaultDraft: (providerId: string) => void;
  onSaveProviderDraft: (providerId: string) => void;
  providerSwitcherActiveProviderId: string | null;
  setProviderDefaultDraft: (providerId: string, modelId: string) => void;
  setProviderQuery: (providerId: string, query: string) => void;
  toggleAllowedModel: (providerId: string, modelId: string) => void;
  toggleProviderShowAll: (providerId: string) => void;
}) {
  const { t } = useI18n();

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("admin.models.allowed.title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {props.modelsError ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {props.modelsError}
          </div>
        ) : null}

        {props.inventoryError ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {props.inventoryError}
          </div>
        ) : null}

        {props.inventoryLoading ? (
          <div className="text-sm text-muted-foreground">{t("common.loading")}</div>
        ) : props.inventory ? (
          <div className="space-y-3">
            <div className="text-xs text-muted-foreground">
              {t("admin.models.allowed.inventory.hint")}
            </div>

            <div className="space-y-3">
              {props.inventory.providers.map((provider) => {
                const draft =
                  props.allowedDraftByProviderId[provider.id]
                  ?? new Set(provider.allowedModelIds);
                const required = new Set(provider.requiredModelIds);
                const baseline = new Set(provider.allowedModelIds);
                const filter = props.filtersByProviderId[provider.id] ?? {
                  query: "",
                  showAll: false,
                };
                const savingProvider = Boolean(
                  props.modelsSavingByProvider[provider.id]
                );
                const hasChanges = draft.size !== baseline.size
                  || Array.from(draft).some((value) => !baseline.has(value));
                const defaultDraft = String(
                  props.defaultDraftByProviderId[provider.id] ?? provider.defaultModelId
                ).trim();
                const savingDefault = Boolean(
                  props.defaultModelSavingByProvider[provider.id]
                );
                const hasDefaultChange =
                  defaultDraft.length > 0 && defaultDraft !== provider.defaultModelId;
                const filtered = filterAdminInventoryModels({
                  draft,
                  filter,
                  models: provider.models,
                });
                const isActive =
                  props.providerSwitcherActiveProviderId === provider.id;

                return (
                  <details className="rounded-md border px-3 py-2" key={provider.id}>
                    <summary className="cursor-pointer select-none text-sm font-medium">
                      <span className="mr-2">{provider.name}</span>
                      <span className="text-xs font-normal text-muted-foreground">
                        <code>{provider.id}</code>
                      </span>
                      <span className="ml-2 inline-flex items-center rounded-full border bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                        {draft.size} / {provider.models.length}
                      </span>
                      {isActive ? (
                        <Badge
                          className="ml-2 border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300"
                          variant="outline"
                        >
                          {t("common.active")}
                        </Badge>
                      ) : null}
                    </summary>

                    <div className="mt-3 space-y-3">
                      <div className="grid gap-3 rounded-md border bg-muted/20 px-3 py-2 sm:grid-cols-[1fr_auto] sm:items-end">
                        <div className="space-y-2">
                          <label
                            className="text-sm font-medium"
                            htmlFor={`admin:default-model:${provider.id}`}
                          >
                            {t("admin.models.default_model.label")}
                          </label>
                          <div id={`admin:default-model:${provider.id}`}>
                            <AdminModelPicker
                              disabled={props.inventoryLoading || savingDefault}
                              onChange={(modelId) =>
                                props.setProviderDefaultDraft(provider.id, modelId)
                              }
                              options={toAdminModelPickerOptions(
                                provider.models.filter((model) => model.supported)
                              )}
                              placeholder={t(
                                "admin.models.default_model.placeholder"
                              )}
                              triggerTestId={`admin:default-model-select:${provider.id}`}
                              value={defaultDraft}
                            />
                          </div>
                        </div>

                        <div className="flex justify-end gap-2">
                          <AdminResetButton
                            compact
                            disabled={!hasDefaultChange || savingDefault}
                            onClick={() =>
                              props.onResetProviderDefaultDraft(provider.id)
                            }
                            testId={`admin:default-model-reset:${provider.id}`}
                          />
                          <AdminSaveButton
                            compact
                            disabled={!hasDefaultChange || savingDefault || hasChanges}
                            onClick={() =>
                              props.onSaveProviderDefaultDraft(provider.id)
                            }
                            saving={savingDefault}
                            testId={`admin:default-model-save:${provider.id}`}
                          />
                        </div>

                        {hasChanges ? (
                          <div className="text-xs text-muted-foreground sm:col-span-2">
                            {t(
                              "admin.models.default_model.warning_unsaved_allowed.part1"
                            )}{" "}
                            <code>allowed_model_ids</code>{" "}
                            {t(
                              "admin.models.default_model.warning_unsaved_allowed.part2"
                            )}
                          </div>
                        ) : null}
                      </div>

                      <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
                        <div className="space-y-2">
                          <label
                            className="text-sm font-medium"
                            htmlFor={`admin:models-search:${provider.id}`}
                          >
                            {t("common.search")}
                          </label>
                          <Input
                            autoComplete="off"
                            data-testid={`admin:models-search:${provider.id}`}
                            id={`admin:models-search:${provider.id}`}
                            onChange={(event) =>
                              props.setProviderQuery(provider.id, event.target.value)
                            }
                            placeholder={
                              filter.showAll
                                ? t("admin.models.search.placeholder.all")
                                : t("admin.models.search.placeholder.allowed")
                            }
                            value={filter.query}
                          />
                        </div>

                        <div className="flex flex-wrap justify-end gap-2">
                          <Button
                            aria-label={
                              filter.showAll
                                ? t("admin.models.show_allowed")
                                : t("admin.models.show_all")
                            }
                            className="size-8"
                            data-testid={`admin:models-showall:${provider.id}`}
                            onClick={() => props.toggleProviderShowAll(provider.id)}
                            size="icon"
                            title={
                              filter.showAll
                                ? t("admin.models.show_allowed")
                                : t("admin.models.show_all")
                            }
                            type="button"
                            variant="secondary"
                          >
                            {filter.showAll ? (
                              <FilterIcon className="size-4" />
                            ) : (
                              <ListIcon className="size-4" />
                            )}
                          </Button>
                          <AdminResetButton
                            compact
                            disabled={!hasChanges || savingProvider}
                            onClick={() => props.onResetProviderDraft(provider.id)}
                            testId={`admin:allowed-models-reset:${provider.id}`}
                          />
                          <AdminSaveButton
                            compact
                            disabled={!hasChanges || savingProvider}
                            onClick={() => props.onSaveProviderDraft(provider.id)}
                            saving={savingProvider}
                            testId={`admin:allowed-models-save:${provider.id}`}
                          />
                        </div>
                      </div>

                      <div className="rounded-md border">
                        {filtered.length === 0 ? (
                          <div className="px-3 py-2 text-sm text-muted-foreground">
                            {t("model.select.empty")}
                          </div>
                        ) : (
                          <div className="divide-y">
                            {filtered.map((model) => {
                              const checked = draft.has(model.id);
                              const isRequired = required.has(model.id);
                              const isDefault = model.id === provider.defaultModelId;
                              const isRouter =
                                props.inventory?.router?.providerId === provider.id
                                && props.inventory?.router?.modelId === model.id;
                              const disabled = isRequired || !model.supported;

                              return (
                                <div
                                  className="flex items-start gap-3 px-3 py-2"
                                  data-testid={`admin:model-row:${provider.id}:${model.id}`}
                                  key={model.id}
                                >
                                  <input
                                    checked={checked}
                                    className="mt-1 size-4 accent-foreground disabled:opacity-50"
                                    disabled={disabled}
                                    onChange={() =>
                                      props.toggleAllowedModel(provider.id, model.id)
                                    }
                                    type="checkbox"
                                  />

                                  <div className="min-w-0 flex-1 space-y-1">
                                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                                      <div className="min-w-0">
                                        <div className="truncate text-sm font-medium">
                                          {model.label}
                                        </div>
                                      </div>

                                      <div className="flex flex-wrap gap-1">
                                        {!model.supported ? (
                                          <Badge variant="outline">
                                            {t("admin.models.badge.unsupported")}
                                          </Badge>
                                        ) : null}
                                        {isDefault ? (
                                          <Badge
                                            className="border-amber-500/30 bg-amber-500/15 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300"
                                            variant="outline"
                                          >
                                            {t("admin.models.badge.default")}
                                          </Badge>
                                        ) : null}
                                        {isRouter ? (
                                          <Badge
                                            className="border-amber-500/30 bg-amber-500/15 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300"
                                            variant="outline"
                                          >
                                            {t("admin.models.badge.router")}
                                          </Badge>
                                        ) : null}
                                      </div>
                                    </div>

                                    <div className="flex flex-wrap gap-1">
                                      {listModelCapabilityBadges(model.capabilities).map(
                                        ({ key, label, enabled }) => {
                                          const CapabilityIcon =
                                            adminModelCapabilityIcons[
                                              key as keyof typeof adminModelCapabilityIcons
                                            ];

                                          return (
                                            <Tooltip key={key}>
                                              <TooltipTrigger asChild>
                                                <Badge
                                                  className={cn(
                                                    "inline-flex h-5 min-h-5 w-5 items-center justify-center bg-transparent px-1 py-0 hover:bg-transparent",
                                                    enabled ? "" : "opacity-50",
                                                  )}
                                                  data-enabled={enabled ? "true" : "false"}
                                                  variant="outline"
                                                >
                                                  {enabled && CapabilityIcon ? (
                                                    <span
                                                      aria-label={label}
                                                      className="inline-flex items-center justify-center"
                                                    >
                                                      <span className="sr-only">{label}</span>
                                                      <CapabilityIcon
                                                        className={cn(
                                                          "size-4",
                                                          enabled
                                                            ? adminModelCapabilityColors[
                                                                key as keyof typeof adminModelCapabilityColors
                                                              ]
                                                            : "text-muted-foreground",
                                                        )}
                                                        strokeWidth={2.5}
                                                      />
                                                    </span>
                                                  ) : null}
                                                </Badge>
                                              </TooltipTrigger>
                                              <TooltipContent>
                                                <p>{label}</p>
                                              </TooltipContent>
                                            </Tooltip>
                                          );
                                        }
                                      )}
                                      {model.contextWindow ? (
                                        <Badge
                                          className="inline-flex h-5 min-h-5 items-center gap-1 px-2 py-0.5"
                                          variant="outline"
                                        >
                                          <Layers3 className="size-4 text-cyan-700 dark:text-cyan-300" />
                                          {formatContextWindow(model.contextWindow)}
                                        </Badge>
                                      ) : null}
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  </details>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">
            {t("admin.models.allowed.inventory.none")}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
