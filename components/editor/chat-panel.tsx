"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Send, Bot, Paperclip, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ModelSelector } from "@/components/editor/model-selector";
import { ChatMessage, ChatMessageProps } from "@/components/editor/chat-message";
import { GenerationProgress } from "@/components/editor/generation-progress";
import { DEFAULT_MODEL } from "@/lib/models";
import { useAuth } from "@clerk/nextjs";
import { WORKER_URL } from "@/lib/constants";
import { fetchEventSource } from "@microsoft/fetch-event-source";
import { parseStreamToJSON } from "@/lib/file-parser";

interface ChatPanelProps {
  projectId: string;
  contextFiles: Record<string, string>;
  onUpdateFiles: (files: Record<string, string>) => void;
  onUpdateDependencies?: (deps: Record<string, string>) => void;
}

export function ChatPanel({ projectId, contextFiles, onUpdateFiles, onUpdateDependencies }: ChatPanelProps) {
  const [prompt, setPrompt] = useState("");
  const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL);
  const [messages, setMessages] = useState<ChatMessageProps[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [attachedImage, setAttachedImage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { getToken } = useAuth();
  
  // Use a ref to accumulate the full assistant response for live parsing
  const assistantContentRef = useRef("");
  const contextFilesRef = useRef(contextFiles);
  contextFilesRef.current = contextFiles;
  const doneReceivedRef = useRef(false);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isGenerating]);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        alert("Image must be smaller than 5MB");
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        setAttachedImage(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const removeAttachment = () => {
    setAttachedImage(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || isGenerating) return;

    const userMessage = prompt;
    const currentImage = attachedImage;
    
    setPrompt("");
    setAttachedImage(null);
    setMessages((prev) => [...prev, { role: "user", content: userMessage }]);
    setIsGenerating(true);
    setStatusMessage("Connecting to AI...");
    assistantContentRef.current = "";
    doneReceivedRef.current = false;

    try {
      const token = await getToken();
      
      // Append the assistant message placeholder
      setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

      await fetchEventSource(`${WORKER_URL}/api/chat/${projectId}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          prompt: userMessage,
          model: selectedModel,
          contextFiles: contextFiles,
          imageBase64: currentImage
        }),
        async onopen() {
          setStatusMessage("AI is generating code...");
        },
        onmessage(ev) {
          if (ev.event === "message") {
            const data = JSON.parse(ev.data);
            if (data.type === "chunk") {
              setStatusMessage("Writing code...");
              
              // Accumulate content in ref (outside of React state updater)
              assistantContentRef.current += data.content;
              const currentContent = assistantContentRef.current;
              
              // Update the assistant message text
              setMessages((prev) => {
                const newMessages = [...prev];
                const last = newMessages[newMessages.length - 1];
                if (last && last.role === "assistant") {
                  last.content = currentContent;
                }
                return newMessages;
              });
              
              // Try to parse partial files to update preview live
              // This is now OUTSIDE the setMessages updater â€” safe to call parent setState
              try {
                const parsed = parseStreamToJSON(currentContent);
                if (parsed && parsed.files && Object.keys(parsed.files).length > 0) {
                  onUpdateFiles({ ...contextFilesRef.current, ...parsed.files });
                }
              } catch (e) {
                // Ignore parse errors on partial streams
              }
              
            } else if (data.type === "done") {
              doneReceivedRef.current = true;
              setStatusMessage("Done!");
              if (data.files) {
                onUpdateFiles(data.files);
              }
              if (data.dependencies && onUpdateDependencies) {
                onUpdateDependencies(data.dependencies);
              }
            }
          } else if (ev.event === "error") {
             console.error("Stream error:", ev.data);
          }
        },
        onclose() {
          // Server closed the connection - this is normal after "done"
          // Do NOT retry
        },
        onerror(err) {
          // Only log, don't throw - throwing can prevent the last "done" event from being processed
          console.error("EventSource connection error:", err);
          // Throwing stops retries but may cut off buffered events
          // Instead, just close gracefully
          throw err;
        }
      });
    } catch (error) {
      console.error("Chat error:", error);
      setStatusMessage("Error â€” check console");
    } finally {
      // Fallback: if "done" event was never processed (fetchEventSource drops it sometimes),
      // parse files from the accumulated assistant content
      if (!doneReceivedRef.current && assistantContentRef.current) {
        try {
          const parsed = parseStreamToJSON(assistantContentRef.current);
          if (parsed && parsed.files && Object.keys(parsed.files).length > 0) {
            console.log("Fallback: applying files from accumulated content (done event was missed)");
            onUpdateFiles({ ...contextFilesRef.current, ...parsed.files });
            if (parsed.dependencies && onUpdateDependencies) {
              onUpdateDependencies(parsed.dependencies);
            }
            setStatusMessage("Done!");
          }
        } catch (e) {
          console.error("Fallback parsing failed:", e);
        }
      }
      setIsGenerating(false);
      setTimeout(() => setStatusMessage(""), 3000);
    }
  };

  return (
    <div className="flex flex-col h-full relative">
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-6 pb-20">
        {messages.length === 0 ? (
          <div className="flex gap-4 items-start">
            <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center border border-primary/30 shrink-0">
              <Bot className="w-5 h-5 text-primary" />
            </div>
            <div className="space-y-1 pt-1">
              <p className="text-sm font-medium text-white">Lovable AI</p>
              <div className="text-sm text-zinc-300">
                <p>Hello! I&apos;m ready to help you build. What would you like to create?</p>
                <p className="mt-2 text-zinc-500">Try saying: &ldquo;Create a modern landing page for a SaaS startup with a dark theme&rdquo;</p>
              </div>
            </div>
          </div>
        ) : (
          messages.map((msg, i) => (
            <ChatMessage key={i} role={msg.role} content={msg.content} />
          ))
        )}
      </div>

      {(isGenerating || statusMessage) && (
        <div className="absolute bottom-[160px] left-1/2 -translate-x-1/2 z-10 w-full max-w-[90%] px-4">
          <GenerationProgress
            isGenerating={isGenerating}
            message={statusMessage || "Processing..."}
            className="w-full shadow-[0_0_30px_rgba(0,0,0,0.8)]"
          />
        </div>
      )}

      <div className="p-4 border-t border-white/5 bg-zinc-950/80 backdrop-blur-xl shrink-0 z-20 relative">
        <form 
          onSubmit={handleSubmit}
          className="relative rounded-xl border border-white/10 bg-zinc-900/50 focus-within:ring-1 focus-within:ring-primary focus-within:border-primary transition-all overflow-hidden p-2"
        >
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe what you want to build..."
            className="w-full bg-transparent border-0 focus:ring-0 text-sm text-white resize-none min-h-[60px] max-h-[200px] p-2 placeholder:text-zinc-500 focus-visible:outline-none"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit(e);
              }
            }}
          />
          
          <div className="flex items-center justify-between mt-2 pt-2 border-t border-white/5 bg-transparent">
            {attachedImage && (
              <div className="mb-2 relative inline-block">
                <img src={attachedImage} alt="Attachment" className="h-16 rounded-md border border-white/10" />
                <button 
                  type="button" 
                  onClick={removeAttachment}
                  className="absolute -top-2 -right-2 bg-zinc-800 text-white rounded-full p-0.5 border border-white/10 hover:bg-zinc-700"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                </button>
              </div>
            )}
            <div className="flex items-center gap-2">
              <input 
                type="file" 
                accept="image/*" 
                className="hidden" 
                ref={fileInputRef} 
                onChange={handleImageUpload} 
              />
              <Button 
                type="button" 
                variant="ghost" 
                size="icon" 
                className="h-8 w-8 text-zinc-400 hover:text-white rounded-lg"
                onClick={() => fileInputRef.current?.click()}
              >
                <Paperclip className="w-4 h-4" />
              </Button>
              <ModelSelector 
                selectedModel={selectedModel}
                onModelChange={setSelectedModel}
                disabled={isGenerating}
              />
            </div>
            
            <Button 
              type="submit" 
              size="icon" 
              disabled={!prompt.trim() || isGenerating}
              className="h-8 w-8 rounded-lg bg-primary text-primary-foreground disabled:opacity-50"
            >
              {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </Button>
          </div>
        </form>
        <div className="text-center mt-3">
          <p className="text-[10px] text-zinc-500">
            AI can make mistakes. Verify code before deploying.
          </p>
        </div>
      </div>
    </div>
  );
}

