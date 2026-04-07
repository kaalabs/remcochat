"use client";

import type { ProviderSwitcherResponse } from "@/app/admin/admin-client-api";
import { AdminSaveButton } from "@/app/admin/admin-client-action-buttons";
import { ReadinessDot, type ReadinessDotState } from "@/components/readiness-dot";
import { useI18n } from "@/components/i18n-provider";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type AdminProviderOption = ProviderSwitcherResponse["providers"][number];

export function resolveAdminProviderSelectLabel(input: {
  activeDraft: string;
  loading: boolean;
  providerOptions: AdminProviderOption[];
}) {
  if (input.loading) return null;
  return (
    input.providerOptions.find((provider) => provider.id === input.activeDraft)
      ?.name ?? input.activeDraft
  );
}

export function AdminProvidersCard(props: {
  activeDraft: string;
  activeProviderOption: AdminProviderOption | null;
  canSave: boolean;
  error: string | null;
  llmReadinessByProviderId: Record<string, ReadinessDotState>;
  loading: boolean;
  onSave: () => void;
  providerOptions: AdminProviderOption[];
  saving: boolean;
  setActiveDraft: (value: string) => void;
}) {
  const { t } = useI18n();
  const selectedLabel = resolveAdminProviderSelectLabel({
    activeDraft: props.activeDraft,
    loading: props.loading,
    providerOptions: props.providerOptions,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("admin.providers.title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="text-sm text-muted-foreground">
          {t("admin.providers.description")}
        </div>
        {props.error ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {props.error}
          </div>
        ) : null}
        {props.activeProviderOption?.status === "degraded" ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {t("admin.providers.status.current_failed", {
              provider: props.activeProviderOption.name,
            })}
          </div>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="admin:provider">
              {t("admin.providers.active.label")}
            </label>
            <Select
              disabled={
                props.loading || props.saving || props.providerOptions.length === 0
              }
              onValueChange={(value) => props.setActiveDraft(value)}
              value={props.activeDraft}
            >
              <SelectTrigger
                data-testid="admin:provider-select"
                id="admin:provider"
              >
                <ReadinessDot
                  state={
                    props.llmReadinessByProviderId[props.activeDraft] ?? "untested"
                  }
                />
                <SelectValue>
                  {props.loading
                    ? t("common.loading")
                    : selectedLabel ?? t("admin.providers.active.placeholder")}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {props.providerOptions.map((provider) => (
                  <SelectItem
                    data-testid={`admin:provider-option:${provider.id}`}
                    key={provider.id}
                    value={provider.id}
                  >
                    <div className="flex items-center gap-2">
                      <ReadinessDot
                        state={
                          props.llmReadinessByProviderId[provider.id] ?? "untested"
                        }
                      />
                      <span>{provider.name}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <AdminSaveButton
            disabled={!props.canSave}
            onClick={props.onSave}
            saving={props.saving}
            testId="admin:provider-save"
          />
        </div>
        {props.providerOptions.length > 0 ? (
          <div className="space-y-2">
            {props.providerOptions.map((provider) => (
              <div className="rounded-md border px-3 py-2" key={provider.id}>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">{provider.name}</span>
                  {provider.active ? (
                    <Badge variant="secondary">{t("common.active")}</Badge>
                  ) : null}
                  {provider.default ? (
                    <Badge variant="outline">
                      {t("admin.providers.badge.default")}
                    </Badge>
                  ) : null}
                  {provider.status === "degraded" ? (
                    <Badge variant="destructive">
                      {t("admin.providers.status.degraded")}
                    </Badge>
                  ) : null}
                </div>
                {provider.loadError ? (
                  <div className="mt-1 text-xs text-muted-foreground">
                    {t("admin.providers.status.provider_failed", {
                      error: provider.loadError,
                    })}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
