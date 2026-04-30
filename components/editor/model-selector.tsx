"use client";

import { Check, ChevronDown, Sparkles, Eye } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AI_MODELS, AIModel } from "@/lib/models";

interface ModelSelectorProps {
  selectedModel: string;
  onModelChange: (modelId: string) => void;
  disabled?: boolean;
}

export function ModelSelector({ selectedModel, onModelChange, disabled }: ModelSelectorProps) {
  const currentModel = AI_MODELS.find(m => m.id === selectedModel) || AI_MODELS[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger 
        disabled={disabled}
        className={cn(
          "flex items-center gap-1.5 h-8 px-2.5 text-xs font-medium rounded-lg",
          "bg-white/5 border border-white/10 hover:bg-white/10 text-white transition-colors",
          disabled && "opacity-50 cursor-not-allowed"
        )}
      >
        <Sparkles className="w-3.5 h-3.5 text-primary" />
        {currentModel.name}
        <ChevronDown className="w-3.5 h-3.5 ml-0.5 text-muted-foreground" />
      </DropdownMenuTrigger>
      
      <DropdownMenuContent 
        align="start" 
        className="w-[240px] bg-zinc-950 border-white/10 text-zinc-300 shadow-2xl p-1"
      >
        {AI_MODELS.map((model) => (
          <DropdownMenuItem
            key={model.id}
            onClick={() => onModelChange(model.id)}
            className="flex flex-col items-start gap-1 p-2 focus:bg-white/10 focus:text-white cursor-pointer rounded-md relative"
          >
            <div className="flex justify-between items-center w-full">
              <div className="flex items-center gap-1.5">
                <span className="font-medium text-sm text-white">
                  {model.name}
                </span>
                {model.vision && (
                  <Eye className="w-3 h-3 text-blue-400" />
                )}
              </div>
              {selectedModel === model.id && (
                <Check className="w-4 h-4 text-primary" />
              )}
            </div>
            <span className="text-xs text-zinc-500">
              {model.provider} • {model.description}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
