import * as path from 'path';

export function safeResolvePath(baseDir: string, relativePath: string): string | null {
  const resolvedBase = path.resolve(baseDir);
  // Normalize and remove null bytes
  const sanitizedRel = relativePath.replace(/\0/g, '');
  const resolvedTarget = path.resolve(resolvedBase, sanitizedRel);

  // Must start with base directory followed by path separator or exact match
  if (resolvedTarget === resolvedBase || resolvedTarget.startsWith(resolvedBase + path.sep)) {
    return resolvedTarget;
  }

  return null;
}

export function escapeHtml(str: unknown): string {
  if (typeof str !== 'string') {
    if (str === null || str === undefined) return '';
    return String(str);
  }

  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

export function sanitizeFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9_\-\.]/g, '_');
}
