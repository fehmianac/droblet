// Writes the legal texts as Markdown for review: `npm run legal:md`.
// Source of truth is the dictionary (`content/{locale}.json` → `legal`); the Markdown under `docs/legal/{locale}/` is
// what the owner and the lawyer read and mark up. `npm run check` fails when the two drift apart.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const legalDocsDir = join(root, '..', 'docs', 'legal');

/** Dictionary key → file name (same as the site route). Keep in step with `legalRoutes` in src/components/LegalPage.tsx. */
export const legalSlugs = {
  terms: 'terms',
  privacy: 'privacy',
  kvkk: 'kvkk',
  consents: 'consents',
  subscriptionTerms: 'subscription-terms',
  cookies: 'cookies',
  communityGuidelines: 'community-guidelines',
};

function blocks(paragraphs) {
  // Paragraphs are separated by a blank line; consecutive "- " items stay together as one list.
  const out = [];
  let previousItem = false;
  for (const paragraph of paragraphs) {
    const item = paragraph.startsWith('- ');
    if (out.length > 0 && !(item && previousItem)) out.push('');
    out.push(paragraph);
    previousItem = item;
  }
  return out.join('\n');
}

export function renderLegalMarkdown(dictionary, locale, key) {
  const legal = dictionary.legal;
  const doc = legal.docs[key];
  const lines = [
    `<!-- Generated from landing/content/${locale}.json (legal.docs.${key}) by \`npm run legal:md\`. Edit the dictionary, then regenerate. -->`,
    '',
    `# ${doc.title}`,
    '',
    `> ${legal.versionLabel}: ${legal.version}`,
    '',
    doc.intro,
    '',
    `**${legal.controllerLabel}:** ${legal.controller}`,
    '',
    `## ${legal.summaryLabel}`,
    '',
    ...doc.summary.map((line) => `- ${line}`),
    '',
  ];
  doc.sections.forEach((section, index) => {
    lines.push(`## ${index + 1}. ${section.heading}`, '', blocks(section.paragraphs), '');
  });
  return lines.join('\n');
}

/** Every Markdown file the dictionaries produce: path → content. */
export function legalMarkdownFiles() {
  const contentDir = join(root, 'content');
  const files = new Map();
  for (const name of readdirSync(contentDir).filter((file) => file.endsWith('.json'))) {
    const locale = name.replace(/\.json$/, '');
    const dictionary = JSON.parse(readFileSync(join(contentDir, name), 'utf8'));
    for (const [key, slug] of Object.entries(legalSlugs)) {
      files.set(join(legalDocsDir, locale, `${slug}.md`), renderLegalMarkdown(dictionary, locale, key));
    }
  }
  return files;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const [path, content] of legalMarkdownFiles()) {
    if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
    console.log(`wrote ${path}`);
  }
}
