import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { FolderGit2, Clock, ArrowRight, MoreVertical, Trash, Edit2, Loader2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

interface Project {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  thumbnailUrl?: string;
}

interface ProjectCardProps {
  project: Project;
  onDelete?: (projectId: string) => void;
  isDeleting?: boolean;
}

export function ProjectCard({ project, onDelete, isDeleting }: ProjectCardProps) {
  const menu = (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-white" onClick={(e) => e.stopPropagation()} />
        }
      >
        <MoreVertical className="w-4 h-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="bg-zinc-950 border-white/10 text-zinc-300">
        <DropdownMenuItem className="hover:bg-white/10 hover:text-white cursor-pointer">
          <Edit2 className="w-4 h-4 mr-2" />
          Rename
        </DropdownMenuItem>
        <DropdownMenuItem
          className="text-destructive focus:text-destructive focus:bg-destructive/10 cursor-pointer"
          onClick={(e) => {
            e.stopPropagation();
            if (onDelete) onDelete(project.id);
          }}
          disabled={isDeleting}
        >
          {isDeleting ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <Trash className="w-4 h-4 mr-2" />
          )}
          {isDeleting ? "Deleting..." : "Delete"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <div className="group relative flex flex-col p-6 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-sm hover:bg-white/10 transition-all cursor-pointer overflow-hidden">
      {/* Background glow effect on hover */}
      <div className="absolute inset-0 bg-gradient-to-br from-primary/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />

      {project.thumbnailUrl ? (
        // Hero-image thumbnail — full-bleed banner across the top of the card
        <div className="relative z-10 -mx-6 -mt-6 mb-4 aspect-video overflow-hidden bg-zinc-900 border-b border-white/10">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={project.thumbnailUrl}
            alt={project.name}
            loading="lazy"
            className="w-full h-full object-cover"
          />
          <div className="absolute top-2 right-2 z-20">
            {menu}
          </div>
        </div>
      ) : (
        // Fallback header — folder icon when the project has no generated image
        <div className="relative z-10 flex items-start justify-between mb-4">
          <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center border border-primary/30">
            <FolderGit2 className="w-5 h-5 text-primary" />
          </div>
          {menu}
        </div>
      )}

      <div className="relative z-10 flex-1">
        <h3 className="text-xl font-semibold text-white mb-2 line-clamp-1">{project.name}</h3>
        <p className="text-sm text-muted-foreground line-clamp-2 h-10 mb-4">
          {project.description || "No description provided."}
        </p>
      </div>

      <div className="relative z-10 flex items-center justify-between pt-4 border-t border-white/5 mt-4">
        <div className="flex items-center text-xs text-muted-foreground">
          <Clock className="w-3.5 h-3.5 mr-1" />
          {formatDistanceToNow(new Date(project.updatedAt), { addSuffix: true })}
        </div>

        <Link href={`/editor/${project.id}`} className="flex items-center text-sm font-medium text-primary hover:text-primary/80 transition-colors">
          Open Editor <ArrowRight className="w-4 h-4 ml-1 transition-transform group-hover:translate-x-1" />
        </Link>
      </div>

      {/* Make the entire card clickable, except dropdown */}
      <Link href={`/editor/${project.id}`} className="absolute inset-0 z-0" aria-label={`Open ${project.name}`} />
    </div>
  );
}
