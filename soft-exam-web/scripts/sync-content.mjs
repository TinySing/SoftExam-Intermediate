import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.resolve(projectRoot, '../SoftExam');
const destinationRoot = path.join(projectRoot, 'src/content/docs');
const asideKinds = { important: 'note', tip: 'tip', warning: 'caution', question: 'caution' };

function convertWikiLinks(markdown) {
  return markdown.replace(/\[\[([^\]|#]+)(?:#([^\]|]+))?(?:\|([^\]]+))?\]\]/g, (_match, target, heading, label) => {
    const route = `/${target.replace(/^\/+|\.md$/g, '')}/`;
    const anchor = heading ? `#${encodeURIComponent(heading)}` : '';
    return `[${label || target.split('/').at(-1)}](${route}${anchor})`;
  });
}

function toStarlightMarkdown(source, relativePath) {
  const withoutFrontmatter = source.replace(/^---\n[\s\S]*?\n---\n*/, '');
  const titleMatch = withoutFrontmatter.match(/^#\s+(.+)$/m);
  const title = titleMatch?.[1].trim() || path.basename(relativePath, '.md');
  const withoutTitle = titleMatch ? withoutFrontmatter.replace(titleMatch[0], '').trimStart() : withoutFrontmatter;
  const lines = withoutTitle.replace(/\r/g, '').split('\n');
  const converted = [];
  let activeAside = false;

  for (const line of lines) {
    const aside = line.match(/^>\s*\[!(\w+)\]\s*(.*)$/);
    if (aside) {
      if (activeAside) converted.push(':::');
      const kind = asideKinds[aside[1].toLowerCase()] || 'note';
      const label = aside[2].trim() || '提示';
      converted.push(`:::${kind}[${label}]`);
      activeAside = true;
      continue;
    }
    if (activeAside && line.startsWith('>')) {
      converted.push(line.replace(/^>\s?/, ''));
      continue;
    }
    if (activeAside) {
      converted.push(':::');
      activeAside = false;
    }
    converted.push(line);
  }
  if (activeAside) converted.push(':::');

  return `---\ntitle: ${JSON.stringify(title)}\n---\n\n${convertWikiLinks(converted.join('\n'))}`;
}

async function copyDirectory(sourceDirectory, relativeDirectory = '') {
  const entries = await fs.readdir(sourceDirectory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const relativePath = path.join(relativeDirectory, entry.name);
    const sourcePath = path.join(sourceDirectory, entry.name);
    const destinationPath = path.join(destinationRoot, relativePath);
    if (entry.isDirectory()) {
      await copyDirectory(sourcePath, relativePath);
      continue;
    }
    await fs.mkdir(path.dirname(destinationPath), { recursive: true });
    if (path.extname(entry.name).toLowerCase() !== '.md') {
      await fs.copyFile(sourcePath, destinationPath);
      continue;
    }
    const targetPath = relativePath === 'README.md' ? path.join(destinationRoot, 'index.md') : destinationPath;
    const markdown = await fs.readFile(sourcePath, 'utf8');
    await fs.writeFile(targetPath, toStarlightMarkdown(markdown, relativePath));
  }
}

await fs.rm(destinationRoot, { recursive: true, force: true });
await fs.mkdir(destinationRoot, { recursive: true });
await copyDirectory(sourceRoot);
