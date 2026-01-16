"use client";

import { useEffect, useMemo, useState } from "react";
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
import { splitNoteContent } from "@/lib/notes";
import type { NotesToolOutput, QuickNote } from "@/lib/types";
import { PenLine, Trash2 } from "lucide-react";

type NotesCardProps = NotesToolOutput & {
  profileId: string;
};

type NotesState = NotesToolOutput & {
  notes: QuickNote[];
};

function normalizeOutput(output: NotesToolOutput): NotesState {
  return {
    notes: Array.isArray(output.notes) ? output.notes : [],
    totalCount: Number(output.totalCount ?? 0),
    limit: Number(output.limit ?? 0) || 6,
  };
}

function formatTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function NotesCard(props: NotesCardProps) {
  const [state, setState] = useState<NotesState>(() => normalizeOutput(props));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setState(normalizeOutput(props));
  }, [props.notes, props.totalCount, props.limit]);

  const notes = state.notes ?? [];
  const noteCount = state.totalCount || notes.length;
  const headerLabel =
    noteCount === 1 ? "1 note" : `${noteCount.toString()} notes`;

  const canDelete = Boolean(props.profileId) && !saving;

  const items = useMemo(
    () =>
      notes.map((note, index) => {
        const parts = splitNoteContent(note.content);
        return {
          ...note,
          index: index + 1,
          title: parts.title,
          body: parts.body,
        };
      }),
    [notes]
  );

  const runAction = async (payload: {
    action: string;
    noteId?: string;
    noteIndex?: number;
    content?: string;
    limit?: number;
  }) => {
    if (!props.profileId) return;
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/profiles/${props.profileId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as NotesToolOutput & { error?: string };
      if (!res.ok || !data.notes) {
        throw new Error(data.error || "Failed to update notes.");
      }
      setState(normalizeOutput(data));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update notes.");
    } finally {
      setSaving(false);
    }
  };

  const deleteNote = (noteId: string) => {
    runAction({
      action: "delete",
      noteId,
      limit: state.limit,
    }).catch(() => {});
  };

  return (
    <Card
      className="w-full max-w-md overflow-hidden border-rose-200/70 bg-rose-50/80 shadow-xs dark:border-rose-500/40 dark:bg-rose-950/30"
      data-testid="tool:displayNotes"
    >
      <CardHeader className="border-b border-border/60 bg-transparent pb-4">
        <div className="flex items-start gap-3">
          <div
            aria-label="Notes"
            className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg border border-rose-200/70 bg-rose-100/70 shadow-xs dark:border-rose-600/40 dark:bg-rose-900/40"
          >
            <PenLine className="size-5 text-rose-800/80 dark:text-rose-100/80" />
          </div>
          <div className="min-w-0 flex-1">
            <CardTitle className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 truncate">Quick notes</span>
              <Badge variant="secondary">{headerLabel}</Badge>
            </CardTitle>
            <CardDescription className="flex flex-wrap items-center gap-2 text-xs">
              <span>
                Showing latest {Math.min(notes.length, state.limit)} of{" "}
                {noteCount}
              </span>
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-2 pt-4">
        {notes.length === 0 ? (
          <div className="rounded-md border border-dashed bg-background/60 px-3 py-3 text-sm text-muted-foreground">
            No notes yet. Add one by chatting with RemcoChat.
          </div>
        ) : (
          items.map((note) => (
            <div
              className="group grid gap-1 rounded-md border border-border/60 bg-background/60 px-3 py-2 text-sm"
              key={note.id}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Badge className="px-1.5 py-0 text-[10px]" variant="outline">
                      #{note.index}
                    </Badge>
                    <span className="truncate font-semibold">
                      {note.title || "Untitled note"}
                    </span>
                  </div>
                  {note.body ? (
                    <div className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">
                      {note.body}
                    </div>
                  ) : null}
                </div>
                <Button
                  className="text-muted-foreground hover:text-foreground"
                  data-testid={`note:delete:${note.id}`}
                  disabled={!canDelete}
                  onClick={() => deleteNote(note.id)}
                  size="icon-sm"
                  type="button"
                  variant="ghost"
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
              <div className="text-[11px] text-muted-foreground">
                {formatTimestamp(note.updatedAt) || "Just now"}
              </div>
            </div>
          ))
        )}
      </CardContent>
      <CardFooter className="border-t border-border/60 pt-4 text-xs text-muted-foreground">
        Add notes with “note this: …” or ask to show notes.
      </CardFooter>
      {error ? (
        <div className="border-t border-border/60 px-4 py-2 text-xs text-destructive">
          {error}
        </div>
      ) : null}
    </Card>
  );
}
