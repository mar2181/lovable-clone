"use client";

import { Bot, User } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ChatMessageProps {
  role: "user" | "assistant";
  content: string;
}

export function ChatMessage({ role, content }: ChatMessageProps) {
  const isUser = role === "user";

  return (
    <div className={cn("flex gap-4 items-start", isUser ? "flex-row-reverse" : "")}>
      <div 
        className={cn(
          "w-8 h-8 rounded-full flex items-center justify-center shrink-0 border",
          isUser 
            ? "bg-white/10 border-white/20" 
            : "bg-primary/20 border-primary/30"
        )}
      >
        {isUser ? (
          <User className="w-4 h-4 text-zinc-300" />
        ) : (
          <Bot className="w-5 h-5 text-primary" />
        )}
      </div>
      
      <div 
        className={cn(
          "space-y-1 max-w-[85%]", // Prevent message from taking full width
          isUser ? "text-right" : "text-left" // Ensure alignment is consistent
        )}
      >
        <p className={cn("text-sm font-medium", isUser ? "text-zinc-300" : "text-white")}>
          {isUser ? "You" : "HS Solutions AI"}
        </p>
        <div 
          className={cn(
            "text-sm rounded-2xl px-4 py-2.5 inline-block whitespace-pre-wrap",
            isUser 
              ? "bg-primary text-primary-foreground rounded-tr-sm" 
              : "bg-zinc-800/80 text-zinc-200 rounded-tl-sm border border-white/5"
          )}
        >
          {content}
        </div>
      </div>
    </div>
  );
}
