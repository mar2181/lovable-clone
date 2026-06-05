// Tool Registry — all MCP tools
import { healthCheckTool } from "./health-check.js";
import { createProjectTool } from "./create-project.js";
import { sendMessageTool } from "./send-message.js";
import { listProjectsTool } from "./list-projects.js";
import { getProjectFilesTool } from "./get-project-files.js";
import { getVersionsTool } from "./get-versions.js";
import { exportProjectTool } from "./export-project.js";
import { pushGithubTool } from "./push-github.js";
import { deployVercelTool } from "./deploy-vercel.js";
import { retargetSiteTool } from "./retarget-site.js";
import { retargetSiteManualTool } from "./retarget-site-manual.js";

export const tools = [
  healthCheckTool,
  createProjectTool,
  sendMessageTool,
  listProjectsTool,
  getProjectFilesTool,
  getVersionsTool,
  exportProjectTool,
  pushGithubTool,
  deployVercelTool,
  retargetSiteTool,
  retargetSiteManualTool,
];
