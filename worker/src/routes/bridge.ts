// Intelligence Bridge — connects Mission Control's Phase 1 research to Lovable's template system
// Calls Mission Control's factory API, extracts the research data, and feeds it into Smart Fill + templates

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { Bindings, Variables } from '../index';
import { authMiddleware } from '../middleware/auth';
import { nanoid } from 'nanoid';
import { getTemplateById, buildTemplateProject } from '../templates';
import { BusinessInfo, ServiceInfo } from '../templates/types';
import { buildSmartFillPrompt, applySmartFill } from '../ai/smart-fill';
import { buildBlogContentPrompt, generateBlogPost, generateBlogListing } from '../templates/blog';
import { createOpenAI } from '@ai-sdk/openai';
import { sanitizeGeneratedCode } from '../ai/code-sanitizer';
import { generateText } from 'ai';

const bridgeRouter = new Hono<{ Bindings: Bindings; Variables: Variables }>();

bridgeRouter.use('*', authMiddleware);

// Intelligence data shapes (mirrors Mission Control Phase 1 output)
interface IntelligenceReport {
  targetBusiness: {
    businessName: string;
    industry: string;
    city: string;
    state: string;
    services: string[];
    phone?: string;
    address?: string;
    brandColors?: string[];
  };
  passingCompetitors: Array<{
    url: string;
    grade: { total: number; design: number; seo: number; content: number; conversion: number };
    strengths: string[];
    weaknesses: string[];
  }>;
  contentModel: {
    ctaPatterns: string[];
    serviceNames: string[];
    trustSignals: string[];
    faqQuestions: string[];
    structure: {
      hasEmergencyBanner: boolean;
      hasStatsSection: boolean;
      hasBlogSection: boolean;
      hasVideoSection: boolean;
    };
  };
  keywords: Array<{
    keyword: string;
    volume: number;
    intent: string;
    priority: string;
  }>;
  geoModifiers: string[];
  uvpAngles: Array<{
    angle: string;
    competitorGap: string;
    headline: string;
    subheadline: string;
  }>;
}

/**
 * POST /api/bridge/research-to-template
 * 
 * Takes Mission Control intelligence data and generates a Lovable project from it.
 * This is the "best of both worlds" route.
 * 
 * Body: {
 *   intelligence: IntelligenceReport (from Mission Control Phase 1),
 *   templateId: string,
 *   colorSchemeIndex?: number,
 *   generateBlogs?: boolean  // auto-generate blogs from keywords
 * }
 */
