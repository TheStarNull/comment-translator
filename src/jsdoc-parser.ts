/**
 * JSDoc-specific parser
 * Handles JSDoc tags like @param, @returns, @example, @description etc.
 * Preserves tag structure while translating descriptions
 */

export interface JSDocTag {
  tag: string;       // e.g. 'param', 'returns', 'description'
  type?: string;     // e.g. '{string}', '{number}'
  name?: string;     // e.g. 'options', 'callback'
  description: string; // The text to translate
}

export interface ParsedJSDoc {
  description: string;  // Main description (before any tags)
  tags: JSDocTag[];
  hasInlineTags: boolean; // true if contains {@link}, {@code} etc.
}

const JSDOC_TAGS = [
  'param', 'arg', 'argument', 'property', 'prop',
  'returns', 'return', 'yields', 'yield',
  'description', 'desc',
  'example', 'examples',
  'throws', 'throw', 'exception',
  'see', 'link',
  'author', 'version', 'since',
  'deprecated',
  'type', 'typedef', 'callback',
  'interface', 'class',
  'extends', 'implements',
  'template', 'generic',
  'default', 'defaultvalue',
  'enum', 'readonly',
  'private', 'public', 'protected', 'internal',
  'async', 'generator',
  'fires', 'emits', 'listens',
  'modifies', 'requires',
  'summary', 'file', 'license',
  'todo', 'fixme', 'note', 'warning',
  'category', 'group', 'namespace',
  'memberof', 'module',
];

/**
 * "Marker" tags that take NO description / payload of their own.
 * Anything appearing on the same or following lines belongs to the
 * surrounding (main) description, NOT to the tag.
 *
 * This is the key to fixing the "incomplete translation" bug: without
 * this list, a line like `@beta\n * Error thrown after...` was greedily
 * swallowed into `beta.description`, then silently skipped because `beta`
 * is not in the translatable whitelist — so the whole sentence was never
 * sent to the translator.
 */
const MARKER_TAGS = new Set([
  'beta', 'alpha', 'experimental',
  'internal', 'sealed', 'override',
  'readonly', 'abstract', 'final',
  'public', 'private', 'protected',
  'async', 'generator', 'const', 'constant',
  'ignore', 'ts-ignore', 'ts-expect-error',
  'hidden', 'package', 'static',
  'optional', 'nullable', 'non-nullable',
  'deprecated', 'obsolete',
]);

/**
 * Tags whose payload is structured/code-like and must NEVER be translated
 * (identifiers, types, names, cross-references). These are kept verbatim.
 * Note: @param / @returns / @throws / @example etc. carry human-language
 * descriptions, so they are intentionally NOT in this set — they go through
 * the prose allow-list below and their description IS translated.
 */
const NON_TRANSLATABLE_TAGS = new Set([
  'type', 'typedef', 'callback',
  'template', 'generic',
  'default', 'defaultvalue',
  'enum', 'readonly',
  'fires', 'emits', 'listens',
  'modifies', 'requires',
  'memberof', 'module', 'namespace',
  'category', 'group',
  'see', 'link', 'since', 'version', 'author',
]);

/**
 * Parse a JSDoc comment into structured format
 */
