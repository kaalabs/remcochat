"use client";

import type { ComponentProps } from "react";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import {
  PromptInput,
  PromptInputActionAddAttachments,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuTrigger,
  PromptInputAttachment,
  PromptInputAttachments,
  PromptInputSubmit,
  PromptInputTextarea,
  usePromptInputAttachments,
} from "@/components/ai-elements/prompt-input";
import type { I18nContextValue } from "@/components/i18n-provider";
import type { RemcoChatMessageMetadata } from "@/domain/chats/types";
import type { ReasoningEffortChoice } from "@/lib/reasoning-effort";
import { RotateCcwIcon, SlidersHorizontalIcon } from "lucide-react";
import type { UIMessage } from "ai";

function ComposerAttachmentsCountBridge(props: {
  onCountChange: (count: number) => void;
}) {
  const attachments = usePromptInputAttachments();
  const onCountChange = props.onCountChange;

  useEffect(() => {
    onCountChange(attachments.files.length);
  }, [attachments.files.length, onCountChange]);

  return null;
}

type HomeClientComposerProps = {
  attachmentUploadError: string | null;
  canManageActiveChat: boolean;
  canSend: boolean;
  chatRequestBodyAvailable: boolean;
  handleAttachmentCountChange: (count: number) => void;
  handleAttachmentError: (message: string) => void;
  handleComposerKeyDown: ComponentProps<typeof PromptInputTextarea>["onKeyDown"];
  handlePromptSubmit: ComponentProps<typeof PromptInput>["onSubmit"];
  input: string;
  isTemporaryChat: boolean;
  messages: UIMessage<RemcoChatMessageMetadata>[];
  onOpenChatSettings: () => void;
  onRegenerateLatest: () => void;
  onSetInput: (value: string) => void;
  onSetReasoningEffort: (effort: ReasoningEffortChoice) => void;
  onStop: () => void;
  reasoningEffort: ReasoningEffortChoice;
  reasoningOptions: ReasoningEffortChoice[];
  selectedModelSupportsReasoning: boolean;
  showChatSettingsButton: boolean;
  status: ComponentProps<typeof PromptInputSubmit>["status"];
  t: I18nContextValue["t"];
  transcriptMaxWidthClass: string;
};

export function getHomeClientComposerClassName(
  isTemporaryChat: boolean
): string {
  return (
    "composer-scale bg-sidebar " +
    (isTemporaryChat
      ? "[&_[data-slot=input-group]]:!border-destructive [&_[data-slot=input-group]]:bg-destructive/5"
      : "")
  );
}

export function shouldShowHomeClientComposerRegenerate(input: {
  messages: UIMessage<RemcoChatMessageMetadata>[];
  status: string;
}): boolean {
  return (
    input.status === "ready" &&
    input.messages.some((message) => message.role === "user")
  );
}

export function shouldShowHomeClientComposerStop(status: string): boolean {
  return status === "submitted" || status === "streaming";
}

export function shouldShowHomeClientComposerReasoningOptions(input: {
  reasoningOptions: ReasoningEffortChoice[];
  selectedModelSupportsReasoning: boolean;
}): boolean {
  return input.selectedModelSupportsReasoning && input.reasoningOptions.length > 0;
}

export function getHomeClientComposerReasoningChoices(
  reasoningOptions: ReasoningEffortChoice[]
): ReasoningEffortChoice[] {
  return ["auto", ...reasoningOptions];
}

