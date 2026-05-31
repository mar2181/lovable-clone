import { ProjectList } from "@/components/dashboard/project-list";
import { CreateProjectDialog } from "@/components/dashboard/create-project-dialog";
import { ImportGithubDialog } from "@/components/dashboard/import-github-dialog";
import { TemplatePicker } from "@/components/dashboard/template-picker";

export default function DashboardPage() {
  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white mb-2">Projects</h1>
          <p className="text-muted-foreground">Manage and build your applications.</p>
        </div>
        <div className="flex items-center gap-3">
          <TemplatePicker />
          <ImportGithubDialog />
          <CreateProjectDialog />
        </div>
      </div>
      
      <ProjectList />
    </div>
  );
}
