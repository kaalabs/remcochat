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
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ModelOption } from "@/lib/models";
import { CheckIcon, ChevronDownIcon } from "lucide-react";

export type ModelPickerProps = {
  value: string;
  onChange: (modelId: string) => void;
  options: ModelOption[];
  className?: string;
  triggerTestId?: string;
};

export function ModelPicker({
  value,
  onChange,
  options,
  className,
  triggerTestId,
}: ModelPickerProps) {
  const selected = options.find((m) => m.id === value);

  return (
    <ModelSelector>
      <ModelSelectorTrigger asChild>
        <Button
          className={cn("h-8 justify-between gap-2 px-3", className)}
          data-testid={triggerTestId}
          suppressHydrationWarning
          variant="outline"
        >
          <span className="truncate">
            {selected?.label ?? value}
            {selected?.description ? (
              <span className="ml-2 text-muted-foreground">
                {selected.description}
              </span>
            ) : null}
          </span>
          <ChevronDownIcon className="size-4 text-muted-foreground" />
        </Button>
      </ModelSelectorTrigger>

      <ModelSelectorContent title="Select model">
        <ModelSelectorInput placeholder="Search models…" />
        <ModelSelectorList>
          <ModelSelectorEmpty>No models found.</ModelSelectorEmpty>
          <ModelSelectorGroup heading="Models">
            {options.map((option) => (
              <ModelSelectorItem
                data-testid={`model-option:${option.id}`}
                key={option.id}
                onSelect={() => onChange(option.id)}
                value={option.id}
              >
                <CheckIcon
                  className={cn(
                    "mr-2 size-4",
                    option.id === value ? "opacity-100" : "opacity-0"
                  )}
                />
                <ModelSelectorName>{option.label}</ModelSelectorName>
                {option.description ? (
                  <span className="text-muted-foreground text-xs">
                    {option.description}
                  </span>
                ) : null}
              </ModelSelectorItem>
            ))}
          </ModelSelectorGroup>
        </ModelSelectorList>
      </ModelSelectorContent>
    </ModelSelector>
  );
}
