"use client";

import { useState } from "react";
import Editor from "@monaco-editor/react";
import { FileCode2, FileJson, FileText, ChevronRight, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface CodeEditorPanelProps {
  files: Record<string, string>;
  onFileChange?: (filename: string, content: string) => void;
}

export function CodeEditorPanel({ files, onFileChange }: CodeEditorPanelProps) {
  const [activeFile, setActiveFile] = useState<string>("/App.js");
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(["/"]));

  const filepaths = Object.keys(files).sort();

  // Basic file icon helper
  const getFileIcon = (filename: string) => {
    if (filename.endsWith('.json')) return <FileJson className="w-4 h-4 text-yellow-400" />;
    if (filename.endsWith('.js') || filename.endsWith('.jsx') || filename.endsWith('.ts') || filename.endsWith('.tsx')) {
      return <FileCode2 className="w-4 h-4 text-blue-400" />;
    }
    return <FileText className="w-4 h-4 text-zinc-400" />;
  };

  const currentContent = files[activeFile] || "";

  const handleEditorChange = (value: string | undefined) => {
    if (value !== undefined && onFileChange) {
      onFileChange(activeFile, value);
    }
  };

  return (
    <div className="flex h-full bg-[#1e1e1e]">
      {/* File Explorer Sidebar */}
      <div className="w-56 shrink-0 border-r border-[#333] flex flex-col">
        <div className="h-9 px-4 flex items-center text-xs font-semibold text-zinc-400 uppercase tracking-wider shrink-0 border-b border-[#333]">
          Explorer
        </div>
        <div className="flex-1 overflow-y-auto py-2">
          {filepaths.map(filepath => (
            <button
              key={filepath}
              onClick={() => setActiveFile(filepath)}
              className={cn(
                "w-full flex items-center gap-2 px-3 py-1.5 text-sm transition-colors text-left",
                activeFile === filepath
                  ? "bg-[#37373d] text-white"
                  : "text-zinc-400 hover:bg-[#2a2d2e] hover:text-zinc-300"
              )}
            >
              {getFileIcon(filepath)}
              <span className="truncate">{filepath.replace(/^\//, '')}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Editor Main Area */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="h-9 flex bg-[#252526] shrink-0 border-b border-[#333]">
          <div className="flex items-center gap-2 px-4 bg-[#1e1e1e] border-t-2 border-t-blue-500 text-sm text-white min-w-[120px] max-w-[200px]">
            {getFileIcon(activeFile)}
            <span className="truncate">{activeFile.replace(/^\//, '')}</span>
          </div>
        </div>
        
        <div className="flex-1 py-2">
          {filepaths.length > 0 ? (
            <Editor
              height="100%"
              theme="vs-dark"
              path={activeFile}
              defaultLanguage={activeFile.endsWith('.css') ? 'css' : activeFile.endsWith('.json') ? 'json' : 'javascript'}
              value={currentContent}
              onChange={handleEditorChange}
              options={{
                minimap: { enabled: false },
                fontSize: 14,
                wordWrap: "on",
                padding: { top: 16 },
                scrollBeyondLastLine: false,
                smoothScrolling: true,
              }}
            />
          ) : (
            <div className="h-full flex items-center justify-center text-zinc-500">
              No files to display. Chat with AI to generate code.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
