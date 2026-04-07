"use client";

import { Fragment } from "react";

import { useI18n } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  canAdminResetData,
  splitAdminDangerDescription,
} from "@/app/admin/admin-client-maintenance";

export function AdminBackupCard(props: {
  onExport: () => void;
}) {
  const { t } = useI18n();

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("admin.backup.title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="text-sm text-muted-foreground">
          {t("admin.backup.description")}
        </div>
        <div className="flex justify-end">
          <Button
            data-testid="admin:export"
            onClick={() => props.onExport()}
            type="button"
            variant="secondary"
          >
            {t("admin.backup.export")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function AdminDangerResetCard(props: {
  onReset: () => void;
  resetConfirm: string;
  resetSaving: boolean;
  setResetConfirm: (value: string) => void;
}) {
  const { t } = useI18n();
  const descriptionParts = splitAdminDangerDescription(
    t("admin.danger.description")
  );

  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle className="text-destructive">
          {t("admin.danger.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="text-sm text-muted-foreground">
          {descriptionParts.length === 1 ? (
            descriptionParts[0]
          ) : (
            <>
              {descriptionParts.map((part, index) => (
                <Fragment key={`${index}:${part}`}>
                  {index > 0 ? <code>RESET</code> : null}
                  {part}
                </Fragment>
              ))}
            </>
          )}
        </div>
        <Input
          autoComplete="off"
          data-testid="admin:reset-confirm"
          onChange={(event) => props.setResetConfirm(event.target.value)}
          placeholder={t("admin.danger.placeholder")}
          value={props.resetConfirm}
        />
        <div className="flex justify-end">
          <Button
            data-testid="admin:reset"
            disabled={
              !canAdminResetData({
                resetConfirm: props.resetConfirm,
                resetSaving: props.resetSaving,
              })
            }
            onClick={() => props.onReset()}
            type="button"
            variant="destructive"
          >
            {props.resetSaving
              ? t("common.resetting_ellipsis")
              : t("admin.danger.reset")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
