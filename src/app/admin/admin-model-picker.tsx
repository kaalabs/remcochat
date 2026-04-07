"use client";

import { useState } from "react";
import {
  Brain,
  Braces,
  CheckIcon,
  ChevronDownIcon,
  FileText,
  Layers3,
  Thermometer,
  Wrench,
} from "lucide-react";

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
import { useI18n } from "@/components/i18n-provider";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatContextWindow, listModelCapabilityBadges, type ModelCapabilities } from "@/lib/models";
import { cn } from "@/lib/utils";

const adminModelCapabilityIcons = {
  reasoning: Brain,
  tools: Wrench,
  temperature: Thermometer,
  attachments: FileText,
  structuredOutput: Braces,
} as const;

const adminModelCapabilityColors = {
  reasoning: "text-emerald-700 dark:text-emerald-300",
  tools: "text-blue-700 dark:text-blue-300",
  temperature: "text-purple-700 dark:text-purple-300",
  attachments: "text-orange-700 dark:text-orange-300",
  structuredOutput: "text-cyan-700 dark:text-cyan-300",
} as const;

export type AdminModelPickerOption = {
  id: string;
  label: string;
  description?: string;
  modelType?: string | null;
  capabilities?: ModelCapabilities;
  contextWindow?: number;
};

export function AdminModelPicker(props: {
  disabled?: boolean;
  onChange: (modelId: string) => void;
  options: AdminModelPickerOption[];
  placeholder?: string;
  triggerTestId?: string;
  value: string;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const selected = props.options.find((model) => model.id === props.value);
  const displayValue = (selected?.label ?? props.value).trim();

  return (
    <ModelSelector onOpenChange={setOpen} open={open}>
      <ModelSelectorTrigger asChild>
        <Button
          className="h-9 w-full justify-between gap-2 px-3"
          data-testid={props.triggerTestId}
          disabled={props.disabled}
          variant="outline"
        >
          <span className="truncate">
            {displayValue || props.placeholder || t("model.select.title")}
          </span>
          <ChevronDownIcon className="size-4 text-muted-foreground" />
        </Button>
      </ModelSelectorTrigger>

      <ModelSelectorContent
        className="sm:max-w-sm"
        title={t("model.select.title")}
      >
        <ModelSelectorInput placeholder={t("model.select.search")} />
        <ModelSelectorList>
          <ModelSelectorEmpty>{t("model.select.empty")}</ModelSelectorEmpty>
          <ModelSelectorGroup heading={t("model.select.group")}>
            {props.options.map((option) => (
              <ModelSelectorItem
                data-testid={`model-option:${option.id}`}
                key={option.id}
                onSelect={() => {
                  props.onChange(option.id);
                  setOpen(false);
                }}
                value={option.id}
              >
                <CheckIcon
                  className={cn(
                    "mr-2 size-4",
                    option.id === props.value ? "opacity-100" : "opacity-0",
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
                            adminModelCapabilityIcons[
                              key as keyof typeof adminModelCapabilityIcons
                            ];

                          return (
                            <Tooltip key={key}>
                              <TooltipTrigger asChild>
                                <Badge
                                  className={cn(
                                    "inline-flex h-5 min-h-5 w-5 items-center justify-center bg-transparent px-1 py-0 hover:bg-transparent",
                                    enabled ? "" : "opacity-50",
                                  )}
                                  data-enabled={enabled ? "true" : "false"}
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
                                          enabled
                                            ? adminModelCapabilityColors[
                                                key as keyof typeof adminModelCapabilityColors
                                              ]
                                            : "text-muted-foreground",
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
