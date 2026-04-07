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
import { Textarea } from "@/components/ui/textarea";
import type { ChatTitleValidationResult } from "@/lib/chat-title";

type HomeClientChatSettingsState = {
  error: string | null;
  instructionsDraft: string;
  open: boolean;
  saving: boolean;
  setInstructionsDraft: Dispatch<SetStateAction<string>>;
  setOpen: Dispatch<SetStateAction<boolean>>;
};

type HomeClientRenameChatState = {
  draft: string;
  error: string | null;
  open: boolean;
  saving: boolean;
  setDraft: Dispatch<SetStateAction<string>>;
  setError: Dispatch<SetStateAction<string | null>>;
  setOpen: Dispatch<SetStateAction<boolean>>;
  validation: ChatTitleValidationResult;
};

type HomeClientMemorizeState = {
  error: string | null;
  open: boolean;
  saving: boolean;
  setOpen: Dispatch<SetStateAction<boolean>>;
  setText: Dispatch<SetStateAction<string>>;
  text: string;
};

type HomeClientEditForkState = {
  error: string | null;
  open: boolean;
  saving: boolean;
  setOpen: Dispatch<SetStateAction<boolean>>;
  setText: Dispatch<SetStateAction<string>>;
  text: string;
};

type HomeClientChatSettingsDialogProps = {
  chatSettings: HomeClientChatSettingsState;
  onSaveChatSettings: () => void;
  t: I18nContextValue["t"];
};

type HomeClientRenameChatDialogProps = {
  canSaveRenameChat: boolean;
  onRenameChatTitle: () => void;
  renameChat: HomeClientRenameChatState;
  t: I18nContextValue["t"];
};

type HomeClientMemorizeDialogProps = {
  memorize: HomeClientMemorizeState;
  onSaveMemorize: () => void;
  t: I18nContextValue["t"];
};

type HomeClientEditForkDialogProps = {
  editFork: HomeClientEditForkState;
  onForkFromEdit: () => void;
  t: I18nContextValue["t"];
};

export function HomeClientChatSettingsDialog({
  chatSettings,
  onSaveChatSettings,
  t,
}: HomeClientChatSettingsDialogProps) {
  return (
    <Dialog onOpenChange={chatSettings.setOpen} open={chatSettings.open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("chat.settings.title")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="text-xs text-muted-foreground">
            {t("chat.settings.note")}
          </div>
          <div className="space-y-2">
            <div className="text-sm font-medium">{t("chat.instructions.label")}</div>
            <Textarea
              className="min-h-[8rem]"
              data-testid="chat:instructions"
              onChange={(event) =>
                chatSettings.setInstructionsDraft(event.target.value)
              }
              placeholder={t("chat.instructions.placeholder")}
              value={chatSettings.instructionsDraft}
            />
          </div>

          {chatSettings.error ? (
            <div className="text-sm text-destructive">{chatSettings.error}</div>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button
              data-testid="chat:settings-cancel"
              disabled={chatSettings.saving}
              onClick={() => chatSettings.setOpen(false)}
              type="button"
              variant="ghost"
            >
              {t("common.cancel")}
            </Button>
            <Button
              data-testid="chat:settings-save"
              disabled={chatSettings.saving}
              onClick={onSaveChatSettings}
              type="button"
            >
              {t("common.save")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function HomeClientRenameChatDialog({
  canSaveRenameChat,
  onRenameChatTitle,
  renameChat,
  t,
}: HomeClientRenameChatDialogProps) {
  const errorMessage = renameChat.error
    ? renameChat.error
    : !renameChat.validation.ok
      ? renameChat.validation.error
      : null;

  return (
    <Dialog onOpenChange={renameChat.setOpen} open={renameChat.open}>
      <DialogContent data-testid="chat:rename-dialog">
        <DialogHeader>
          <DialogTitle>{t("chat.rename.title")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <Input
            autoFocus
            data-testid="chat:rename-input"
            onChange={(event) => {
              renameChat.setDraft(event.target.value);
              if (renameChat.error) renameChat.setError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                renameChat.setOpen(false);
                return;
              }
              if (event.key === "Enter") {
                event.preventDefault();
                if (canSaveRenameChat) {
                  onRenameChatTitle();
                } else if (!renameChat.validation.ok) {
                  renameChat.setError(renameChat.validation.error);
                }
              }
            }}
            placeholder={t("chat.rename.placeholder")}
            value={renameChat.draft}
          />

          {errorMessage ? (
            <div className="text-sm text-destructive">{errorMessage}</div>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button
              data-testid="chat:rename-cancel"
              disabled={renameChat.saving}
              onClick={() => renameChat.setOpen(false)}
              type="button"
              variant="ghost"
            >
              {t("common.cancel")}
            </Button>
            <Button
              data-testid="chat:rename-save"
              disabled={!canSaveRenameChat}
              onClick={onRenameChatTitle}
              type="button"
            >
              {t("common.save")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function HomeClientMemorizeDialog({
  memorize,
  onSaveMemorize,
  t,
}: HomeClientMemorizeDialogProps) {
  return (
    <Dialog onOpenChange={memorize.setOpen} open={memorize.open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("memory.memorize.title")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <Textarea
            autoFocus
            className="min-h-[8rem]"
            onChange={(event) => memorize.setText(event.target.value)}
            placeholder={t("memory.memorize.placeholder")}
            value={memorize.text}
          />

          {memorize.error ? (
            <div className="text-sm text-destructive">{memorize.error}</div>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button
              disabled={memorize.saving}
              onClick={() => memorize.setOpen(false)}
              type="button"
              variant="ghost"
            >
              {t("common.cancel")}
            </Button>
            <Button
              disabled={memorize.saving || !memorize.text.trim()}
              onClick={onSaveMemorize}
              type="button"
            >
              {t("memory.memorize.save")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function HomeClientEditForkDialog({
  editFork,
  onForkFromEdit,
  t,
}: HomeClientEditForkDialogProps) {
  return (
    <Dialog onOpenChange={editFork.setOpen} open={editFork.open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("chat.edit_fork.title")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <Textarea
            autoFocus
            className="min-h-[8rem] max-h-[40vh]"
            data-testid="edit:textarea"
            onChange={(event) => editFork.setText(event.target.value)}
            value={editFork.text}
          />

          {editFork.error ? (
            <div className="text-sm text-destructive">{editFork.error}</div>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button
              data-testid="edit:cancel"
              disabled={editFork.saving}
              onClick={() => editFork.setOpen(false)}
              type="button"
              variant="ghost"
            >
              {t("common.cancel")}
            </Button>
            <Button
              data-testid="edit:fork-submit"
              disabled={editFork.saving || !editFork.text.trim()}
              onClick={onForkFromEdit}
              type="button"
            >
              {t("chat.edit_fork.submit")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
