"use client";

import type {
  ComponentProps,
  Dispatch,
  ReactNode,
  SetStateAction,
} from "react";
import { useMemo } from "react";

import {
  Confirmation,
  ConfirmationAccepted,
  ConfirmationAction,
  ConfirmationActions,
  ConfirmationRejected,
  ConfirmationRequest,
  ConfirmationTitle,
} from "@/components/ai-elements/confirmation";
import { ConversationScrollButton } from "@/components/ai-elements/conversation";
import { Loader } from "@/components/ai-elements/loader";
import {
  Message,
  MessageAction,
  MessageActions,
  MessageAttachment,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool";
import type { I18nContextValue } from "@/components/i18n-provider";
import { AgendaCard } from "@/components/agenda-card";
import { BashToolCard } from "@/components/bash-tool-card";
import { CurrentDateTimeCard } from "@/components/current-date-time-card";
import { ListCard } from "@/components/list-card";
import { ListsOverviewCard } from "@/components/lists-overview-card";
import { MemoryCard } from "@/components/memory-card";
import { MemoryPromptCard } from "@/components/memory-prompt-card";
import { NotesCard } from "@/components/notes-card";
import { OvNlCard } from "@/components/ov-nl-card";
import { SkillsToolCard } from "@/components/skills-tool-card";
import { TimezonesCard } from "@/components/timezones-card";
import { UrlSummaryCard } from "@/components/url-summary-card";
import { Weather } from "@/components/weather";
import { WeatherForecast } from "@/components/weather-forecast";
import type { AgendaToolOutput } from "@/domain/agenda/types";
import type { RemcoChatMessageMetadata } from "@/domain/chats/types";
import type { TaskList, TaskListOverview } from "@/domain/lists/types";
import type { ListsOverviewToolOutput } from "@/domain/lists/types";
import type { NotesToolOutput } from "@/domain/notes/types";
import type { OvNlToolOutput } from "@/domain/ov-nl/types";
import { parseAttachmentUrl } from "@/lib/attachment-url";
import { BookmarkIcon, PencilIcon } from "lucide-react";
import { type UIMessage } from "ai";
import { StickToBottom } from "use-stick-to-bottom";

import type { CurrentDateTimeToolOutput } from "@/ai/current-date-time";
import type { TimezonesToolOutput } from "@/ai/timezones";
import type { UrlSummaryToolOutput } from "@/ai/url-summary";
import type { WeatherForecastToolOutput } from "@/ai/weather";
import type { WeatherToolOutput } from "@/ai/weather";
import {
  buildHomeClientTranscriptMessages,
  shouldSuppressTranscriptAssistantText,
  sortHomeClientAssistantVariants,
  swapHomeClientAssistantVariant,
  type HomeClientTranscriptVariantsByUserMessageId,
} from "@/app/home-client-transcript-helpers";

type ApprovalAwareToolPart = {
  approval?: {
    approved?: boolean;
    id: string;
    reason?: string;
  };
  errorText?: string;
  input?: unknown;
  output?: unknown;
  state: string;
  type: string;
};

type HomeClientTranscriptProps = {
  activeProfileId: string;
  activeProfileMemoryEnabled: boolean;
  addToolApprovalResponse: (input: {
    approved: boolean;
    id: string;
    reason?: string;
  }) => PromiseLike<void> | void;
  canRespondToMemoryPrompt: boolean;
  emptyStateMessage: string;
  error: unknown;
  isTemporaryChat: boolean;
  messages: UIMessage<RemcoChatMessageMetadata>[];
  onOpenList: (list: TaskListOverview) => void;
  onRetryLatest: () => void;
  onSendMemoryDecision: (decision: "confirm" | "cancel") => void;
  onStartEditUserMessage: (
    message: UIMessage<RemcoChatMessageMetadata>
  ) => void;
  onStartMemorize: (message: UIMessage<RemcoChatMessageMetadata>) => void;
  setMessages: Dispatch<
    SetStateAction<UIMessage<RemcoChatMessageMetadata>[]>
  >;
  setVariantsByUserMessageId: Dispatch<
    SetStateAction<HomeClientTranscriptVariantsByUserMessageId>
  >;
  showThinking: boolean;
  status: string;
  stickToBottomContextRef: ComponentProps<typeof StickToBottom>["contextRef"];
  transcriptMaxWidthClass: string;
  t: I18nContextValue["t"];
  variantsByUserMessageId: HomeClientTranscriptVariantsByUserMessageId;
};

type RenderTranscriptPartInput = {
  activeProfileId: string;
  addToolApprovalResponse: HomeClientTranscriptProps["addToolApprovalResponse"];
  canRespondToMemoryPrompt: boolean;
  id: string;
  index: number;
  onOpenList: HomeClientTranscriptProps["onOpenList"];
  onSendMemoryDecision: HomeClientTranscriptProps["onSendMemoryDecision"];
  part: UIMessage<RemcoChatMessageMetadata>["parts"][number];
  suppressAssistantText: boolean;
  t: I18nContextValue["t"];
};

function toolNameFromPartType(type: string) {
  return type.startsWith("tool-") ? type.slice("tool-".length) : type;
}

function ToolCallLine(props: {
  state?: string;
  t: I18nContextValue["t"];
  type: string;
}) {
  const toolName = toolNameFromPartType(props.type);
  const showSpinner =
    props.state === "input-streaming" ||
    props.state === "input-available" ||
    props.state === "approval-requested";

  return (
    <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
      {showSpinner ? <Loader size={14} /> : null}
      {props.t("tool.calling", { toolName })}
    </div>
  );
}

function ToolApprovalBox(props: {
  addToolApprovalResponse: HomeClientTranscriptProps["addToolApprovalResponse"];
  t: I18nContextValue["t"];
  toolName: string;
  toolPart: ApprovalAwareToolPart;
}) {
  const { addToolApprovalResponse, t, toolName, toolPart } = props;

  return (
    <Confirmation approval={toolPart.approval as never} state={toolPart.state as never}>
      <ConfirmationTitle>{t("tool.status.awaiting_approval")}</ConfirmationTitle>
      <ConfirmationRequest>
        <div className="text-sm text-muted-foreground">
          {t("tool.calling", { toolName })}
        </div>
      </ConfirmationRequest>
      <ConfirmationAccepted>
        <div className="text-sm text-muted-foreground">{t("common.yes")}</div>
      </ConfirmationAccepted>
      <ConfirmationRejected>
        <div className="text-sm text-muted-foreground">{t("common.no")}</div>
      </ConfirmationRejected>
      <ConfirmationActions>
        <ConfirmationAction
          data-testid={`tool-approval:approve:${toolName}:${toolPart.approval?.id ?? "missing"}`}
          disabled={!toolPart.approval?.id}
          onClick={() => {
            if (!toolPart.approval?.id) return;
            void Promise.resolve(
              addToolApprovalResponse({
                id: toolPart.approval.id,
                approved: true,
              })
            );
          }}
        >
          {t("common.yes")}
        </ConfirmationAction>
        <ConfirmationAction
          data-testid={`tool-approval:deny:${toolName}:${toolPart.approval?.id ?? "missing"}`}
          disabled={!toolPart.approval?.id}
          onClick={() => {
            if (!toolPart.approval?.id) return;
            void Promise.resolve(
              addToolApprovalResponse({
                id: toolPart.approval.id,
                approved: false,
              })
            );
          }}
          variant="outline"
        >
          {t("common.no")}
        </ConfirmationAction>
      </ConfirmationActions>
    </Confirmation>
  );
}

function renderTranscriptPart({
  activeProfileId,
  addToolApprovalResponse,
  canRespondToMemoryPrompt,
  id,
  index,
  onOpenList,
  onSendMemoryDecision,
  part,
  suppressAssistantText,
  t,
}: RenderTranscriptPartInput): ReactNode {
  if (part.type === "file") {
    const attachmentId = parseAttachmentUrl(part.url);
    const downloadUrl =
      attachmentId && activeProfileId
        ? `/api/attachments/${attachmentId}?profileId=${encodeURIComponent(activeProfileId)}`
        : "";
    const filename = typeof part.filename === "string" ? part.filename : "";

    return (
      <div className="flex items-center gap-2" key={`${id}-${index}`}>
        <MessageAttachment data={part} />
        <div className="min-w-0">
          <div className="truncate text-sm">{filename || "Attachment"}</div>
          {downloadUrl ? (
            <a
              className="text-xs underline underline-offset-4 opacity-80 hover:opacity-100"
              data-testid={`attachment:download:${attachmentId}`}
              href={downloadUrl}
            >
              Download
            </a>
          ) : null}
        </div>
      </div>
    );
  }

  if (part.type === "text") {
    if (suppressAssistantText) return null;
    return (
      <MessageResponse className="prose-neutral dark:prose-invert" key={`${id}-${index}`}>
        {part.text}
      </MessageResponse>
    );
  }

  if (part.type === "reasoning") {
    if (suppressAssistantText) return null;
    const text = typeof part.text === "string" ? part.text : "";
    if (!text.trim()) return null;

    return (
      <Reasoning
        defaultOpen={false}
        isStreaming={part.state === "streaming"}
        key={`${id}-${index}`}
      >
        <ReasoningTrigger />
        <ReasoningContent>{text}</ReasoningContent>
      </Reasoning>
    );
  }

  if (part.type === "tool-displayMemoryAnswer") {
    switch (part.state) {
      case "input-streaming":
      case "input-available":
        return <ToolCallLine key={`${id}-${index}`} state={part.state} t={t} type={part.type} />;
      case "output-available":
        return (
          <div className="space-y-2" key={`${id}-${index}`}>
            <ToolCallLine state={part.state} t={t} type={part.type} />
            <MemoryCard
              answer={
                typeof (part.output as { answer?: unknown })?.answer === "string"
                  ? (part.output as { answer: string }).answer
                  : ""
              }
            />
          </div>
        );
      case "output-error":
        return (
          <div className="space-y-2" key={`${id}-${index}`}>
            <ToolCallLine state={part.state} t={t} type={part.type} />
            <div className="text-sm text-destructive">
              {t("tool_error.memory", { error: part.errorText })}
            </div>
          </div>
        );
      default:
        return null;
    }
  }

  if (part.type === "tool-displayMemoryPrompt") {
    const payload = part.state === "output-available" ? part.output : part.input;
    const content =
      typeof (payload as { content?: unknown })?.content === "string"
        ? (payload as { content: string }).content
        : "";

    switch (part.state) {
      case "input-streaming":
        return <ToolCallLine key={`${id}-${index}`} state={part.state} t={t} type={part.type} />;
      case "input-available":
      case "output-available":
        return (
          <div className="space-y-2" key={`${id}-${index}`}>
            <ToolCallLine state={part.state} t={t} type={part.type} />
            <MemoryPromptCard
              content={content}
              disabled={!canRespondToMemoryPrompt}
              onCancel={() => onSendMemoryDecision("cancel")}
              onConfirm={() => onSendMemoryDecision("confirm")}
            />
          </div>
        );
      case "output-error":
        return (
          <div className="space-y-2" key={`${id}-${index}`}>
            <ToolCallLine state={part.state} t={t} type={part.type} />
            <div className="text-sm text-destructive">
              {t("tool_error.memory", { error: part.errorText })}
            </div>
          </div>
        );
      default:
        return null;
    }
  }

  if (part.type === "tool-displayList") {
    switch (part.state) {
      case "input-streaming":
      case "input-available":
        return <ToolCallLine key={`${id}-${index}`} state={part.state} t={t} type={part.type} />;
      case "output-available": {
        const output = part.output as TaskList | undefined;
        if (!output || typeof output !== "object") return null;
        return (
          <div className="space-y-2" key={`${id}-${index}`}>
            <ToolCallLine state={part.state} t={t} type={part.type} />
            <ListCard list={output} profileId={activeProfileId} />
          </div>
        );
      }
      case "output-error":
        return (
          <div className="space-y-2" key={`${id}-${index}`}>
            <ToolCallLine state={part.state} t={t} type={part.type} />
            <div className="text-sm text-destructive">
              {t("tool_error.list", { error: part.errorText })}
            </div>
          </div>
        );
      default:
        return null;
    }
  }

  if (part.type === "tool-displayListsOverview") {
    switch (part.state) {
      case "input-streaming":
      case "input-available":
        return <ToolCallLine key={`${id}-${index}`} state={part.state} t={t} type={part.type} />;
      case "output-available": {
        const output = part.output as ListsOverviewToolOutput | undefined;
        if (!output || typeof output !== "object") return null;
        return (
          <div className="space-y-2" key={`${id}-${index}`}>
            <ToolCallLine state={part.state} t={t} type={part.type} />
            <ListsOverviewCard {...output} onOpenList={onOpenList} />
          </div>
        );
      }
      case "output-error":
        return (
          <div className="space-y-2" key={`${id}-${index}`}>
            <ToolCallLine state={part.state} t={t} type={part.type} />
            <div className="text-sm text-destructive">
              {t("tool_error.lists_overview", { error: part.errorText })}
            </div>
          </div>
        );
      default:
        return null;
    }
  }

  if (part.type === "tool-displayAgenda") {
    switch (part.state) {
      case "input-streaming":
      case "input-available":
        return <ToolCallLine key={`${id}-${index}`} state={part.state} t={t} type={part.type} />;
      case "output-available": {
        const output = part.output as AgendaToolOutput | undefined;
        if (!output || typeof output !== "object") return null;
        return (
          <div className="space-y-2" key={`${id}-${index}`}>
            <ToolCallLine state={part.state} t={t} type={part.type} />
            <AgendaCard output={output} />
          </div>
        );
      }
      case "output-error":
        return (
          <div className="space-y-2" key={`${id}-${index}`}>
            <ToolCallLine state={part.state} t={t} type={part.type} />
            <div className="text-sm text-destructive">
              {t("tool_error.agenda", { error: part.errorText })}
            </div>
          </div>
        );
      default:
        return null;
    }
  }

  if (part.type === "tool-displayTimezones") {
    switch (part.state) {
      case "input-streaming":
      case "input-available":
        return <ToolCallLine key={`${id}-${index}`} state={part.state} t={t} type={part.type} />;
      case "output-available": {
        const output = part.output as TimezonesToolOutput | undefined;
        if (!output || typeof output !== "object") return null;
        return (
          <div className="space-y-2" key={`${id}-${index}`}>
            <ToolCallLine state={part.state} t={t} type={part.type} />
            <TimezonesCard {...output} />
          </div>
        );
      }
      case "output-error":
        return (
          <div className="space-y-2" key={`${id}-${index}`}>
            <ToolCallLine state={part.state} t={t} type={part.type} />
            <div className="text-sm text-destructive">
              {t("tool_error.timezones", { error: part.errorText })}
            </div>
          </div>
        );
      default:
        return null;
    }
  }

  if (part.type === "tool-displayCurrentDateTime") {
    switch (part.state) {
      case "input-streaming":
      case "input-available":
        return <ToolCallLine key={`${id}-${index}`} state={part.state} t={t} type={part.type} />;
      case "output-available": {
        const output = part.output as CurrentDateTimeToolOutput | undefined;
        if (!output || typeof output !== "object") return null;
        return (
          <div className="space-y-2" key={`${id}-${index}`}>
            <ToolCallLine state={part.state} t={t} type={part.type} />
            <CurrentDateTimeCard {...output} />
          </div>
        );
      }
      case "output-error":
        return (
          <div className="space-y-2" key={`${id}-${index}`}>
            <ToolCallLine state={part.state} t={t} type={part.type} />
            <div className="text-sm text-destructive">
              {t("tool_error.current_date_time", { error: part.errorText })}
            </div>
          </div>
        );
      default:
        return null;
    }
  }

  if (
    part.type === "tool-displayUrlSummary" ||
    part.type === "tool-summarizeURL"
  ) {
    switch (part.state) {
      case "input-streaming":
      case "input-available":
        return <ToolCallLine key={`${id}-${index}`} state={part.state} t={t} type={part.type} />;
      case "output-available": {
        const output = part.output as UrlSummaryToolOutput | undefined;
        if (!output || typeof output !== "object") return null;
        return (
          <div className="space-y-2" key={`${id}-${index}`}>
            <ToolCallLine state={part.state} t={t} type={part.type} />
            <UrlSummaryCard {...output} />
          </div>
        );
      }
      case "output-error":
        return (
          <div className="space-y-2" key={`${id}-${index}`}>
            <ToolCallLine state={part.state} t={t} type={part.type} />
            <div className="text-sm text-destructive">
              {t("tool_error.url_summary", { error: part.errorText })}
            </div>
          </div>
        );
      default:
        return null;
    }
  }

  if (part.type === "tool-displayNotes") {
    switch (part.state) {
      case "input-streaming":
      case "input-available":
        return <ToolCallLine key={`${id}-${index}`} state={part.state} t={t} type={part.type} />;
      case "output-available": {
        const output = part.output as NotesToolOutput | undefined;
        if (!output || typeof output !== "object") return null;
        return (
          <div className="space-y-2" key={`${id}-${index}`}>
            <ToolCallLine state={part.state} t={t} type={part.type} />
            <NotesCard
              {...output}
              profileId={activeProfileId}
              sourceKey={`${id}:${index}`}
            />
          </div>
        );
      }
      case "output-error":
        return (
          <div className="space-y-2" key={`${id}-${index}`}>
            <ToolCallLine state={part.state} t={t} type={part.type} />
            <div className="text-sm text-destructive">
              {t("tool_error.notes", { error: part.errorText })}
            </div>
          </div>
        );
      default:
        return null;
    }
  }

  if (part.type === "tool-ovNlGateway") {
    switch (part.state) {
      case "input-streaming":
      case "input-available":
        return <ToolCallLine key={`${id}-${index}`} state={part.state} t={t} type={part.type} />;
      case "output-available": {
        const output = part.output as OvNlToolOutput | undefined;
        if (!output || typeof output !== "object") return null;
        return (
          <div className="space-y-2" key={`${id}-${index}`}>
            <ToolCallLine state={part.state} t={t} type={part.type} />
            <OvNlCard output={output} />
          </div>
        );
      }
      case "output-error":
        return (
          <div className="space-y-2" key={`${id}-${index}`}>
            <ToolCallLine state={part.state} t={t} type={part.type} />
            <div className="text-sm text-destructive">
              {t("tool_error.ov_nl", { error: part.errorText })}
            </div>
          </div>
        );
      default:
        return null;
    }
  }

  if (part.type === "tool-bash") {
    const toolPart = part as ApprovalAwareToolPart;
    const input = part.input as { command?: unknown } | undefined;
    const command = typeof input?.command === "string" ? input.command : "";

    switch (part.state) {
      case "input-streaming":
        return <ToolCallLine key={`${id}-${index}`} state={part.state} t={t} type={part.type} />;
      case "input-available":
        return (
          <div className="space-y-2" key={`${id}-${index}`}>
            <ToolCallLine state={part.state} t={t} type={part.type} />
            <BashToolCard
              command={command}
              kind="bash"
              result={{ stdout: "", stderr: "", exitCode: -1 }}
              state="running"
            />
          </div>
        );
      case "output-available": {
        const output = part.output as
          | {
              exitCode?: unknown;
              stderr?: unknown;
              stdout?: unknown;
            }
          | undefined;
        const exitCodeRaw = output?.exitCode;
        const exitCode =
          typeof exitCodeRaw === "number"
            ? exitCodeRaw
            : Number(exitCodeRaw ?? -1);
        const running = exitCode === -1;

        return (
          <div className="space-y-2" key={`${id}-${index}`}>
            <ToolCallLine state={part.state} t={t} type={part.type} />
            <BashToolCard
              command={command}
              kind="bash"
              result={{
                stdout: typeof output?.stdout === "string" ? output.stdout : "",
                stderr: typeof output?.stderr === "string" ? output.stderr : "",
                exitCode,
              }}
              state={running ? "running" : "ok"}
            />
          </div>
        );
      }
      case "approval-requested":
      case "approval-responded":
      case "output-denied":
        return (
          <div className="space-y-2" key={`${id}-${index}`}>
            <ToolCallLine state={part.state} t={t} type={part.type} />
            <BashToolCard
              command={command}
              errorText={part.state === "output-denied" ? t("tool.status.denied") : undefined}
              kind="bash"
              result={{ stdout: "", stderr: "", exitCode: -1 }}
              state={part.state === "output-denied" ? "error" : "running"}
            />
            <ToolApprovalBox
              addToolApprovalResponse={addToolApprovalResponse}
              t={t}
              toolName="bash"
              toolPart={toolPart}
            />
          </div>
        );
      case "output-error":
        return (
          <div className="space-y-2" key={`${id}-${index}`}>
            <ToolCallLine state={part.state} t={t} type={part.type} />
            <BashToolCard
              command={command}
              errorText={part.errorText}
              kind="bash"
              state="error"
            />
          </div>
        );
      default:
        return null;
    }
  }

  if (part.type === "tool-readFile") {
    const input = part.input as { path?: unknown } | undefined;
    const filePath = typeof input?.path === "string" ? input.path : "";

    switch (part.state) {
      case "input-streaming":
        return <ToolCallLine key={`${id}-${index}`} state={part.state} t={t} type={part.type} />;
      case "input-available":
        return (
          <div className="space-y-2" key={`${id}-${index}`}>
            <ToolCallLine state={part.state} t={t} type={part.type} />
            <BashToolCard kind="readFile" path={filePath} state="running" />
          </div>
        );
      case "output-available": {
        const output = part.output as { content?: unknown } | undefined;
        return (
          <div className="space-y-2" key={`${id}-${index}`}>
            <ToolCallLine state={part.state} t={t} type={part.type} />
            <BashToolCard
              content={typeof output?.content === "string" ? output.content : ""}
              kind="readFile"
              path={filePath}
              state="ok"
            />
          </div>
        );
      }
      case "output-error":
        return (
          <div className="space-y-2" key={`${id}-${index}`}>
            <ToolCallLine state={part.state} t={t} type={part.type} />
            <BashToolCard
              errorText={part.errorText}
              kind="readFile"
              path={filePath}
              state="error"
            />
          </div>
        );
      default:
        return null;
    }
  }

  if (part.type === "tool-writeFile") {
    const toolPart = part as ApprovalAwareToolPart;
    const input = part.input as { content?: unknown; path?: unknown } | undefined;
    const filePath = typeof input?.path === "string" ? input.path : "";
    const content = typeof input?.content === "string" ? input.content : "";

    switch (part.state) {
      case "input-streaming":
        return <ToolCallLine key={`${id}-${index}`} state={part.state} t={t} type={part.type} />;
      case "input-available":
        return (
          <div className="space-y-2" key={`${id}-${index}`}>
            <ToolCallLine state={part.state} t={t} type={part.type} />
            <BashToolCard
              contentLength={content.length}
              kind="writeFile"
              path={filePath}
              state="running"
            />
          </div>
        );
      case "output-available": {
        const output = part.output as { success?: unknown } | undefined;
        return (
          <div className="space-y-2" key={`${id}-${index}`}>
            <ToolCallLine state={part.state} t={t} type={part.type} />
            <BashToolCard
              contentLength={content.length}
              kind="writeFile"
              path={filePath}
              state="ok"
              success={output?.success === true}
            />
          </div>
        );
      }
      case "approval-requested":
      case "approval-responded":
      case "output-denied":
        return (
          <div className="space-y-2" key={`${id}-${index}`}>
            <ToolCallLine state={part.state} t={t} type={part.type} />
            <BashToolCard
              contentLength={content.length}
              errorText={part.state === "output-denied" ? t("tool.status.denied") : undefined}
              kind="writeFile"
              path={filePath}
              state={part.state === "output-denied" ? "error" : "running"}
            />
            <ToolApprovalBox
              addToolApprovalResponse={addToolApprovalResponse}
              t={t}
              toolName="writeFile"
              toolPart={toolPart}
            />
          </div>
        );
      case "output-error":
        return (
          <div className="space-y-2" key={`${id}-${index}`}>
            <ToolCallLine state={part.state} t={t} type={part.type} />
            <BashToolCard
              contentLength={content.length}
              errorText={part.errorText}
              kind="writeFile"
              path={filePath}
              state="error"
            />
          </div>
        );
      default:
        return null;
    }
  }

  if (part.type === "tool-skillsActivate") {
    const input = part.input as { name?: unknown } | undefined;
    const output = part.output as
      | { body?: unknown; frontmatter?: unknown; name?: unknown }
      | undefined;
    const inputName = typeof input?.name === "string" ? input.name : "";
    const outputName = typeof output?.name === "string" ? output.name : "";
    const skillName = outputName || inputName;
    const body = typeof output?.body === "string" ? output.body : "";

    switch (part.state) {
      case "input-streaming":
        return <ToolCallLine key={`${id}-${index}`} state={part.state} t={t} type={part.type} />;
      case "input-available":
        return (
          <div className="space-y-2" key={`${id}-${index}`}>
            <ToolCallLine state={part.state} t={t} type={part.type} />
            <SkillsToolCard
              body=""
              frontmatter={{}}
              kind="activate"
              skillName={skillName}
              state="running"
            />
          </div>
        );
      case "output-available":
        return (
          <div className="space-y-2" key={`${id}-${index}`}>
            <ToolCallLine state={part.state} t={t} type={part.type} />
            <SkillsToolCard
              body={body}
              frontmatter={output?.frontmatter}
              kind="activate"
              skillName={skillName}
              state="ok"
            />
          </div>
        );
      case "output-error":
        return (
          <div className="space-y-2" key={`${id}-${index}`}>
            <ToolCallLine state={part.state} t={t} type={part.type} />
            <SkillsToolCard
              errorText={part.errorText}
              kind="activate"
              skillName={skillName}
              state="error"
            />
          </div>
        );
      default:
        return null;
    }
  }

  if (part.type === "tool-skillsReadResource") {
    const input = part.input as { name?: unknown; path?: unknown } | undefined;
    const output = part.output as
      | { content?: unknown; name?: unknown; path?: unknown }
      | undefined;
    const inputName = typeof input?.name === "string" ? input.name : "";
    const inputPath = typeof input?.path === "string" ? input.path : "";
    const outputName = typeof output?.name === "string" ? output.name : "";
    const outputPath = typeof output?.path === "string" ? output.path : "";
    const content = typeof output?.content === "string" ? output.content : "";
    const skillName = outputName || inputName;
    const resourcePath = outputPath || inputPath;

    switch (part.state) {
      case "input-streaming":
        return <ToolCallLine key={`${id}-${index}`} state={part.state} t={t} type={part.type} />;
      case "input-available":
        return (
          <div className="space-y-2" key={`${id}-${index}`}>
            <ToolCallLine state={part.state} t={t} type={part.type} />
            <SkillsToolCard
              content=""
              kind="readResource"
              resourcePath={resourcePath}
              skillName={skillName}
              state="running"
            />
          </div>
        );
      case "output-available":
        return (
          <div className="space-y-2" key={`${id}-${index}`}>
            <ToolCallLine state={part.state} t={t} type={part.type} />
            <SkillsToolCard
              content={content}
              kind="readResource"
              resourcePath={resourcePath}
              skillName={skillName}
              state="ok"
            />
          </div>
        );
      case "output-error":
        return (
          <div className="space-y-2" key={`${id}-${index}`}>
            <ToolCallLine state={part.state} t={t} type={part.type} />
            <SkillsToolCard
              errorText={part.errorText}
              kind="readResource"
              resourcePath={resourcePath}
              skillName={skillName}
              state="error"
            />
          </div>
        );
      default:
        return null;
    }
  }

  if (part.type === "tool-displayWeather") {
    switch (part.state) {
      case "input-streaming":
      case "input-available":
        return <ToolCallLine key={`${id}-${index}`} state={part.state} t={t} type={part.type} />;
      case "output-available":
        return (
          <div className="space-y-2" key={`${id}-${index}`}>
            <ToolCallLine state={part.state} t={t} type={part.type} />
            <Weather {...(part.output as WeatherToolOutput)} />
          </div>
        );
      case "output-error":
        return (
          <div className="space-y-2" key={`${id}-${index}`}>
            <ToolCallLine state={part.state} t={t} type={part.type} />
            <div className="text-sm text-destructive">
              {t("tool_error.weather", { error: part.errorText })}
            </div>
          </div>
        );
      default:
        return null;
    }
  }

  if (part.type === "tool-displayWeatherForecast") {
    switch (part.state) {
      case "input-streaming":
      case "input-available":
        return <ToolCallLine key={`${id}-${index}`} state={part.state} t={t} type={part.type} />;
      case "output-available":
        return (
          <div className="space-y-2" key={`${id}-${index}`}>
            <ToolCallLine state={part.state} t={t} type={part.type} />
            <WeatherForecast {...(part.output as WeatherForecastToolOutput)} />
          </div>
        );
      case "output-error":
        return (
          <div className="space-y-2" key={`${id}-${index}`}>
            <ToolCallLine state={part.state} t={t} type={part.type} />
            <div className="text-sm text-destructive">
              {t("tool_error.weather_forecast", { error: part.errorText })}
            </div>
          </div>
        );
      default:
        return null;
    }
  }

  if (
    typeof part.type === "string" &&
    part.type.startsWith("tool-") &&
    typeof (part as { state?: unknown }).state === "string"
  ) {
    const toolPart = part as ApprovalAwareToolPart;
    const toolName = toolNameFromPartType(toolPart.type);

    return (
      <Tool data-testid={`tool:${toolName}`} key={`${id}-${index}`}>
        <ToolHeader
          title={t("tool.calling", { toolName })}
          type={toolPart.type as never}
          state={toolPart.state as never}
        />
        <ToolContent>
          <ToolInput input={toolPart.input} />
          <ToolApprovalBox
            addToolApprovalResponse={addToolApprovalResponse}
            t={t}
            toolName={toolName}
            toolPart={toolPart}
          />
          <ToolOutput
            errorText={toolPart.errorText ?? ""}
            output={toolPart.output}
          />
        </ToolContent>
      </Tool>
    );
  }

  return null;
}

export function HomeClientTranscript({
  activeProfileId,
  activeProfileMemoryEnabled,
  addToolApprovalResponse,
  canRespondToMemoryPrompt,
  emptyStateMessage,
  error,
  isTemporaryChat,
  messages,
  onOpenList,
  onRetryLatest,
  onSendMemoryDecision,
  onStartEditUserMessage,
  onStartMemorize,
  setMessages,
  setVariantsByUserMessageId,
  showThinking,
  status,
  stickToBottomContextRef,
  transcriptMaxWidthClass,
  t,
  variantsByUserMessageId,
}: HomeClientTranscriptProps) {
  const renderMessages = useMemo(
    () => buildHomeClientTranscriptMessages(messages),
    [messages]
  );

  return (
    <StickToBottom
      className="relative min-h-0 flex-1 overflow-hidden"
      contextRef={stickToBottomContextRef}
      data-testid="chat:transcript"
      initial="instant"
      resize={status === "submitted" || status === "streaming" ? "instant" : "smooth"}
    >
      <StickToBottom.Content className="w-full py-4 pl-[max(1rem,env(safe-area-inset-left,0px))] pr-[max(1rem,env(safe-area-inset-right,0px))] sm:py-6 sm:pl-[max(1.375rem,env(safe-area-inset-left,0px))] sm:pr-[max(1.5rem,env(safe-area-inset-right,0px))] md:py-8 md:pl-[max(1.75rem,env(safe-area-inset-left,0px))] md:pr-[max(2rem,env(safe-area-inset-right,0px))]">
        <div
          className={
            "mr-auto ml-1 flex w-[calc(100%-0.25rem)] flex-col gap-6 " +
            transcriptMaxWidthClass +
            " sm:ml-2 sm:w-[calc(100%-0.5rem)] md:ml-2.5 md:w-[calc(100%-0.625rem)] lg:ml-3 lg:w-[calc(100%-0.75rem)]"
          }
        >
          {messages.length === 0 ? (
            <div className="text-center text-sm text-muted-foreground">
              {emptyStateMessage}
            </div>
          ) : null}

          {renderMessages.map(({ id, role, parts, metadata, inferredTurnUserMessageId }) => {
            const suppressAssistantText =
              role === "assistant" &&
              shouldSuppressTranscriptAssistantText(parts);
            const turnUserMessageId =
              role === "assistant" ? inferredTurnUserMessageId : null;
            const variants = turnUserMessageId
              ? variantsByUserMessageId[turnUserMessageId] ?? []
              : [];
            const currentMessage = {
              id,
              role,
              parts,
              metadata,
            } satisfies UIMessage<RemcoChatMessageMetadata>;
            const sortedVariants =
              role === "assistant"
                ? sortHomeClientAssistantVariants(currentMessage, variants)
                : [];
            const variantIndex =
              sortedVariants.length > 0
                ? sortedVariants.findIndex((message) => message.id === id)
                : -1;
            const canPageVariants =
              role === "assistant" &&
              Boolean(turnUserMessageId) &&
              sortedVariants.length > 1 &&
              variantIndex >= 0;

            const selectVariant = (targetId: string) => {
              if (!turnUserMessageId) return;
              if (targetId === id) return;
              const next = swapHomeClientAssistantVariant({
                currentMessage,
                messages,
                targetId,
                turnUserMessageId,
                variantsByUserMessageId,
              });
              setMessages(next.messages);
              setVariantsByUserMessageId(next.variantsByUserMessageId);
            };

            return (
              <Message data-testid={`message:${role}:${id}`} from={role} key={id}>
                <MessageContent>
                  {parts.map((part, index) =>
                    renderTranscriptPart({
                      activeProfileId,
                      addToolApprovalResponse,
                      canRespondToMemoryPrompt,
                      id,
                      index,
                      onOpenList,
                      onSendMemoryDecision,
                      part,
                      suppressAssistantText,
                      t,
                    })
                  )}
                </MessageContent>

                {role === "assistant" ? (() => {
                  const usage = metadata?.usage;
                  const reasoningTokens =
                    typeof usage?.outputTokenDetails?.reasoningTokens === "number"
                      ? usage.outputTokenDetails.reasoningTokens
                      : typeof usage?.reasoningTokens === "number"
                        ? usage.reasoningTokens
                        : 0;
                  if (!reasoningTokens) return null;
                  return (
                    <div className="text-xs text-muted-foreground">
                      {" "}
                      {t("reasoning.tokens", { count: reasoningTokens })}
                    </div>
                  );
                })() : null}

                {role === "user" ? (
                  <MessageActions className="justify-end opacity-60 transition-opacity hover:opacity-100 group-hover:opacity-100">
                    <MessageAction
                      aria-label={t("message.action.memorize")}
                      data-testid={`message-action:memorize:${id}`}
                      disabled={
                        status !== "ready" || isTemporaryChat || !activeProfileMemoryEnabled
                      }
                      onClick={() => onStartMemorize(currentMessage)}
                      tooltip={t("message.action.memorize")}
                    >
                      <BookmarkIcon />
                    </MessageAction>
                    <MessageAction
                      aria-label={t("message.action.edit")}
                      data-testid={`message-action:edit:${id}`}
                      disabled={status !== "ready" || isTemporaryChat}
                      onClick={() => onStartEditUserMessage(currentMessage)}
                      tooltip={t("message.action.edit_fork")}
                    >
                      <PencilIcon />
                    </MessageAction>
                  </MessageActions>
                ) : null}

                {canPageVariants ? (
                  <div
                    className="flex items-center justify-end gap-2 text-xs text-muted-foreground"
                    data-testid={`variants:pager:${id}`}
                  >
                    <button
                      className="rounded-md border px-2 py-1 hover:bg-accent"
                      data-testid={`variants:prev:${id}`}
                      onClick={() => {
                        const previousIndex =
                          variantIndex > 0 ? variantIndex - 1 : sortedVariants.length - 1;
                        selectVariant(sortedVariants[previousIndex]!.id);
                      }}
                      type="button"
                    >
                      {t("common.prev")}
                    </button>
                    <div>
                      {variantIndex + 1} / {sortedVariants.length}
                    </div>
                    <button
                      className="rounded-md border px-2 py-1 hover:bg-accent"
                      data-testid={`variants:next:${id}`}
                      onClick={() => {
                        const nextIndex =
                          variantIndex < sortedVariants.length - 1 ? variantIndex + 1 : 0;
                        selectVariant(sortedVariants[nextIndex]!.id);
                      }}
                      type="button"
                    >
                      {t("common.next")}
                    </button>
                  </div>
                ) : null}
              </Message>
            );
          })}

          {showThinking ? (
            <Message data-testid="chat:thinking-indicator" from="assistant">
              <MessageContent>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader size={14} />
                  <span>{t("reasoning.thinking")}</span>
                </div>
              </MessageContent>
            </Message>
          ) : null}

          {error ? (
            <div className="rounded-md border bg-card p-4 text-sm text-muted-foreground">
              <div>{t("common.something_went_wrong")}</div>
              <button
                className="mt-2 underline underline-offset-4"
                onClick={onRetryLatest}
                type="button"
              >
                {t("common.retry")}
              </button>
            </div>
          ) : null}
        </div>
      </StickToBottom.Content>
      <ConversationScrollButton />
    </StickToBottom>
  );
}
