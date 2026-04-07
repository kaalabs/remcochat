"use client";

import { RotateCcwIcon, RotateCwIcon, SaveIcon } from "lucide-react";

import { useI18n } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";

export function AdminSaveButton(props: {
  compact?: boolean;
  disabled: boolean;
  onClick: () => void;
  saving: boolean;
  testId: string;
}) {
  const { t } = useI18n();
  const label = props.saving ? t("common.saving_ellipsis") : t("common.save");

  return (
    <Button
      aria-label={label}
      className={props.compact ? "size-8" : "h-9 w-9"}
      data-testid={props.testId}
      disabled={props.disabled}
      onClick={props.onClick}
      size="icon"
      title={label}
      type="button"
    >
      {props.saving ? (
        <RotateCwIcon className="size-4 animate-spin" />
      ) : (
        <SaveIcon className="size-4" />
      )}
    </Button>
  );
}

export function AdminResetButton(props: {
  compact?: boolean;
  disabled: boolean;
  onClick: () => void;
  testId: string;
}) {
  const { t } = useI18n();
  const label = t("common.reset");

  return (
    <Button
      aria-label={label}
      className={props.compact ? "size-8" : "h-9 w-9"}
      data-testid={props.testId}
      disabled={props.disabled}
      onClick={props.onClick}
      size="icon"
      title={label}
      type="button"
      variant="secondary"
    >
      <RotateCcwIcon className="size-4" />
    </Button>
  );
}