export function HomeClientComposer({
  attachmentUploadError,
  canManageActiveChat,
  canSend,
  chatRequestBodyAvailable,
  handleAttachmentCountChange,
  handleAttachmentError,
  handleComposerKeyDown,
  handlePromptSubmit,
  input,
  isTemporaryChat,
  messages,
  onOpenChatSettings,
  onRegenerateLatest,
  onSetInput,
  onSetReasoningEffort,
  onStop,
  reasoningEffort,
  reasoningOptions,
  selectedModelSupportsReasoning,
  showChatSettingsButton,
  status,
  t,
  transcriptMaxWidthClass,
}: HomeClientComposerProps) {
  const composerStatus = status ?? "ready";
  const showRegenerate = shouldShowHomeClientComposerRegenerate({
    messages,
    status: composerStatus,
  });
  const showStop = shouldShowHomeClientComposerStop(composerStatus);
  const showReasoningOptions = shouldShowHomeClientComposerReasoningOptions({
    reasoningOptions,
    selectedModelSupportsReasoning,
  });
  const reasoningChoices = getHomeClientComposerReasoningChoices(reasoningOptions);

  return (
    <div className="shrink-0 bg-transparent pb-[calc(0.75rem+max(var(--rc-safe-bottom),var(--rc-keyboard-inset)))] pl-[max(1rem,env(safe-area-inset-left,0px))] pr-[max(1rem,env(safe-area-inset-right,0px))] pt-3 sm:pl-[max(1.375rem,env(safe-area-inset-left,0px))] sm:pr-[max(1.5rem,env(safe-area-inset-right,0px))] md:pb-[calc(1rem+max(var(--rc-safe-bottom),var(--rc-keyboard-inset)))] md:pl-[max(1.75rem,env(safe-area-inset-left,0px))] md:pr-[max(2rem,env(safe-area-inset-right,0px))] md:pt-4">
      <div
        className={
          "mr-auto ml-1 w-[calc(100%-0.25rem)] " +
          transcriptMaxWidthClass +
          " sm:ml-2 sm:w-[calc(100%-0.5rem)] md:ml-2.5 md:w-[calc(100%-0.625rem)] lg:ml-3 lg:w-[calc(100%-0.75rem)]"
        }
      >
        <PromptInput
          accept="text/plain,text/markdown,text/csv,application/json,application/pdf,.txt,.md,.markdown,.csv,.json,.pdf"
          className={getHomeClientComposerClassName(isTemporaryChat)}
          convertBlobUrlsToDataUrls={false}
          maxFileSize={2_000_000}
          maxFiles={3}
          multiple
          onError={(error) => handleAttachmentError(error.message)}
          onSubmit={handlePromptSubmit}
        >
          <ComposerAttachmentsCountBridge onCountChange={handleAttachmentCountChange} />
          <PromptInputAttachments>
            {(attachment) => <PromptInputAttachment data={attachment} />}
          </PromptInputAttachments>
          {attachmentUploadError ? (
            <div className="px-3 pb-2 text-sm text-destructive">
              {attachmentUploadError}
            </div>
          ) : null}
          <PromptInputTextarea
            className="max-h-[30vh] overflow-y-auto"
            data-testid="composer:textarea"
            name="message"
            onChange={(event) => onSetInput(event.target.value)}
            onKeyDown={handleComposerKeyDown}
            value={input}
          />

          <div className="flex items-center justify-end gap-2 pt-2 pr-2">
            {showRegenerate ? (
              <Button
                aria-label={t("composer.regenerate.aria")}
                className="h-9 w-9 px-0"
                data-testid="composer:regenerate"
                onClick={onRegenerateLatest}
                title={t("composer.regenerate.aria")}
                type="button"
                variant="outline"
              >
                <RotateCcwIcon className="size-4" />
              </Button>
            ) : null}

            {showStop ? (
              <button
                className="rounded-md border px-3 py-2 text-sm hover:bg-accent"
                data-testid="composer:stop"
                onClick={onStop}
                type="button"
              >
                {t("common.stop")}
              </button>
            ) : null}

            <PromptInputSubmit
              className="h-16 w-16 dark:text-white"
              data-testid="composer:submit"
              disabled={!canSend || !chatRequestBodyAvailable}
              status={composerStatus}
              variant={isTemporaryChat ? "destructive" : "default"}
            />
          </div>

          <div className="mt-2 flex min-h-10 basis-full items-center justify-between gap-2 border-t px-2 pt-2 pb-3">
            <div className="flex min-w-0 items-center gap-2">
              <PromptInputActionMenu>
                <PromptInputActionMenuTrigger
                  aria-label={t("composer.attachments.menu.aria")}
                  disabled={status !== "ready"}
                  title={t("composer.attachments.menu.title")}
                />
                <PromptInputActionMenuContent>
                  <PromptInputActionAddAttachments />
                </PromptInputActionMenuContent>
              </PromptInputActionMenu>

              {showReasoningOptions ? (
                <div className="min-w-0 overflow-x-auto">
                  <ButtonGroup aria-label={t("composer.reasoning_level.aria")}>
                    {reasoningChoices.map((option) => {
                      const label =
                        option === "auto"
                          ? t("composer.reasoning_level.auto")
                          : option === "minimal"
                            ? t("composer.reasoning_level.minimal")
                            : option === "medium"
                              ? t("composer.reasoning_level.medium")
                              : option === "high"
                                ? t("composer.reasoning_level.high")
                                : t("composer.reasoning_level.low");

                      const selected = reasoningEffort === option;
                      const dim = !canSend || !chatRequestBodyAvailable;
                      return (
                        <Button
                          aria-pressed={selected}
                          className={
                            "h-8 min-w-12 px-2 text-[11px] " +
                            (selected
                              ? "relative z-10 shadow-none " +
                                (canSend && chatRequestBodyAvailable
                                  ? "font-semibold "
                                  : "")
                              : "") +
                            (selected && dim
                              ? "bg-primary/50 hover:bg-primary/50"
                              : "") +
                            (dim
                              ? "text-foreground/60 hover:text-foreground/60"
                              : selected
                                ? "text-foreground hover:text-foreground"
                                : "")
                          }
                          data-selected={selected ? "true" : "false"}
                          data-testid={`reasoning-option:${option}`}
                          disabled={status !== "ready"}
                          key={option}
                          onClick={() => onSetReasoningEffort(option)}
                          type="button"
                          variant={selected ? "default" : "outline"}
                        >
                          {label}
                        </Button>
                      );
                    })}
                  </ButtonGroup>
                </div>
              ) : null}
            </div>

            {showChatSettingsButton ? (
              <Button
                aria-label={t("chat.settings.title")}
                className="h-9 w-9 px-0"
                data-testid="chat:settings-open"
                disabled={status !== "ready" || !canManageActiveChat}
                onClick={onOpenChatSettings}
                title={t("chat.settings.title")}
                type="button"
                variant="outline"
              >
                <SlidersHorizontalIcon className="size-4" />
              </Button>
            ) : (
              <div aria-hidden="true" className="size-9" />
            )}
          </div>
        </PromptInput>
      </div>
    </div>
  );
}
