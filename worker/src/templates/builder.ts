// Template builder — assembles all template files into a complete project

import { BusinessInfo, TemplateConfig } from './types';
import { generateIndexHtml, generateStyles, generateUtils, generateHeader, generateFooter } from './base';
import { generateHero, generateServices, generateAbout, generateGallery, generateReviews, generateContact, generateFAQ } from './pages';

const PAGE_GENERATORS: Record<string, (info: BusinessInfo) => string> = {
  'hero': generateHero,
  'services': generateServices,
  'about': generateAbout,
  'gallery': generateGallery,
  'reviews': generateReviews,
  'contact': generateContact,
  'faq': generateFAQ,
};

/**
 * Build a complete file set for a template + business info.
 * Returns the same shape the Lovable clone expects: { files: Record<string, string>, dependencies: Record<string, string> }
 */
export function buildTemplateProject(template: TemplateConfig, info: BusinessInfo): { files: Record<string, string>; dependencies: Record<string, string> } {
  const files: Record<string, string> = {};

  // Always include base files
  files['/public/index.html'] = generateIndexHtml(info);
  files['/src/styles.css'] = generateStyles();
  files['/src/lib/utils.ts'] = generateUtils();
  files['/src/components/Header.tsx'] = generateHeader(info);
  files['/src/components/Footer.tsx'] = generateFooter(info);

  // Generate selected page sections
  for (const section of template.sections) {
    const generator = PAGE_GENERATORS[section];
    if (generator) {
      files[`/src/components/${capitalize(section)}.tsx`] = generator(info);
    }
  }

  // Generate App.tsx that imports everything
  files['/src/App.tsx'] = generateAppComponent(template, info);

  // Dependencies
  const dependencies: Record<string, string> = {
    'lucide-react': '1.7.0',
    'clsx': '^2.1.0',
    'tailwind-merge': '^2.2.1',
  };

  return { files, dependencies };
}

function generateAppComponent(template: TemplateConfig, info: BusinessInfo): string {
  const imports: string[] = [];
  const components: string[] = [];

  // Always include Header and Footer
  imports.push("import Header from './components/Header';");
  imports.push("import Footer from './components/Footer';");

  for (const section of template.sections) {
    const name = capitalize(section);
    imports.push(`import ${name} from './components/${name}';`);
    components.push(`      <${name} />`);
  }

  return `import React from 'react';
${imports.join('\n')}

export default function App() {
  return (
    <div className="min-h-screen bg-white">
      <Header />
      <main>
${components.join('\n')}
      </main>
      <Footer />
    </div>
  );
}`;
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
