"use client";

import type { WebSearchProviderResponse } from "@/app/admin/admin-client-api";
import { AdminResetButton, AdminSaveButton } from "@/app/admin/admin-client-action-buttons";
import { ReadinessDot, type ReadinessDotState } from "@/components/readiness-dot";
import { useI18n } from "@/components/i18n-provider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function canSaveAdminWebSearchSelection(input: {
  webSearchConfig: WebSearchProviderResponse | null;
  webSearchDraft: string;
  webSearchLoading: boolean;
  webSearchSaving: boolean;
}) {
  return !(
    input.webSearchLoading
    || input.webSearchSaving
    || !input.webSearchConfig?.enabled
    || input.webSearchDraft === input.webSearchConfig.selectedProviderId
  );
}

export function resolveAdminWebSearchProviderLabel(input: {
  fallback: string;
  loading: boolean;
  webSearchConfig: WebSearchProviderResponse | null;
  webSearchDraft: string;
}) {
  if (input.loading) return null;
  const draft = input.webSearchDraft.trim();
  return (
    input.webSearchConfig?.providers.find(
      (provider) => provider.id === draft
    )?.label
    || draft
    || input.fallback
  );
}

export function AdminWebSearchCard(props: {
  onSave: () => void;
  setWebSearchDraft: (value: string) => void;
  webSearchConfig: WebSearchProviderResponse | null;
  webSearchDraft: string;
  webSearchError: string | null;
  webSearchLoading: boolean;
  webSearchReadinessByProviderId: Record<string, ReadinessDotState>;
  webSearchSaving: boolean;
}) {
  const { t } = useI18n();
  const selectedLabel = resolveAdminWebSearchProviderLabel({
    fallback: t("admin.web_search.provider.placeholder"),
    loading: props.webSearchLoading,
    webSearchConfig: props.webSearchConfig,
    webSearchDraft: props.webSearchDraft,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("admin.web_search.title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {props.webSearchError ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {props.webSearchError}
          </div>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <div className="space-y-2">
            <label
              className="text-sm font-medium"
              htmlFor="admin:web-search-provider"
            >
              {t("admin.web_search.provider.label")}
            </label>
            <Select
              disabled={
                props.webSearchLoading
                || props.webSearchSaving
                || !props.webSearchConfig?.enabled
              }
              onValueChange={(value) => props.setWebSearchDraft(value)}
              value={props.webSearchDraft}
            >
              <SelectTrigger
                data-testid="admin:web-search-provider-select"
                id="admin:web-search-provider"
              >
                <ReadinessDot
                  state={
                    !props.webSearchConfig?.enabled
                      ? "disabled"
                      : (props.webSearchReadinessByProviderId[props.webSearchDraft]
                        ?? "untested")
                  }
                />
                <SelectValue>
                  {props.webSearchLoading
                    ? t("common.loading")
                    : selectedLabel}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {(props.webSearchConfig?.providers ?? []).map((provider) => (
                  <SelectItem key={provider.id} value={provider.id}>
                    <div className="flex items-center gap-2">
                      <ReadinessDot
                        state={
                          !props.webSearchConfig?.enabled
                            ? "disabled"
                            : (props.webSearchReadinessByProviderId[provider.id]
                              ?? "untested")
                        }
                      />
                      <span>{provider.label}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <AdminSaveButton
            disabled={
              !canSaveAdminWebSearchSelection({
                webSearchConfig: props.webSearchConfig,
                webSearchDraft: props.webSearchDraft,
                webSearchLoading: props.webSearchLoading,
                webSearchSaving: props.webSearchSaving,
              })
            }
            onClick={props.onSave}
            saving={props.webSearchSaving}
            testId="admin:web-search-provider-save"
          />
        </div>

        {props.webSearchConfig ? (
          <div className="text-xs text-muted-foreground">
            {t("admin.web_search.enabled")}:{" "}
            <span className="font-medium">
              {props.webSearchConfig.enabled ? t("common.yes") : t("common.no")}
            </span>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function AdminLocalAccessCard(props: {
  localAccessCommandsDraft: string;
  localAccessConfigPresent: boolean;
  localAccessDirectoriesDraft: string;
  localAccessEnabledDraft: boolean;
  localAccessError: string | null;
  localAccessLoading: boolean;
  localAccessSaving: boolean;
  onReset: () => void;
  onSave: () => void;
  setLocalAccessCommandsDraft: (value: string) => void;
  setLocalAccessDirectoriesDraft: (value: string) => void;
  setLocalAccessEnabledDraft: (value: boolean) => void;
}) {
  const { t } = useI18n();
  const disableActions =
    props.localAccessLoading
    || props.localAccessSaving
    || !props.localAccessConfigPresent;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("admin.local_access.title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {props.localAccessError ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {props.localAccessError}
          </div>
        ) : null}

        <div className="text-sm text-muted-foreground">
          {t("admin.local_access.description")}
        </div>

        <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
          <div className="space-y-0.5">
            <div className="text-sm font-medium">
              {t("admin.local_access.enabled.label")}
            </div>
            <div className="text-xs text-muted-foreground">
              {t("admin.local_access.enabled.hint")}
            </div>
          </div>
          <input
            checked={props.localAccessEnabledDraft}
            className="size-4 accent-foreground disabled:opacity-50"
            disabled={props.localAccessLoading || props.localAccessSaving}
            onChange={(event) =>
              props.setLocalAccessEnabledDraft(event.target.checked)
            }
            type="checkbox"
          />
        </div>

        <div className="grid gap-3">
          <div className="space-y-2">
            <label
              className="text-sm font-medium"
              htmlFor="admin:local-access-commands"
            >
              {t("admin.local_access.commands.label")}
            </label>
            <Textarea
              className="min-h-[92px] font-mono text-xs"
              disabled={props.localAccessLoading || props.localAccessSaving}
              id="admin:local-access-commands"
              onChange={(event) =>
                props.setLocalAccessCommandsDraft(event.target.value)
              }
              placeholder={t("admin.local_access.commands.placeholder")}
              value={props.localAccessCommandsDraft}
            />
          </div>

          <div className="space-y-2">
            <label
              className="text-sm font-medium"
              htmlFor="admin:local-access-directories"
            >
              {t("admin.local_access.directories.label")}
            </label>
            <Textarea
              className="min-h-[92px] font-mono text-xs"
              disabled={props.localAccessLoading || props.localAccessSaving}
              id="admin:local-access-directories"
              onChange={(event) =>
                props.setLocalAccessDirectoriesDraft(event.target.value)
              }
              placeholder={t("admin.local_access.directories.placeholder")}
              value={props.localAccessDirectoriesDraft}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <AdminResetButton
            disabled={disableActions}
            onClick={props.onReset}
            testId="admin:local-access-reset"
          />
          <AdminSaveButton
            disabled={disableActions}
            onClick={props.onSave}
            saving={props.localAccessSaving}
            testId="admin:local-access-save"
          />
        </div>
      </CardContent>
    </Card>
  );
}
