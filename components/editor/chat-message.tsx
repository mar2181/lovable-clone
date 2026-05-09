"use client";

import { Bot, User } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ChatAttachment {
  url: string;
  kind: "image" | "video";
  filename: string;
}

export interface ChatMessageProps {
  role: "user" | "assistant";
  content: string;
  attachments?: ChatAttachment[];
}

export function ChatMessage({ role, content, attachments }: ChatMessageProps) {
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
          "space-y-2 max-w-[85%]",
          isUser ? "text-right" : "text-left"
        )}
      >
        <p className={cn("text-sm font-medium", isUser ? "text-zinc-300" : "text-white")}>
          {isUser ? "You" : "Lovable AI"}
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
        {isUser && attachments && attachments.length > 0 && (
          <div className={cn("flex gap-2 flex-wrap", isUser ? "justify-end" : "justify-start")}>
            {attachments.map((att, i) => (
              <div
                key={i}
                className="relative group rounded-lg overflow-hidden border border-white/10 bg-zinc-900/50 shrink-0 max-w-[200px]"
                title={att.filename}
              >
                {att.kind === "image" ? (
                  <img
                    src={att.url}
                    alt={att.filename}
                    className="h-24 w-auto object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="h-24 w-40 flex items-center justify-center bg-zinc-800 text-zinc-500 text-xs">
                    <span className="truncate px-2">{att.filename}</span>
                  </div>
                )}
                <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-1.5 py-0.5 text-[10px] text-zinc-300 truncate">
                  {att.filename}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
