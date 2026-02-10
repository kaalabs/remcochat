"use client";

import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/components/i18n-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { TaskList, TaskListItem } from "@/lib/types";
import {
  CheckCircle2,
  Circle,
  ListChecks,
  ShoppingBasket,
  Trash2,
} from "lucide-react";

type ListCardProps = {
  list: TaskList;
  profileId: string;
};

const listKindMeta = {
  todo: {
    accent:
      "border-yellow-200/70 bg-yellow-50/85 dark:border-yellow-400/55 dark:bg-yellow-500/15",
    iconBg:
      "border-yellow-200/70 bg-yellow-100/70 dark:border-yellow-400/60 dark:bg-yellow-500/25",
    iconColor: "text-yellow-800/80 dark:text-yellow-100/90",
    rowHover: "hover:bg-yellow-200/30 dark:hover:bg-yellow-500/15",
    badge: "bg-yellow-100 text-yellow-900 dark:bg-yellow-400/25 dark:text-yellow-50",
    sharedBadge:
      "border-yellow-300/60 bg-yellow-50/60 text-yellow-900/80 dark:border-yellow-200/40 dark:bg-yellow-500/10 dark:text-yellow-100/80",
    icon: ListChecks,
  },
  grocery: {
    accent:
      "border-yellow-300/70 bg-yellow-50/90 dark:border-yellow-500/60 dark:bg-yellow-500/20",
    iconBg:
      "border-yellow-200/70 bg-yellow-100/80 dark:border-yellow-400/60 dark:bg-yellow-500/30",
    iconColor: "text-yellow-900/80 dark:text-yellow-100/80",
    rowHover: "hover:bg-yellow-200/35 dark:hover:bg-yellow-500/20",
    badge: "bg-yellow-200 text-yellow-900 dark:bg-yellow-400/30 dark:text-yellow-50",
    sharedBadge:
      "border-yellow-300/60 bg-yellow-50/70 text-yellow-900/80 dark:border-yellow-200/40 dark:bg-yellow-500/10 dark:text-yellow-100/80",
    icon: ShoppingBasket,
  },
} as const;

function normalizeList(list: TaskList) {
  return {
    ...list,
    items: Array.isArray(list.items) ? list.items : [],
    sharedCount: Number(list.sharedCount ?? 0),
    deleted: Boolean(list.deleted),
  };
}

