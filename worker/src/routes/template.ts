import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { Bindings, Variables } from '../index';
import { authMiddleware } from '../middleware/auth';
import { nanoid } from 'nanoid';
import { TEMPLATES, getTemplateById, buildTemplateProject } from '../templates';
import { BusinessInfo } from '../templates/types';
import { buildSmartFillPrompt, applySmartFill, SmartFillResult } from '../ai/smart-fill';
import { createOpenAI } from '@ai-sdk/openai';
import { generateText } from 'ai';

const templateRouter = new Hono<{ Bindings: Bindings; Variables: Variables }>();

templateRouter.use('*', authMiddleware);

// GET /api/template — list all available templates
templateRouter.get('/', async (c) => {
  const list = TEMPLATES.map(t => ({
    id: t.id,
    name: t.name,
    description: t.description,
    icon: t.icon,
    businessTypes: t.businessTypes,
    defaultServices: t.defaultServices,
    defaultPages: t.defaultPages,
    colorSchemes: t.colorSchemes,
    sections: t.sections,
  }));
  return c.json({ templates: list });
});

// GET /api/template/:id — get single template details
templateRouter.get('/:id', async (c) => {
  const id = c.req.param('id');
  const template = getTemplateById(id);
  if (!template) return c.json({ error: 'Template not found' }, 404);
  return c.json({ template });
});

