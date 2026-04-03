import { Hono } from "hono";
import { Bindings, Variables } from "../index";
import { authMiddleware } from "../middleware/auth";

const vercelRouter = new Hono<{ Bindings: Bindings; Variables: Variables }>();

vercelRouter.use("*", authMiddleware);

vercelRouter.post("/deploy", async (c) => {
  const vercelToken = c.env.VERCEL_API_KEY;

  if (!vercelToken) {
    return c.json({ error: "Vercel API key not configured on the server" }, 500);
  }

  try {
    const { files, projectId } = await c.req.json();

    if (!files) {
      return c.json({ error: "Missing files" }, 400);
    }

    // Build the file array for Vercel's deployment API
    const vercelFiles: Array<{ file: string; data: string }> = [];

    for (const [filePath, content] of Object.entries(files as Record<string, string>)) {
      const cleanPath = filePath.startsWith("/") ? filePath.substring(1) : filePath;
      vercelFiles.push({
        file: cleanPath,
        data: content as string,
      });
    }

    // Add a basic package.json if not present
    const hasPackageJson = vercelFiles.some(f => f.file === "package.json");
    if (!hasPackageJson) {
      vercelFiles.push({
        file: "package.json",
        data: JSON.stringify({
          name: `lovable-project-${projectId?.slice(0, 8) || "app"}`,
          version: "1.0.0",
          private: true,
          scripts: {
            dev: "react-scripts start",
            build: "react-scripts build",
          },
          dependencies: {
            react: "^18.2.0",
            "react-dom": "^18.2.0",
            "react-scripts": "5.0.1",
            "lucide-react": "latest",
            "react-router-dom": "^6.20.0",
          },
        }, null, 2),
      });
    }

    // Add index.html wrapper if not present
    const hasIndexHtml = vercelFiles.some(f => f.file === "public/index.html");
    if (!hasIndexHtml) {
      vercelFiles.push({
        file: "public/index.html",
        data: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Lovable App</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet" />
</head>
<body>
  <div id="root"></div>
</body>
</html>`,
      });
    }

    // Deploy to Vercel using the v13 deployments API
    const deployRes = await fetch("https://api.vercel.com/v13/deployments", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${vercelToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: `lovable-${projectId?.slice(0, 8) || "app"}`,
        files: vercelFiles.map(f => ({
          file: f.file,
          data: f.data,
        })),
        projectSettings: {
          framework: "create-react-app",
        },
      }),
    });

    if (!deployRes.ok) {
      const err = await deployRes.text();
      console.error("Vercel deploy error:", err);
      return c.json({ error: `Vercel deployment failed: ${err.substring(0, 200)}` }, 500);
    }

    const deployData = await deployRes.json() as { url: string; id: string; readyState: string };

    return c.json({
      success: true,
      deploymentUrl: `https://${deployData.url}`,
      deploymentId: deployData.id,
      status: deployData.readyState,
    });
  } catch (error) {
    console.error("Vercel deploy error:", error);
    return c.json({ error: "Failed to deploy to Vercel" }, 500);
  }
});

export default vercelRouter;