bridgeRouter.post('/research-to-template', async (c) => {
  const userId = c.get('userId');
  const kv = c.env.KV_METADATA;
  const r2 = c.env.R2_PROJECTS;

  try {
    const body = await c.req.json();
    const { intelligence, templateId, colorSchemeIndex = 0, generateBlogs = true } = body as {
      intelligence: IntelligenceReport;
      templateId: string;
      colorSchemeIndex?: number;
      generateBlogs?: boolean;
    };

    // Validate
    if (!intelligence?.targetBusiness?.businessName) {
      return c.json({ error: 'Intelligence data with targetBusiness is required' }, 400);
    }

    const template = getTemplateById(templateId);
    if (!template) return c.json({ error: 'Template not found' }, 404);

    const biz = intelligence.targetBusiness;
    const colorScheme = template.colorSchemes[colorSchemeIndex] || template.colorSchemes[0];

    return streamSSE(c, async (stream) => {
      // ---- STEP 1: Build business info from intelligence ----
      await stream.writeSSE({
        data: JSON.stringify({ type: 'progress', step: 'mapping', message: 'Mapping intelligence data to template...' }),
        event: 'message',
      });

      // Map competitor's best service names to our template services
      const competitorServices = intelligence.contentModel.serviceNames || [];
      const bizServices = biz.services || [];

      // Use business's own services first, enhance with competitor patterns
      const services: ServiceInfo[] = bizServices.length > 0
        ? bizServices.map((name, i) => ({
            name,
            description: `${name} services in ${biz.city}, ${biz.state}. Professional quality with guaranteed satisfaction.`,
            icon: template.defaultServices[i % template.defaultServices.length]?.icon || 'Star',
          }))
        : template.defaultServices;

      // Use UVP headline as tagline if available
      const tagline = intelligence.uvpAngles?.[0]?.headline
        || `${biz.city}'s Trusted ${biz.industry} Experts`;

      const businessInfo: BusinessInfo = {
        businessName: biz.businessName,
        phone: biz.phone || '(956) 555-0100',
        email: `info@${biz.businessName.toLowerCase().replace(/[^a-z0-9]/g, '')}.com`,
        address: biz.address || '123 Main St',
        city: biz.city,
        state: biz.state,
        primaryColor: colorScheme.primary,
        secondaryColor: colorScheme.secondary,
        tagline,
        description: `${biz.businessName} is ${biz.city}'s trusted ${biz.industry.toLowerCase()} provider. Serving ${biz.city}, ${biz.state} and surrounding areas with professional ${bizServices.slice(0, 3).join(', ').toLowerCase()} services.`,
        services,
        pages: template.defaultPages,
      };

      // ---- STEP 2: Smart Fill with intelligence context ----
      await stream.writeSSE({
        data: JSON.stringify({ type: 'progress', step: 'smartfill', message: 'Running Smart Fill with competitor research...' }),
        event: 'message',
      });

      let finalInfo = { ...businessInfo };
      let smartFillData: {
        aboutParagraph: string;
        heroSubtext: string;
        faqPairs: Array<{ q: string; a: string }>;
        reviewSnippets: Array<{ name: string; text: string }>;
      } | null = null;

      try {
        const openrouter = createOpenAI({
          apiKey: c.env.OPENROUTER_API_KEY,
          baseURL: 'https://openrouter.ai/api/v1',
        });

        // Enhanced Smart Fill prompt that includes competitor intelligence
        const competitorWeaknesses = intelligence.passingCompetitors
          .flatMap(p => p.weaknesses || [])
          .slice(0, 5)
          .join('; ');

        const trustSignals = intelligence.contentModel.trustSignals?.join(', ') || '';
        const ctaPatterns = intelligence.contentModel.ctaPatterns?.slice(0, 5).join(', ') || '';
        const uvpAngles = intelligence.uvpAngles?.map(u => u.angle).join(', ') || '';

        const enhancedSystem = `You are a copywriter for local service businesses. You have competitor research data.
Write compelling marketing copy that exploits competitor weaknesses and highlights unique value propositions.
Output ONLY valid JSON. No markdown, no explanations.`;

        const enhancedUser = `Business: ${biz.businessName}
Type: ${biz.industry}
Location: ${biz.city}, ${biz.state}
Services: ${bizServices.join(', ')}

COMPETITOR INTELLIGENCE:
- Competitor weaknesses: ${competitorWeaknesses || 'generic service, slow response'}
- Trust signals used by top competitors: ${trustSignals}
- Top CTA patterns: ${ctaPatterns}
- Our UVP angles: ${uvpAngles}
- Top FAQ from competitors: ${intelligence.contentModel.faqQuestions?.slice(0, 5).join('; ')}

Generate this JSON:
{
  "tagline": "short punchy tagline (under 10 words) that uses a UVP angle",
  "description": "2 sentence overview mentioning location, key services, and a differentiator from competitors",
  "aboutParagraph": "3 sentences about the business, their values, experience, and commitment. Mention trust signals.",
  "heroSubtext": "1 sentence compelling reason to choose us over competitors",
  "serviceDescriptions": ["enhanced description for each service: ${bizServices.join(', ')}", "under 30 words each"],
  "faqPairs": [
    {"q": "question based on competitor FAQ patterns", "a": "answer"},
    {"q": "question 2", "a": "answer 2"},
    {"q": "question 3", "a": "answer 3"},
    {"q": "question 4", "a": "answer 4"},
    {"q": "question 5", "a": "answer 5"}
  ],
  "reviewSnippets": [
    {"name": "First name + last initial", "text": "realistic 5-star review mentioning specific services"},
    {"name": "First name + last initial", "text": "realistic review"},
    {"name": "First name + last initial", "text": "realistic review"},
    {"name": "First name + last initial", "text": "realistic review"}
  ]
}

Make reviews sound like real people in ${biz.city}. Vary styles. Mention specific services. Exploit competitor weaknesses in the copy.`.trim();

        const result = await generateText({
          model: openrouter('moonshotai/kimi-k2'),
          system: enhancedSystem,
          messages: [{ role: 'user', content: enhancedUser }],
        });

        let jsonStr = result.text.trim();
        if (jsonStr.startsWith('```')) {
          jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
        }

        const fillResult = JSON.parse(jsonStr);
        if (fillResult) {
          finalInfo = applySmartFill(finalInfo, fillResult);
          smartFillData = {
            aboutParagraph: fillResult.aboutParagraph,
            heroSubtext: fillResult.heroSubtext,
            faqPairs: fillResult.faqPairs,
            reviewSnippets: fillResult.reviewSnippets,
          };
        }
      } catch (aiErr) {
        console.error('Enhanced Smart Fill failed, using basic template:', aiErr);
      }

      // ---- STEP 3: Build template files ----
      await stream.writeSSE({
        data: JSON.stringify({ type: 'progress', step: 'building', message: 'Generating template files...' }),
        event: 'message',
      });

      const { files, dependencies } = buildTemplateProject(template, finalInfo);

      // Inject Smart Fill content if available
      if (smartFillData) {
        if (smartFillData.aboutParagraph && files['/src/components/About.tsx']) {
          files['/src/components/About.tsx'] = files['/src/components/About.tsx'].replace(
            /<p className="text-lg text-gray-600 leading-relaxed">\s*\$\{info\.description\}\s*<\/p>/,
            `<p className="text-lg text-gray-600 leading-relaxed">${smartFillData.aboutParagraph.replace(/'/g, "\\'")}</p>`
          );
        }
        if (smartFillData.heroSubtext && files['/src/components/Hero.tsx']) {
          files['/src/components/Hero.tsx'] = files['/src/components/Hero.tsx'].replace(
            /\$\{info\.description\.length > 200.*?\}/,
            smartFillData.heroSubtext.replace(/'/g, "\\'")
          );
        }
        if (smartFillData.faqPairs?.length && files['/src/components/Faq.tsx']) {
          const faqEntries = smartFillData.faqPairs.map((faq: { q: string; a: string }) =>
            `    { q: '${faq.q.replace(/'/g, "\\'")}', a: '${faq.a.replace(/'/g, "\\'")}' }`
          ).join(',\n');
          files['/src/components/Faq.tsx'] = files['/src/components/Faq.tsx'].replace(
            /const FAQS = \[[\s\S]*?\];/,
            `const FAQS = [\n${faqEntries},\n  { q: 'Do you offer free estimates?', a: 'Yes! We offer free, no-obligation estimates for all services. Contact us today.' },\n  { q: 'What areas do you serve?', a: 'We proudly serve ${biz.city}, ${biz.state} and all surrounding areas.' },\n];`
          );
        }
        if (smartFillData.reviewSnippets?.length && files['/src/components/Reviews.tsx']) {
          const reviewEntries = smartFillData.reviewSnippets.map((r: { name: string; text: string }) =>
            `    { name: '${r.name.replace(/'/g, "\\'")}', text: '${r.text.replace(/'/g, "\\'")}', rating: 5 }`
          ).join(',\n');
          files['/src/components/Reviews.tsx'] = files['/src/components/Reviews.tsx'].replace(
            /const REVIEWS = \[[\s\S]*?\];/,
            `const REVIEWS = [\n${reviewEntries},\n];`
          );
        }
      }

      // Inject UVP section if available
      if (intelligence.uvpAngles?.length > 0 && files['/src/components/Hero.tsx']) {
        // Use first UVP's headline in the hero
        const topUVP = intelligence.uvpAngles[0];
        files['/src/components/Hero.tsx'] = files['/src/components/Hero.tsx'].replace(
          /\$\{info\.tagline\}/g,
          topUVP.headline.replace(/'/g, "\\'")
        );
      }

      await stream.writeSSE({
        data: JSON.stringify({ type: 'progress', step: 'template-done', message: `Template built: ${Object.keys(files).length} files` }),
        event: 'message',
      });

      // ---- STEP 4: Generate blogs from keywords (optional) ----
      if (generateBlogs && intelligence.keywords?.length > 0) {
        await stream.writeSSE({
          data: JSON.stringify({ type: 'progress', step: 'blogs-start', message: `Generating blog posts from ${Math.min(intelligence.keywords.length, 10)} keywords...` }),
          event: 'message',
        });

        const blogKeywords = intelligence.keywords
          .filter(k => k.intent === 'informational' || k.priority === 'high')
          .slice(0, 10); // top 10 keywords → 10 blog posts

        const blogSlugs: string[] = [];
        const openrouter = createOpenAI({
          apiKey: c.env.OPENROUTER_API_KEY,
          baseURL: 'https://openrouter.ai/api/v1',
        });

        for (let i = 0; i < blogKeywords.length; i++) {
          const kw = blogKeywords[i];
          const slug = kw.keyword.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
          blogSlugs.push(slug);

          await stream.writeSSE({
            data: JSON.stringify({
              type: 'progress',
              step: 'blog-gen',
              message: `Writing blog ${i + 1}/${blogKeywords.length}: "${kw.keyword}"`,
              current: i + 1,
              total: blogKeywords.length,
            }),
            event: 'message',
          });

          try {
            const topic = {
              title: `${kw.keyword.charAt(0).toUpperCase() + kw.keyword.slice(1)} — Expert Guide`,
              keywords: [kw.keyword],
              targetWordCount: 800,
            };

            const prompt = buildBlogContentPrompt(finalInfo, topic);
            const result = await generateText({
              model: openrouter('moonshotai/kimi-k2'),
              system: prompt.system,
              messages: [{ role: 'user', content: prompt.user }],
            });

            let content = result.text.trim();
            if (content.startsWith('```')) {
              content = content.replace(/^```(?:html)?\n?/, '').replace(/\n?```$/, '');
            }

            files[`/src/pages/blog/${slug}.tsx`] = generateBlogPost(finalInfo, topic, content);

            await stream.writeSSE({
              data: JSON.stringify({ type: 'blog-done', slug, title: topic.title }),
              event: 'message',
            });
          } catch (err: any) {
            console.error(`Blog failed for "${kw.keyword}":`, err.message);
          }

          if (i < blogKeywords.length - 1) {
            await new Promise(r => setTimeout(r, 500));
          }
        }

        // Generate blog listing
        files['/src/pages/blog/index.tsx'] = generateBlogListing(finalInfo, blogSlugs);

        await stream.writeSSE({
          data: JSON.stringify({ type: 'progress', step: 'blogs-done', message: `${blogSlugs.length} blog posts generated` }),
          event: 'message',
        });
      }

      // ---- STEP 5: Save project ----
      await stream.writeSSE({
        data: JSON.stringify({ type: 'progress', step: 'saving', message: 'Saving project...' }),
        event: 'message',
      });

      const projectId = nanoid(10);
      const now = new Date().toISOString();
      const project = {
        id: projectId,
        userId,
        name: biz.businessName,
        description: `${template.name} template — ${finalInfo.tagline} (intelligence-enhanced)`,
        createdAt: now,
        updatedAt: now,
        templateId,
      };

      // Sanitize files (catches missing lucide-react icon imports & broken refs).
      const sanitizedFiles = sanitizeGeneratedCode(files);
      await kv.put(`user:${userId}:project:${projectId}`, JSON.stringify(project));
      await r2.put(`${projectId}/v1.json`, JSON.stringify({
        version: 1,
        createdAt: now,
        prompt: `Intelligence → Template: ${template.name} — ${biz.businessName}`,
        files: sanitizedFiles,
        dependencies,
      }));
      await kv.put(`project:${projectId}:latest_version`, '1');

      // Rich memory with intelligence context
      const keywordSummary = intelligence.keywords?.slice(0, 10).map(k => k.keyword).join(', ') || '';
      const geoSummary = intelligence.geoModifiers?.join(', ') || '';
      const memory = [
        `Business: ${biz.businessName}`,
        `Type: ${biz.industry} → Template: ${template.name}`,
        `Location: ${biz.city}, ${biz.state}`,
        `Services: ${bizServices.join(', ')}`,
        `Colors: Primary ${colorScheme.primary}, Secondary ${colorScheme.secondary}`,
        `Tagline: ${finalInfo.tagline}`,
        '',
        `Intelligence: ${intelligence.passingCompetitors?.length || 0} competitor models analyzed`,
        `Top Keywords: ${keywordSummary}`,
        `Geo Pages Available: ${geoSummary}`,
        `UVP Angles: ${intelligence.uvpAngles?.map(u => u.angle).join(', ') || 'none'}`,
        '',
        'Generated from Mission Control intelligence → Lovable template.',
        'Content was enhanced with competitor research.',
        'Use chat to customize further. Geo pages can be added via chat.',
      ].join('\n');
      await kv.put(`project:${projectId}:memory`, memory);

      // ---- DONE ----
      await stream.writeSSE({
        data: JSON.stringify({
          type: 'done',
          project,
          version: 1,
          files: sanitizedFiles,
          dependencies,
          intelligence: {
            competitorsAnalyzed: intelligence.passingCompetitors?.length || 0,
            keywordsUsed: intelligence.keywords?.length || 0,
            blogsGenerated: generateBlogs ? (intelligence.keywords?.filter(k => k.intent === 'informational' || k.priority === 'high').slice(0, 10).length || 0) : 0,
            geoModifiers: intelligence.geoModifiers || [],
            uvpAngles: intelligence.uvpAngles?.length || 0,
          },
        }),
        event: 'message',
      });
    });

  } catch (error) {
    console.error('Intelligence bridge error:', error);
    return c.json({ error: 'Failed to process intelligence data' }, 500);
  }
});

export default bridgeRouter;
