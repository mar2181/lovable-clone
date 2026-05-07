import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { Bindings, Variables } from '../index';
import { authMiddleware } from '../middleware/auth';
import { BlogTopic, buildBlogContentPrompt, generateBlogPost, generateBlogListing } from '../templates/blog';
import { createOpenAI } from '@ai-sdk/openai';
import { generateText } from 'ai';
import { sanitizeGeneratedCode } from '../ai/code-sanitizer';

const blogRouter = new Hono<{ Bindings: Bindings; Variables: Variables }>();

blogRouter.use('*', authMiddleware);

/**
 * POST /api/blog/batch — Generate multiple blog posts for a project
 * 
 * Body: {
 *   projectId: string,
 *   topics: BlogTopic[],
 *   businessInfo: { businessName, phone, email, city, state, primaryColor, services }
 * }
 * 
 * Streams SSE events as each blog is generated.
 */
blogRouter.post('/batch', async (c) => {
  const userId = c.get('userId');
  const kv = c.env.KV_METADATA;
  const r2 = c.env.R2_PROJECTS;

  try {
    const body = await c.req.json();
    const { projectId, topics, businessInfo } = body as {
      projectId: string;
      topics: BlogTopic[];
      businessInfo: {
        businessName: string;
        phone: string;
        email: string;
        city: string;
        state: string;
        primaryColor: string;
        secondaryColor: string;
        tagline: string;
        description: string;
        services: Array<{ name: string; description: string; icon: string }>;
      };
    };

    // Verify project ownership
    const projectStr = await kv.get(`user:${userId}:project:${projectId}`);
    if (!projectStr) return c.json({ error: 'Project not found' }, 404);

    if (!topics?.length) return c.json({ error: 'No topics provided' }, 400);
    if (topics.length > 30) return c.json({ error: 'Maximum 30 blogs per batch' }, 400);

    const info = {
      ...businessInfo,
      address: businessInfo.city, // fallback
      pages: [],
    };

    // Load current project files
    const latestVersion = await kv.get(`project:${projectId}:latest_version`) || '1';
    const versionObj = await r2.get(`${projectId}/v${latestVersion}.json`);
    const currentData = versionObj ? await versionObj.json() as any : { files: {} };
    const currentFiles = currentData.files || {};

    return streamSSE(c, async (stream) => {
      const newFiles: Record<string, string> = { ...currentFiles };
      const blogSlugs: string[] = [];
      let successCount = 0;
      let failCount = 0;

      for (let i = 0; i < topics.length; i++) {
        const topic = topics[i];
        const slug = topic.title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '');

        blogSlugs.push(slug);

        // Progress update
        await stream.writeSSE({
          data: JSON.stringify({
            type: 'progress',
            current: i + 1,
            total: topics.length,
            title: topic.title,
            status: 'generating',
          }),
          event: 'message',
        });

        try {
          // Generate blog content via AI
          const openrouter = createOpenAI({
            apiKey: c.env.OPENROUTER_API_KEY,
            baseURL: 'https://openrouter.ai/api/v1',
          });

          const prompt = buildBlogContentPrompt(info, topic);

          const result = await generateText({
            model: openrouter('moonshotai/kimi-k2'),
            system: prompt.system,
            messages: [{ role: 'user', content: prompt.user }],
          });

          // Clean up the content
          let content = result.text.trim();
          // Strip markdown code blocks if AI wrapped them
          if (content.startsWith('```')) {
            content = content.replace(/^```(?:html)?\n?/, '').replace(/\n?```$/, '');
          }

          // Generate the blog post component
          const blogComponent = generateBlogPost(info, topic, content);
          newFiles[`/src/pages/blog/${slug}.tsx`] = blogComponent;

          successCount++;

          await stream.writeSSE({
            data: JSON.stringify({
              type: 'blog-done',
              slug,
              title: topic.title,
              current: i + 1,
              total: topics.length,
            }),
            event: 'message',
          });

        } catch (err: any) {
          failCount++;
          console.error(`Blog generation failed for "${topic.title}":`, err.message);

          await stream.writeSSE({
            data: JSON.stringify({
              type: 'blog-error',
              slug,
              title: topic.title,
              error: err.message,
              current: i + 1,
              total: topics.length,
            }),
            event: 'message',
          });
        }

        // Small delay between blogs to avoid rate limits
        if (i < topics.length - 1) {
          await new Promise(r => setTimeout(r, 500));
        }
      }

      // Generate blog listing page
      const blogListing = generateBlogListing(info, blogSlugs);
      newFiles['/src/pages/blog/index.tsx'] = blogListing;

      // Save new version
      const latestVersionStr = await kv.get(`project:${projectId}:latest_version`) || '1';
      const newVersionNum = parseInt(latestVersionStr) + 1;

      const sanitizedNewFiles = sanitizeGeneratedCode(newFiles);
      await r2.put(`${projectId}/v${newVersionNum}.json`, JSON.stringify({
        version: newVersionNum,
        createdAt: new Date().toISOString(),
        prompt: `Batch blog generation: ${topics.length} posts`,
        files: sanitizedNewFiles,
        dependencies: currentData.dependencies || {},
      }));
      await kv.put(`project:${projectId}:latest_version`, newVersionNum.toString());

      // Update memory
      const existingMemory = await kv.get(`project:${projectId}:memory`) || '';
      const blogMemory = `\n\nBlog posts (${successCount} generated): ${blogSlugs.slice(0, 10).join(', ')}${blogSlugs.length > 10 ? ` +${blogSlugs.length - 10} more` : ''}`;
      await kv.put(`project:${projectId}:memory`, existingMemory + blogMemory);

      // Final summary
      await stream.writeSSE({
        data: JSON.stringify({
          type: 'done',
          success: successCount,
          failed: failCount,
          total: topics.length,
          files: sanitizedNewFiles,
          blogSlugs,
        }),
        event: 'message',
      });
    });

  } catch (error) {
    console.error('Blog batch generation error:', error);
    return c.json({ error: 'Failed to generate blogs' }, 500);
  }
});

export default blogRouter;
