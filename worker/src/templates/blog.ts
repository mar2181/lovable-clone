// Blog batch generation — generates multiple blog posts in one streaming session
// Each blog post gets its own component file + added to a blog listing page

import { BusinessInfo } from '../templates/types';

export interface BlogTopic {
  title: string;
  keywords: string[];
  targetWordCount?: number;
}

/**
 * Generate the blog listing page component
 */
export function generateBlogListing(info: BusinessInfo, blogSlugs: string[]): string {
  const blogCards = blogSlugs.map(slug => {
    const title = slug
      .replace(/-/g, ' ')
      .replace(/\b\w/g, l => l.toUpperCase());
    return `    {
      slug: '${slug}',
      title: '${title.replace(/'/g, "\\'")}',
      excerpt: 'Learn everything about ${title.toLowerCase()} in ${info.city}, ${info.state}. Expert tips and professional advice from ${info.businessName}.',
      date: '${new Date().toISOString().split('T')[0]}',
      category: '${info.services[0]?.name || 'General'}',
    }`;
  }).join(',\n');

  return `import React from 'react';
import { Calendar, ArrowRight, Tag } from 'lucide-react';

interface BlogPost {
  slug: string;
  title: string;
  excerpt: string;
  date: string;
  category: string;
}

const POSTS: BlogPost[] = [
${blogCards}
];

export default function Blog() {
  return (
    <section id="blog" className="py-24 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-3xl mx-auto mb-16">
          <p className="text-sm font-semibold uppercase tracking-wider mb-3" style={{ color: '${info.primaryColor}' }}>Our Blog</p>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 mb-4">Latest Articles</h2>
          <p className="text-lg text-gray-600">Tips, insights, and expert advice from the ${info.businessName} team.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {POSTS.map((post, i) => (
            <article key={i} className="group rounded-2xl border border-gray-100 overflow-hidden hover:shadow-xl transition-all duration-300 bg-white">
              <div className="aspect-[16/9] bg-gray-100 overflow-hidden">
                <img
                  src={\`FAL_IMAGE[blog post header image about \${post.title.toLowerCase()}, professional photography, relevant to ${info.businessName.toLowerCase()}]\`}
                  alt={post.title}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                />
              </div>
              <div className="p-6">
                <div className="flex items-center gap-3 mb-3">
                  <span className="flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full" style={{ background: '${info.primaryColor}15', color: '${info.primaryColor}' }}>
                    <Tag className="w-3 h-3" />
                    {post.category}
                  </span>
                  <span className="flex items-center gap-1 text-xs text-gray-400">
                    <Calendar className="w-3 h-3" />
                    {post.date}
                  </span>
                </div>
                <h3 className="text-lg font-bold text-gray-900 mb-2 group-hover:text-gray-700 transition-colors">{post.title}</h3>
                <p className="text-sm text-gray-600 leading-relaxed mb-4">{post.excerpt}</p>
                <span className="inline-flex items-center gap-1 text-sm font-semibold transition-colors" style={{ color: '${info.primaryColor}' }}>
                  Read More
                  <ArrowRight className="w-4 h-4" />
                </span>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}`;
}

/**
 * Generate a single blog post component
 */
export function generateBlogPost(info: BusinessInfo, topic: BlogTopic, content: string): string {
  const title = topic.title.replace(/'/g, "\\'");
  const keywords = topic.keywords.join(', ');

  return `import React from 'react';
import { Calendar, Clock, ArrowLeft, Phone } from 'lucide-react';

export default function BlogPost() {
  return (
    <article className="min-h-screen bg-white pt-24">
      {/* Header */}
      <div className="bg-gray-50 border-b border-gray-100">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <a href="#blog" className="inline-flex items-center gap-1 text-sm font-medium mb-6 hover:opacity-80 transition-opacity" style={{ color: '${info.primaryColor}' }}>
            <ArrowLeft className="w-4 h-4" />
            Back to Blog
          </a>
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold text-gray-900 leading-tight mb-4">
            ${title}
          </h1>
          <div className="flex flex-wrap items-center gap-4 text-sm text-gray-500">
            <span className="flex items-center gap-1">
              <Calendar className="w-4 h-4" />
              ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
            </span>
            <span className="flex items-center gap-1">
              <Clock className="w-4 h-4" />
              ${Math.ceil((topic.targetWordCount || 800) / 200)} min read
            </span>
            <span className="font-medium" style={{ color: '${info.primaryColor}' }}>${info.businessName}</span>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="prose prose-lg max-w-none prose-headings:text-gray-900 prose-p:text-gray-600 prose-p:leading-relaxed prose-a:text-blue-600">
          ${content}
        </div>

        {/* CTA */}
        <div className="mt-16 p-8 rounded-2xl text-center" style={{ background: '${info.primaryColor}08', border: '1px solid ${info.primaryColor}20' }}>
          <h3 className="text-2xl font-bold text-gray-900 mb-3">Ready to Get Started?</h3>
          <p className="text-gray-600 mb-6">Contact ${info.businessName} today for expert ${info.services[0]?.name?.toLowerCase() || 'services'} in ${info.city}, ${info.state}.</p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <a href="#contact" className="px-6 py-3 rounded-lg text-white font-semibold transition-all hover:opacity-90" style={{ background: '${info.primaryColor}' }}>
              Get a Free Quote
            </a>
            <a href="tel:${info.phone}" className="flex items-center gap-2 px-6 py-3 rounded-lg border-2 font-semibold transition-all hover:bg-gray-50" style={{ borderColor: '${info.primaryColor}', color: '${info.primaryColor}' }}>
              <Phone className="w-4 h-4" />
              ${info.phone}
            </a>
          </div>
        </div>
      </div>

      {/* Meta tags for SEO */}
      {/* 
        <title>${title} | ${info.businessName}</title>
        <meta name="description" content="${keywords}" />
        <meta name="keywords" content="${keywords}" />
        <link rel="canonical" href="..." />
      */}
    </article>
  );
}`;
}

/**
 * Build the AI prompt for generating blog content
 */
export function buildBlogContentPrompt(info: BusinessInfo, topic: BlogTopic): { system: string; user: string } {
  const wordCount = topic.targetWordCount || 800;

  return {
    system: `You are a content writer for ${info.businessName}, a ${info.services[0]?.name?.toLowerCase() || 'service'} business in ${info.city}, ${info.state}.
Write SEO-optimized blog content in HTML format (no <html>, <head>, or <body> tags).
Use h2 and h3 for headings, p for paragraphs, ul/ol for lists.
Include the target keywords naturally. Write for homeowners/businesses in ${info.city}.
Be informative, helpful, and professional. ~${wordCount} words.
Output ONLY the HTML content. No markdown, no explanations.`,
    user: `Write a blog post about: "${topic.title}"

Target keywords: ${topic.keywords.join(', ')}
Location: ${info.city}, ${info.state}
Business: ${info.businessName} — ${info.services.map(s => s.name).join(', ')}
Word count: ~${wordCount}

Include:
- An engaging introduction
- 3-4 main sections with helpful information
- A brief mention of professional services (not salesy)
- A conclusion with a soft CTA

Output only the HTML body content (h2, h3, p, ul, ol tags).`.trim(),
  };
}