export function parseJSDoc(text: string): ParsedJSDoc {
  const lines = text.split('\n').map(l => l.replace(/^\s*\*\s?/, '').trimEnd());
  const content = lines.join('\n').trim();

  const result: ParsedJSDoc = {
    description: '',
    tags: [],
    hasInlineTags: /\{@\w+/.test(content),
  };

  if (!content) return result;

  // Split into description and tags
  const lines2 = content.split('\n');
  let descriptionLines: string[] = [];
  let tagLines: string[] = [];
  let inTagSection = false;

  for (const line of lines2) {
    const trimmed = line.trim();
    if (trimmed.startsWith('@') && !inTagSection) {
      inTagSection = true;
    }
    if (inTagSection) {
      tagLines.push(line);
    } else {
      descriptionLines.push(line);
    }
  }

  result.description = descriptionLines.join('\n').trim();

  // Parse each tag
  let currentTag: JSDocTag | null = null;

  const closeCurrentTag = () => {
    if (currentTag) {
      result.tags.push(currentTag);
      currentTag = null;
    }
  };

  for (const line of tagLines) {
    const trimmed = line.trim();

    if (trimmed.startsWith('@')) {
      const match = trimmed.match(/^@([\w-]+)\s*(.*)$/s);
      if (!match) {
        // Malformed @-line: attach to current tag / description
        if (currentTag) {
          currentTag.description += (currentTag.description ? '\n' : '') + trimmed;
        }
        continue;
      }

      const tagName = match[1];
      const rest = match[2].trim();
      closeCurrentTag();

      currentTag = { tag: tagName, description: '' };

      // Structured tags: extract type and name
      let payload = rest;
      const typeMatch = payload.match(/^\{([^}]*)\}\s*(.*)$/);
      if (typeMatch) {
        currentTag.type = `{${typeMatch[1]}}`;
        payload = typeMatch[2].trim();
      }

      if (['param', 'arg', 'argument', 'property', 'prop'].includes(tagName)) {
        const nameMatch = payload.match(/^([\[\]\w.=\-'"\s]+?)\s+(.*)$/s);
        if (nameMatch && !nameMatch[1].includes(' ')) {
          currentTag.name = nameMatch[1].trim();
          payload = nameMatch[2].trim();
        }
      }

      currentTag.description = payload;
    } else if (currentTag) {
      // Continuation line of the current tag
      if (currentTag.description) {
        currentTag.description += '\n' + trimmed;
      } else {
        currentTag.description = trimmed;
      }
    }
    // (a continuation with no current tag can only happen for stray text
    //  before the first @-tag — but that is already captured as the main
    //  description above, so we just ignore it here)
  }

  closeCurrentTag();

  return result;
}

/**
 * Serialize parsed JSDoc back to text.
 *
 * Each translatable description is emitted as-is (it may contain newlines).
 * Tags are placed on their own line as `@tag [type] [name] firstLine...`,
 * with any additional lines of the description appended as subsequent lines.
 * This preserves the multi-line structure of translated text instead of
 * collapsing everything onto one line (the historic structure-corruption bug).
 */
export function serializeJSDoc(parsed: ParsedJSDoc): string {
  const lines: string[] = [];

  if (parsed.description) {
    lines.push(...parsed.description.split('\n'));
  }

  for (const tag of parsed.tags) {
    const descLines = (tag.description || '').split('\n');

    // First line: "@tag [type] [name] <first description line>"
    let head = `@${tag.tag}`;
    if (tag.type) head += ` ${tag.type}`;
    if (tag.name) head += ` ${tag.name}`;
    if (descLines[0] != null && descLines[0].length > 0) {
      head += ` ${descLines[0]}`;
    }
    lines.push(head);

    // Remaining description lines (if any) on their own lines
    for (let i = 1; i < descLines.length; i++) {
      lines.push(descLines[i]);
    }
  }

  return lines.join('\n');
}

/**
 * Tags whose description is free-form, human-language prose and therefore
 * SHOULD be sent to the translator. This is the "allow list" for translation.
 * Marker tags (see MARKER_TAGS) and purely structural tags are excluded.
 */
const PROSE_TAGS = new Set([
  'param', 'arg', 'argument', 'property', 'prop',
  'returns', 'return', 'yields', 'yield',
  'description', 'desc', 'summary',
  'remarks', 'remark',
  'throws', 'throw', 'exception',
  'example', 'examples',
  'deprecated', 'todo', 'fixme', 'note', 'warning',
]);

/**
 * Extract translatable segments from JSDoc.
 * Returns array of texts that should be translated.
 *
 * The "incomplete translation" bug fix: any tag whose description looks like
 * human-language prose (free-form text rather than an identifier/type) is
 * offered for translation — including descriptions attached to marker tags
 * such as `@beta`, `@internal`, `@experimental`. Previously these were
 * silently skipped because the tag name was not in a hard-coded allow-list,
 * so sentences like "Error thrown after using the /reload command..." that
 * followed `@beta` were never sent to the translator.
 */
export function extractTranslatableParts(parsed: ParsedJSDoc): string[] {
  const parts: string[] = [];

  // Main description: always translate if present
  if (parsed.description && parsed.description.trim()) {
    parts.push(parsed.description.trim());
  }

  for (const tag of parsed.tags) {
    if (!tag.description || !tag.description.trim()) continue;

    // Pure structural / cross-reference tags are never translated
    if (NON_TRANSLATABLE_TAGS.has(tag.tag)) continue;

    // A tag is considered to carry prose (and thus translatable) when:
    //  - it is in the explicit prose allow-list, OR
    //  - it is a marker/annotation tag whose "payload" is plain text
    //    (e.g. `@beta Error thrown...`, `@deprecated Use foo instead.`).
    const isProse = PROSE_TAGS.has(tag.tag) || MARKER_TAGS.has(tag.tag);

    if (isProse) {
      parts.push(tag.description.trim());
    }
  }

  return parts;
}

/**
 * Reconstruct JSDoc with translated parts
 */
export function applyTranslations(
  parsed: ParsedJSDoc,
  translatedParts: string[],
): ParsedJSDoc {
  let partIdx = 0;
  const result = { ...parsed, tags: [...parsed.tags] };

  // Main description (always the first part, if present)
  if (parsed.description && parsed.description.trim()) {
    result.description = translatedParts[partIdx++] || parsed.description;
  }

  for (let i = 0; i < result.tags.length; i++) {
    const tag = result.tags[i];
    if (!tag.description || !tag.description.trim()) continue;
    if (NON_TRANSLATABLE_TAGS.has(tag.tag)) continue;

    const isProse = PROSE_TAGS.has(tag.tag) || MARKER_TAGS.has(tag.tag);
    if (!isProse) continue;

    result.tags[i] = {
      ...tag,
      description: translatedParts[partIdx++] || tag.description,
    };
  }

  return result;
}
