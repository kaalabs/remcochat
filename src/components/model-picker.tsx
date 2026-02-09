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
import { cn } from "@/lib/utils";
import { listModelCapabilityBadges, type ModelOption } from "@/lib/models";
import { CheckIcon, ChevronDownIcon } from "lucide-react";
import { useRef, useState } from "react";

export type ModelPickerProps = {
  value: string;
  onChange: (modelId: string) => void;
  options: ModelOption[];
  disabled?: boolean;
  className?: string;
  triggerTestId?: string;
};

export function ModelPicker({
  value,
  onChange,
  options,
  disabled,
  className,
  triggerTestId,
}: ModelPickerProps) {
  const selected = options.find((m) => m.id === value);
  const [open, setOpen] = useState(false);
  const focusOnCloseRef = useRef(false);
  const isDisabled = Boolean(disabled);

  const focusComposer = () => {
    window.requestAnimationFrame(() => {
      const el = document.querySelector(
        '[data-testid="composer:textarea"]'
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
        onCloseAutoFocus={(e) => {
          if (!focusOnCloseRef.current) return;
          e.preventDefault();
          focusOnCloseRef.current = false;
          focusComposer();
        }}
        title="Select model"
      >
        <ModelSelectorInput placeholder="Search models…" />
        <ModelSelectorList>
          <ModelSelectorEmpty>No models found.</ModelSelectorEmpty>
          <ModelSelectorGroup heading="Models">
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
                    option.id === value ? "opacity-100" : "opacity-0"
                  )}
                />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex min-w-0 items-baseline gap-2">
                    <ModelSelectorName>{option.label}</ModelSelectorName>
                    {option.description ? (
                      <span className="truncate text-muted-foreground text-xs">
                        {option.description}
                      </span>
                    ) : null}
                  </div>
                  {option.capabilities ? (
                    <div className="flex flex-wrap gap-1">
                      {listModelCapabilityBadges(option.capabilities).map(
                        ({ key, label, enabled }) => (
                          <Badge
                            className={cn(
                              "pointer-events-none px-1.5 py-0 text-[10px]",
                              enabled ? "" : "opacity-50"
                            )}
                            data-enabled={enabled ? "true" : "false"}
                            data-testid={`model-feature:${option.id}:${key}`}
                            key={key}
                            variant={enabled ? "secondary" : "outline"}
                          >
                            {label}
                          </Badge>
                        )
                      )}
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