export function ListCard({ list, profileId }: ListCardProps) {
  const { t } = useI18n();
  const [state, setState] = useState<TaskList>(() => normalizeList(list));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setState(normalizeList(list));
  }, [list]);

  const meta = listKindMeta[state.kind] ?? listKindMeta.todo;
  const Icon = meta.icon;
  const kindLabel =
    state.kind === "grocery" ? t("list.kind.grocery") : t("list.kind.todo");
  const sharedCount = Number(state.sharedCount ?? 0);
  const isShared =
    Boolean(state.profileId && profileId && state.profileId !== profileId) ||
    sharedCount > 0;
  const isOwner = Boolean(state.profileId && profileId && state.profileId === profileId);
  const isDeleted = Boolean(state.deleted);

  const disabled = saving || !profileId || isDeleted;

  const items = state.items;
  const counts = useMemo(() => {
    const total = items.length;
    const completed = items.filter((item) => item.completed).length;
    const remaining = total - completed;
    return { total, completed, remaining };
  }, [items]);

  const runAction = async (payload: {
    action: string;
    listId: string;
    itemIds?: string[];
  }) => {
    if (!profileId) return;
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/profiles/${profileId}/lists`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as { list?: TaskList; error?: string };
      if (!res.ok || !data.list) {
        throw new Error(data.error || t("list.error.update_failed"));
      }
      setState(normalizeList(data.list));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("list.error.update_failed")
      );
    } finally {
      setSaving(false);
    }
  };

  const toggleItem = (item: TaskListItem) => {
    runAction({ action: "toggle_items", listId: state.id, itemIds: [item.id] }).catch(
      () => {}
    );
  };

  const removeItem = (item: TaskListItem) => {
    runAction({ action: "remove_items", listId: state.id, itemIds: [item.id] }).catch(
      () => {}
    );
  };

  const clearCompleted = () => {
    runAction({ action: "clear_completed", listId: state.id }).catch(() => {});
  };

  const deleteList = () => {
    runAction({ action: "delete_list", listId: state.id }).catch(() => {});
  };

  return (
    <Card
      className={`w-full max-w-md overflow-hidden shadow-xs ${meta.accent}`}
      data-testid="tool:displayList"
    >
      <CardHeader className="border-b border-border/60 bg-transparent pb-4">
        <div className="flex items-start gap-3">
          <div
            aria-label={t("list.aria")}
            className={`inline-flex size-10 shrink-0 items-center justify-center rounded-lg border shadow-xs ${meta.iconBg}`}
          >
            <Icon className={`size-5 ${meta.iconColor}`} />
          </div>
          <div className="min-w-0 flex-1">
            <CardTitle className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 truncate">{state.name}</span>
              <Badge className={meta.badge} variant="secondary">
                {kindLabel}
              </Badge>
              {isDeleted ? (
                <Badge
                  className="border-destructive/40 bg-destructive/10 text-destructive"
                  variant="outline"
                >
                  {t("common.deleted")}
                </Badge>
              ) : isShared ? (
                <Badge className={meta.sharedBadge} variant="outline">
                  {t("common.shared")}
                </Badge>
              ) : null}
            </CardTitle>
            <CardDescription className="flex flex-wrap items-center gap-2 text-xs">
              <span>{t("list.count.open", { count: counts.remaining })}</span>
              <span className="text-muted-foreground">•</span>
              <span>{t("list.count.done", { count: counts.completed })}</span>
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-2 pt-4">
        {isDeleted ? (
          <div className="rounded-md border border-dashed bg-background/60 px-3 py-3 text-sm text-muted-foreground">
            {t("list.deleted.help")}
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-md border border-dashed bg-background/60 px-3 py-3 text-sm text-muted-foreground">
            {t("list.empty")}
          </div>
        ) : (
          items.map((item) => (
            <div
              className={`group flex items-center gap-3 rounded-md px-2 py-1.5 transition ${meta.rowHover}`}
              key={item.id}
            >
              <button
                aria-checked={item.completed}
                className="flex size-6 items-center justify-center text-muted-foreground transition group-hover:text-foreground"
                data-testid={`list:item-toggle:${item.id}`}
                disabled={disabled}
                onClick={() => toggleItem(item)}
                role="checkbox"
                type="button"
              >
                {item.completed ? (
                  <CheckCircle2 className="size-5 text-foreground/70" />
                ) : (
                  <Circle className="size-5" />
                )}
              </button>
              <div className="min-w-0 flex-1">
                <div
                  className={
                    "text-sm " +
                    (item.completed
                      ? "text-muted-foreground line-through"
                      : "text-foreground")
                  }
                >
                  {item.content}
                </div>
              </div>
              <button
                aria-label={t("list.item.remove_aria")}
                className="flex size-7 items-center justify-center rounded-md text-muted-foreground opacity-0 transition hover:text-foreground group-hover:opacity-100"
                data-testid={`list:item-remove:${item.id}`}
                disabled={disabled}
                onClick={() => removeItem(item)}
                type="button"
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          ))
        )}
      </CardContent>
      <CardFooter className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-4 text-xs text-muted-foreground">
        <div>{isDeleted ? t("list.footer.deleted") : t("list.footer.hint")}</div>
        {!isDeleted ? (
          <div className="flex items-center gap-2">
            {isOwner ? (
              <Button
                className="text-destructive hover:text-destructive"
                disabled={disabled}
                onClick={() => deleteList()}
                size="sm"
                type="button"
                variant="ghost"
              >
                {t("list.delete.button")}
              </Button>
            ) : null}
            <Button
              disabled={disabled || counts.completed === 0}
              onClick={() => clearCompleted()}
              size="sm"
              type="button"
              variant="ghost"
            >
              {t("list.clear_done.button")}
            </Button>
          </div>
        ) : null}
      </CardFooter>
      {error ? (
        <div className="border-t border-border/60 px-4 py-2 text-xs text-destructive">
          {error}
        </div>
      ) : null}
    </Card>
  );
}
