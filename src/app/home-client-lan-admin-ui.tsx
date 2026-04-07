"use client";

import type {
  Dispatch,
  SetStateAction,
} from "react";

import type { I18nContextValue } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { KeyIcon } from "lucide-react";

type LanAdminAccessUiState = {
  allowed: boolean | null;
  allowedReason: string;
  bashToolsEnabledHeader: "0" | "1" | null;
  draft: string;
  hasToken: boolean;
  open: boolean;
  remember: boolean;
  setDraft: Dispatch<SetStateAction<string>>;
  setOpen: (open: boolean) => void;
  setRemember: Dispatch<SetStateAction<boolean>>;
  setVisible: Dispatch<SetStateAction<boolean>>;
  visible: boolean;
};

type HomeClientLanAdminTriggerButtonProps = {
  allowed: boolean | null;
  enabled: boolean;
  hasToken: boolean;
  onOpen: () => void;
  t: I18nContextValue["t"];
};

type HomeClientLanAdminDialogProps = {
  clearLanAdminTokenState: () => void;
  lanAdminAccess: LanAdminAccessUiState;
  lanAdminAccessEnabled: boolean;
  saveLanAdminToken: () => void;
  t: I18nContextValue["t"];
};

export function HomeClientLanAdminTriggerButton({
  allowed,
  enabled,
  hasToken,
  onOpen,
  t,
}: HomeClientLanAdminTriggerButtonProps) {
  if (!enabled) return null;

  return (
    <Button
      aria-label={t("admin_access.title")}
      className="h-9 w-9 px-0"
      onClick={onOpen}
      title={t("admin_access.title")}
      type="button"
      variant="outline"
    >
      <KeyIcon
        className={
          !hasToken
            ? "size-4"
            : allowed === false
              ? "size-4 text-amber-600 dark:text-amber-400"
              : allowed === true
                ? "size-4 text-emerald-600 dark:text-emerald-400"
                : "size-4 text-muted-foreground"
        }
      />
    </Button>
  );
}

export function HomeClientLanAdminDialog({
  clearLanAdminTokenState,
  lanAdminAccess,
  lanAdminAccessEnabled,
  saveLanAdminToken,
  t,
}: HomeClientLanAdminDialogProps) {
  return (
    <Dialog
      onOpenChange={lanAdminAccess.setOpen}
      open={lanAdminAccess.open}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("admin_access.title")}</DialogTitle>
        </DialogHeader>

        {!lanAdminAccessEnabled ? (
          <div className="text-sm text-muted-foreground">
            {t("admin_access.not_configured")}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="text-sm text-muted-foreground">
              {t("admin_access.description")}
            </div>

            <div className="space-y-2">
              <div className="text-sm font-medium">{t("admin_access.token.label")}</div>
              <Input
                autoFocus
                data-testid="bash-tools:lan-admin-token"
                onChange={(event) => lanAdminAccess.setDraft(event.target.value)}
                placeholder="REMCOCHAT_ADMIN_TOKEN"
                type={lanAdminAccess.visible ? "text" : "password"}
                value={lanAdminAccess.draft}
              />

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  onClick={() => lanAdminAccess.setVisible((value) => !value)}
                  type="button"
                  variant="secondary"
                >
                  {lanAdminAccess.visible ? t("common.hide") : t("common.show")}
                </Button>
                <Button
                  onClick={clearLanAdminTokenState}
                  type="button"
                  variant="ghost"
                >
                  {t("common.clear")}
                </Button>
              </div>
            </div>

            <div className="flex items-start gap-3 rounded-md border bg-card px-3 py-2">
              <button
                aria-checked={lanAdminAccess.remember}
                aria-label={t("admin_access.remember.aria")}
                className={
                  "relative mt-0.5 inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors " +
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background " +
                  (lanAdminAccess.remember ? "bg-primary" : "bg-muted")
                }
                onClick={() => lanAdminAccess.setRemember((value) => !value)}
                role="switch"
                title={
                  lanAdminAccess.remember
                    ? t("admin_access.remember.title_on")
                    : t("admin_access.remember.title_off")
                }
                type="button"
              >
                <span
                  className={
                    "pointer-events-none inline-block size-5 rounded-full bg-white shadow-sm transition-transform " +
                    (lanAdminAccess.remember
                      ? "translate-x-5"
                      : "translate-x-0.5")
                  }
                />
              </button>
              <div className="min-w-0">
                <div className="text-sm font-medium">{t("admin_access.remember.title")}</div>
                <div className="text-xs text-muted-foreground">
                  {t("admin_access.remember.description")}
                </div>
              </div>
            </div>

            <div className="rounded-md border bg-card p-3">
              <div className="text-sm font-medium">{t("admin_access.verification.title")}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {t("admin_access.verification.description")}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                <code className="rounded bg-muted px-2 py-1">
                  x-remcochat-bash-tools-enabled=
                  {lanAdminAccess.bashToolsEnabledHeader ?? "?"}
                </code>
                <code className="rounded bg-muted px-2 py-1">
                  token=
                  {lanAdminAccess.hasToken
                    ? t("admin_access.verification.token_present")
                    : t("admin_access.verification.token_absent")}
                </code>
                <code className="rounded bg-muted px-2 py-1">
                  admin=
                  {lanAdminAccess.allowed === true
                    ? t("admin_access.verification.allowed")
                    : lanAdminAccess.allowed === false
                      ? t("admin_access.verification.denied")
                      : "?"}
                  {lanAdminAccess.allowedReason
                    ? ` (${lanAdminAccess.allowedReason})`
                    : ""}
                </code>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button
                onClick={() => lanAdminAccess.setOpen(false)}
                type="button"
                variant="ghost"
              >
                {t("common.cancel")}
              </Button>
              <Button onClick={saveLanAdminToken} type="button">
                {t("admin_access.save_locally")}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
