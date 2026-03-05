"use client";

import {
  ModelSelector,
  ModelSelectorContent,
  ModelSelectorEmpty,
  ModelSelectorGroup,
  ModelSelectorInput,
  ModelSelectorItem,
  ModelSelectorList,
  ModelSelectorName,
  ModelSelectorTrigger,
} from "@/components/ai-elements/model-selector";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/components/i18n-provider";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  formatContextWindow,
  listModelCapabilityBadges,
  type ModelOption,
} from "@/lib/models";
import {
  Brain,
  Braces,
  CheckIcon,
  ChevronDownIcon,
  Layers3,
  FileText,
  Thermometer,
  Wrench,
} from "lucide-react";
import { useRef, useState } from "react";

export type ModelPickerProps = {
  value: string;
  onChange: (modelId: string) => void;
  options: ModelOption[];
  disabled?: boolean;
  className?: string;
  triggerTestId?: string;
};

const modelCapabilityIcons = {
  reasoning: Brain,
  tools: Wrench,
  temperature: Thermometer,
  attachments: FileText,
  structuredOutput: Braces,
} as const;

const modelCapabilityColors = {
  reasoning: "text-emerald-700 dark:text-emerald-300",
  tools: "text-blue-700 dark:text-blue-300",
  temperature: "text-purple-700 dark:text-purple-300",
  attachments: "text-orange-700 dark:text-orange-300",
  structuredOutput: "text-cyan-700 dark:text-cyan-300",
} as const;

export function ModelPicker({
  value,
  onChange,
  options,
  disabled,
  className,
  triggerTestId,
}: ModelPickerProps) {
  const { t } = useI18n();
  const selected = options.find((m) => m.id === value);
  const [open, setOpen] = useState(false);
  const focusOnCloseRef = useRef(false);
  const isDisabled = Boolean(disabled);

  const focusComposer = () => {
    window.requestAnimationFrame(() => {
      const el = document.querySelector(
        '[data-testid="composer:textarea"]',
      ) as HTMLTextAreaElement | null;
      if (!el) return;
      el.focus();
      const len = el.value.length;
      el.setSelectionRange(len, len);
    });
  };

  return (
    <ModelSelector
      onOpenChange={(next) => {
        if (isDisabled) return;
        setOpen(next);
      }}
      open={isDisabled ? false : open}
    >
      <ModelSelectorTrigger asChild>
        <Button
          className={cn("h-8 justify-between gap-2 px-3", className)}
          data-testid={triggerTestId}
          disabled={isDisabled}
          suppressHydrationWarning
          variant="outline"
        >
          <span className="truncate">{selected?.label ?? value}</span>
          <ChevronDownIcon className="size-4 text-muted-foreground" />
        </Button>
      </ModelSelectorTrigger>

      <ModelSelectorContent
        className="sm:max-w-sm"
        onCloseAutoFocus={(e) => {
          if (!focusOnCloseRef.current) return;
          e.preventDefault();
          focusOnCloseRef.current = false;
          focusComposer();
        }}
        title={t("model.select.title")}
      >
        <ModelSelectorInput placeholder={t("model.select.search")} />
        <ModelSelectorList>
          <ModelSelectorEmpty>{t("model.select.empty")}</ModelSelectorEmpty>
          <ModelSelectorGroup heading={t("model.select.group")}>
            {options.map((option) => (
              <ModelSelectorItem
                data-testid={`model-option:${option.id}`}
                key={option.id}
                onSelect={() => {
                  if (isDisabled) return;
                  onChange(option.id);
                  focusOnCloseRef.current = true;
                  setOpen(false);
                }}
                value={option.id}
              >
                <CheckIcon
                  className={cn(
                    "mr-2 size-4",
                    option.id === value ? "opacity-100" : "opacity-0",
                  )}
                />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex min-w-0 items-baseline gap-2">
                    <ModelSelectorName>{option.label}</ModelSelectorName>
                  </div>
                  {option.capabilities ? (
                    <div className="flex flex-wrap gap-1">
                      {listModelCapabilityBadges(option.capabilities).map(
                        ({ key, label, enabled }) => {
                          const CapabilityIcon =
                            modelCapabilityIcons[
                              key as keyof typeof modelCapabilityIcons
                            ];
                          return (
                            <Tooltip key={key}>
                              <TooltipTrigger asChild>
                                <Badge
                                  className={cn(
                                    "inline-flex h-5 min-h-5 w-5 items-center justify-center px-1 py-0 bg-transparent hover:bg-transparent",
                                    enabled ? "" : "opacity-50",
                                  )}
                                  data-enabled={enabled ? "true" : "false"}
                                  data-testid={`model-feature:${option.id}:${key}`}
                                  key={key}
                                  variant="outline"
                                >
                                  {enabled && CapabilityIcon ? (
                                    <span
                                      aria-label={label}
                                      className="inline-flex items-center justify-center"
                                    >
                                      <span className="sr-only">{label}</span>
                                      <CapabilityIcon
                                        className={cn(
                                          "size-4",
                                          modelCapabilityColors[
                                            key as keyof typeof modelCapabilityColors
                                          ],
                                        )}
                                        strokeWidth={2.5}
                                      />
                                    </span>
                                  ) : null}
                                </Badge>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>{label}</p>
                              </TooltipContent>
                            </Tooltip>
                          );
                        },
                      )}
                      {option.contextWindow ? (
                        <Badge
                          className="inline-flex h-5 min-h-5 items-center gap-1 px-2 py-0.5"
                          variant="outline"
                        >
                          <Layers3 className="size-4 text-cyan-700 dark:text-cyan-300" />
                          {formatContextWindow(option.contextWindow)}
                        </Badge>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </ModelSelectorItem>
            ))}
          </ModelSelectorGroup>
        </ModelSelectorList>
      </ModelSelectorContent>
    </ModelSelector>
  );
}