// POST /api/template/generate — generate a full project from a template
// Supports: { smartFill?: boolean } — if true, runs AI to enhance content
templateRouter.post('/generate', async (c) => {
  const userId = c.get('userId');
  const kv = c.env.KV_METADATA;
  const r2 = c.env.R2_PROJECTS;

  try {
    const body = await c.req.json();
    const { templateId, businessInfo, smartFill = true } = body as {
      templateId: string;
      businessInfo: BusinessInfo;
      smartFill?: boolean;
    };

    // Validate
    const template = getTemplateById(templateId);
    if (!template) return c.json({ error: 'Template not found' }, 404);
    if (!businessInfo?.businessName) return c.json({ error: 'Business name is required' }, 400);

    let finalInfo = { ...businessInfo };

    // Smart Fill: run lightweight AI to enhance content
    if (smartFill) {
      try {
        const openrouter = createOpenAI({
          apiKey: c.env.OPENROUTER_API_KEY,
          baseURL: 'https://openrouter.ai/api/v1',
        });

        const prompt = buildSmartFillPrompt({
          businessName: businessInfo.businessName,
          businessType: template.name,
          city: businessInfo.city,
          state: businessInfo.state,
          services: businessInfo.services,
        });

        const result = await generateText({
          model: openrouter('moonshotai/kimi-k2'),
          system: prompt.system,
          messages: [{ role: 'user', content: prompt.user }],
        });

        // Parse AI response
        let fillResult: SmartFillResult | null = null;
        try {
          // Strip markdown code blocks if present
          let jsonStr = result.text.trim();
          if (jsonStr.startsWith('```')) {
            jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
          }
          fillResult = JSON.parse(jsonStr);
        } catch (parseErr) {
          console.error('Smart Fill parse error:', parseErr, 'Raw:', result.text.substring(0, 500));
        }

        if (fillResult) {
          finalInfo = applySmartFill(finalInfo, fillResult);

          // Store the full AI result for later use (reviews, FAQs, about text)
          // These get injected into specific components during build
          const smartFillData = {
            aboutParagraph: fillResult.aboutParagraph,
            heroSubtext: fillResult.heroSubtext,
            faqPairs: fillResult.faqPairs,
            reviewSnippets: fillResult.reviewSnippets,
          };

          // Build enhanced files with Smart Fill content
          const { files, dependencies } = buildTemplateProject(template, finalInfo);

          // Inject Smart Fill content into specific files
          if (fillResult.aboutParagraph && files['/src/components/About.tsx']) {
            files['/src/components/About.tsx'] = files['/src/components/About.tsx'].replace(
              /<p className="text-lg text-gray-600 leading-relaxed">\s*\$\{info\.description\}\s*<\/p>/,
              `<p className="text-lg text-gray-600 leading-relaxed">${fillResult.aboutParagraph.replace(/'/g, "\\'")}</p>`
            );
          }

          if (fillResult.heroSubtext && files['/src/components/Hero.tsx']) {
            files['/src/components/Hero.tsx'] = files['/src/components/Hero.tsx'].replace(
              /\$\{info\.description\.length > 200.*?\}/,
              fillResult.heroSubtext.replace(/'/g, "\\'")
            );
          }

          // Inject FAQ pairs if available
          if (fillResult.faqPairs?.length && files['/src/components/Faq.tsx']) {
            const faqEntries = fillResult.faqPairs.map(faq =>
              `    { q: '${faq.q.replace(/'/g, "\\'")}', a: '${faq.a.replace(/'/g, "\\'")}' }`
            ).join(',\n');
            // Replace the generated FAQs with AI-enhanced ones
            files['/src/components/Faq.tsx'] = files['/src/components/Faq.tsx'].replace(
              /const FAQS = \[[\s\S]*?\];/,
              `const FAQS = [\n${faqEntries},\n  { q: 'Do you offer free estimates?', a: 'Yes! We offer free, no-obligation estimates. Contact us today for a transparent quote.' },\n  { q: 'What areas do you serve?', a: 'We proudly serve ${businessInfo.city}, ${businessInfo.state} and surrounding areas.' },\n];`
            );
          }

          // Inject review snippets if available
          if (fillResult.reviewSnippets?.length && files['/src/components/Reviews.tsx']) {
            const reviewEntries = fillResult.reviewSnippets.map(r =>
              `    { name: '${r.name.replace(/'/g, "\\'")}', text: '${r.text.replace(/'/g, "\\'")}', rating: 5 }`
            ).join(',\n');
            files['/src/components/Reviews.tsx'] = files['/src/components/Reviews.tsx'].replace(
              /const REVIEWS = \[[\s\S]*?\];/,
              `const REVIEWS = [\n${reviewEntries},\n];`
            );
          }

          // Save project
          const projectId = nanoid(10);
          const now = new Date().toISOString();
          const project = {
            id: projectId,
            userId,
            name: businessInfo.businessName,
            description: `${template.name} template — ${finalInfo.tagline}`,
            createdAt: now,
            updatedAt: now,
            templateId,
          };

          await kv.put(`user:${userId}:project:${projectId}`, JSON.stringify(project));
          await r2.put(`${projectId}/v1.json`, JSON.stringify({
            version: 1, createdAt: now,
            prompt: `Template: ${template.name} (Smart Fill) — ${businessInfo.businessName}`,
            files, dependencies,
          }));
          await kv.put(`project:${projectId}:latest_version`, '1');

          // Rich memory with Smart Fill context
          const memory = [
            `Business: ${businessInfo.businessName}`,
            `Type: ${template.name}`,
            `Phone: ${businessInfo.phone}`,
            `Email: ${businessInfo.email}`,
            `Address: ${businessInfo.address}, ${businessInfo.city}, ${businessInfo.state}`,
            `Services: ${businessInfo.services.map(s => s.name).join(', ')}`,
            `Colors: Primary ${businessInfo.primaryColor}, Secondary ${businessInfo.secondaryColor}`,
            `Tagline: ${finalInfo.tagline}`,
            '',
            'Generated from template with Smart Fill AI.',
            'Content was AI-enhanced: tagline, descriptions, about, hero, FAQs, reviews.',
            'Use chat to further customize any content, colors, or layout.',
          ].join('\n');
          await kv.put(`project:${projectId}:memory`, memory);

          return c.json({ project, version: 1, files, dependencies, smartFill: true }, 201);
        }
      } catch (aiErr) {
        console.error('Smart Fill failed, falling back to basic template:', aiErr);
        // Fall through to basic generation
      }
    }

    // Basic generation (no Smart Fill or Smart Fill failed)
    const { files, dependencies } = buildTemplateProject(template, finalInfo);

    const projectId = nanoid(10);
    const now = new Date().toISOString();
    const project = {
      id: projectId,
      userId,
      name: businessInfo.businessName,
      description: `${template.name} template — ${businessInfo.tagline || ''}`,
      createdAt: now,
      updatedAt: now,
      templateId,
    };

    await kv.put(`user:${userId}:project:${projectId}`, JSON.stringify(project));
    await r2.put(`${projectId}/v1.json`, JSON.stringify({
      version: 1, createdAt: now,
      prompt: `Template: ${template.name} — ${businessInfo.businessName}`,
      files, dependencies,
    }));
    await kv.put(`project:${projectId}:latest_version`, '1');

    const memory = [
      `Business: ${businessInfo.businessName}`,
      `Type: ${template.name}`,
      `Phone: ${businessInfo.phone}`,
      `Email: ${businessInfo.email}`,
      `Address: ${businessInfo.address}, ${businessInfo.city}, ${businessInfo.state}`,
      `Services: ${businessInfo.services.map(s => s.name).join(', ')}`,
      `Colors: Primary ${businessInfo.primaryColor}, Secondary ${businessInfo.secondaryColor}`,
      '',
      'Generated from template. Use chat to customize content, colors, and layout.',
    ].join('\n');
    await kv.put(`project:${projectId}:memory`, memory);

    return c.json({ project, version: 1, files, dependencies, smartFill: false }, 201);
  } catch (error) {
    console.error('Template generation error:', error);
    return c.json({ error: 'Failed to generate from template' }, 500);
  }
});

export default templateRouter;
