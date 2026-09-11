/**
 * JSDoc-specific parser
 * Handles JSDoc tags like @param, @returns, @example, @remarks etc.
 * Preserves tag structure while translating descriptions.
 *
 * Key invariant: the serialized output MUST preserve the original line
 * structure (one tag / description line per physical line). Otherwise the
 * re-indented comment reconstructed by parser.ts:rebuildComment() becomes
 * misaligned and the JSDoc structure is destroyed after translation
 * (this was the original v2.1.0 bug).
 */

export interface JSDocTag {
  /** Tag name without the leading '@' (e.g. 'param', 'returns', 'remarks'). */
  tag: string;
  /** Raw name segment as it appeared in the source (may be empty). */
  name?: string;
  /** The text to translate (description), kept on its original line. */
  description: string;
  /**
   * True when the description appeared on a SEPARATE line from the @tag in
   * the original source (i.e. it was collected as a continuation line). In
   * that case serializeJSDoc() puts it back on its own line so the original
   * layout is preserved — this is what fixes the DisplaySlotId-style
   * "`@remarks` + description" corruption.
   */
  multiline?: boolean;
}

export interface ParsedJSDoc {
  /** Lines of the main description (before any tag). */
  descriptionLines: string[];
  /** Parsed tags, each carrying its translatable description. */
  tags: JSDocTag[];
  /** true if the comment contains inline tags like {@link}, {@code}. */
  hasInlineTags: boolean;
}

/**
 * Tags whose "description" text should be sent to the translator.
 * `remarks`, `summary`, `description`, `desc` are all included so that
 * Minecraft-style enum documentation (used in the bug report) survives
 * the translation round-trip.
 *
 * Also included: stage / visibility marker tags (`@beta`, `@alpha`,
 * `@experimental`, `@internal`, ...) — these are often followed by a
 * prose explanation (e.g. the reason an API is beta) that MUST be
 * translated; otherwise we get "partial translation" bugs where the
 * sentence right after `@beta` stays in English.
 */
export const TRANSLATABLE_TAGS: ReadonlySet<string> = new Set([
  'param', 'arg', 'argument', 'property', 'prop',
  'returns', 'return', 'yields', 'yield',
  'description', 'desc', 'summary', 'remarks',
  'throws', 'throw', 'exception',
  'example', 'examples',
  'deprecated', 'todo', 'fixme', 'note', 'warning',
  'see', 'author',
  // Stage / visibility markers whose trailing text is human-readable prose.
  'beta', 'alpha', 'experimental', 'internal', 'public', 'private',
  'protected', 'readonly', 'since', 'version',
]);

export function isTranslatableTag(tag: string): boolean {
  return TRANSLATABLE_TAGS.has(tag);
}

const JSDOC_TAGS = [
  'param', 'arg', 'argument', 'property', 'prop',
  'returns', 'return', 'yields', 'yield',
  'description', 'desc', 'remarks', 'summary',
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
 * Parse a JSDoc comment body into structured form.
 * `text` is the inner content (delimiters and the leading " * " prefixes are
 * already stripped by the caller / cleanCommentText).
 */
export function parseJSDoc(text: string): ParsedJSDoc {
  const lines = text.split('\n');
  const result: ParsedJSDoc = {
    descriptionLines: [],
    tags: [],
    hasInlineTags: /\{@\w+/.test(text),
  };

  if (!text.trim()) return result;

  let descriptionLines: string[] = [];
  let tagLines: string[] = [];
  let inTagSection = false;

  for (const line of lines) {
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

  // Description: keep each original line so blank lines / wrapping survive.
  result.descriptionLines = descriptionLines;

  // Parse each tag. A tag may span multiple continuation lines; we preserve
  // the FIRST line (the one that starts with '@') as the canonical structure
  // and attach the continuation text to its `description`.
  let currentTag: JSDocTag | null = null;

  for (const line of tagLines) {
    const trimmed = line.trim();

    if (trimmed.startsWith('@')) {
      if (currentTag) result.tags.push(currentTag);

      const match = trimmed.match(/^@(\w+)\s*(.*)$/s);
      if (match) {
        const tagName = match[1];
        let rest = match[2].trim();
        let name: string | undefined;

        // Extract a {type} segment if present.
        const typeMatch = rest.match(/^\{([^}]*)\}\s*(.*)$/);
        if (typeMatch) {
          // Re-prepend the type so serialization can put it back faithfully.
          rest = `{${typeMatch[1]}} ${typeMatch[2].trim()}`;
        }

        // Extract the name for @param-like tags.
        if (['param', 'arg', 'argument', 'property', 'prop'].includes(tagName)) {
          const nameMatch = rest.match(/^([\[\]\w.=\-'"\s]+?)\s+(.*)$/s);
          if (nameMatch && !nameMatch[1].includes(' ')) {
            name = nameMatch[1].trim();
            rest = nameMatch[2].trim();
          }
        }

        currentTag = { tag: tagName, name, description: rest, multiline: false };
      }
    } else if (currentTag) {
      // Continuation of the previous tag: append, preserving the line break.
      // This means the description was on a separate line in the original →
      // mark it so serializeJSDoc() can put it back on its own line.
      currentTag.multiline = true;
      currentTag.description += '\n' + trimmed;
    }
  }

  if (currentTag) result.tags.push(currentTag);

  return result;
}

/**
 * Serialize a ParsedJSDoc back into the comment BODY (no delimiters, no
 * leading " * " prefixes). One entry per physical line — this is what
 * guarantees the original layout is preserved.
 */
export function serializeJSDoc(parsed: ParsedJSDoc): string {
  const parts: string[] = [];

  // Description: re-emit each original line verbatim (blank lines included).
  for (const line of parsed.descriptionLines) {
    if (line.trim() === '') {
      parts.push('');
    } else {
      parts.push(line.trimEnd());
    }
  }

  for (const tag of parsed.tags) {
    // Reconstruct the tag line faithfully: "@tag [type] [name] [description]".
    let tagLine = `@${tag.tag}`;

    let description = tag.description;

    // If the description still carries a leading "{type}", render it before
    // the name so the output mirrors the original source.
    const typeMatch = description.match(/^\{([^}]*)\}\s*(.*)$/s);
    if (typeMatch) {
      tagLine += ` {${typeMatch[1]}}`;
      description = typeMatch[2].trim();
    }

    if (tag.name) tagLine += ` ${tag.name}`;

    if (description) {
      if (tag.multiline) {
        // Original had the description on a separate line (e.g. Minecraft
        // `@remarks` blocks). Emit "@tag" alone, then the description on the
        // following line — preserving the source layout exactly.
        parts.push(tagLine);
        parts.push(description);
        continue;
      }
      tagLine += ` ${description}`;
    }

    parts.push(tagLine);
  }

  // Join with newlines BUT skip a leading blank line so we don't introduce
  // an empty first line when the description was empty.
  let out = parts.join('\n').trim();
  return out;
}

/**
 * Extract translatable text segments from a ParsedJSDoc.
 * Returns an array of strings; order is: main description first (if any),
 * then each tag's description in declaration order. Segments are NOT joined
 * — keeping them separate is what allows applyTranslations() to map the
 * translated results back without misalignment.
 */
export function extractTranslatableParts(parsed: ParsedJSDoc): string[] {
  const parts: string[] = [];

  const main = parsed.descriptionLines.join('\n').trim();
  if (main) parts.push(main);

  for (const tag of parsed.tags) {
    if (!isTranslatableTag(tag.tag)) continue;
    const desc = tag.description.trim();
    if (!desc) continue;
    // Guard: stage / visibility markers like `@since 1.2.0`, `@internal foo`,
    // `@readonly` often carry a version number or identifier rather than prose.
    // Only translate when the "description" looks like a natural-language
    // sentence (contains at least one space, i.e. multiple words). This
    // prevents corrupting version strings and short annotations while still
    // catching prose like the sentence after `@beta`.
    if (isMarkerTag(tag.tag) && !looksLikeProse(desc)) continue;
    parts.push(desc);
  }

  return parts;
}

/**
 * Tags whose description is typically NOT prose (a version, an identifier,
 * or nothing). They are still in TRANSLATABLE_TAGS so that long prose
 * explanations get translated, but short / structured payloads are skipped.
 */
const MARKER_TAGS = new Set([
  'beta', 'alpha', 'experimental', 'internal',
  'since', 'version', 'readonly',
]);

function isMarkerTag(tag: string): boolean {
  return MARKER_TAGS.has(tag);
}

/**
 * Heuristic: a string is "prose" if it contains at least one whitespace,
 * i.e. is composed of multiple words. A version like "1.2.0" or an
 * identifier like "foo" is not prose and should not be sent to translation.
 */
function looksLikeProse(text: string): boolean {
  return /\s/.test(text);
}

/**
 * Reconstruct a ParsedJSDoc by substituting translated text segments.
 * `translatedParts` MUST be in the same order as extractTranslatableParts()
 * produced them. Order-based mapping is safe because we never re-join
 * multi-segment descriptions into one blob.
 */
export function applyTranslations(
  parsed: ParsedJSDoc,
  translatedParts: string[],
): ParsedJSDoc {
  let partIdx = 0;
  const result: ParsedJSDoc = {
    descriptionLines: [...parsed.descriptionLines],
    tags: parsed.tags.map(t => ({ ...t })),
    hasInlineTags: parsed.hasInlineTags,
  };

  const main = result.descriptionLines.join('\n').trim();
  if (main) {
    result.descriptionLines = applyTextToDescription(
      result.descriptionLines,
      translatedParts[partIdx++] || main,
    );
  }

  for (let i = 0; i < result.tags.length; i++) {
    const tag = result.tags[i];
    const desc = tag.description.trim();
    if (!isTranslatableTag(tag.tag) || !desc) continue;
    // Mirror the skip rule in extractTranslatableParts: short / structured
    // marker payloads (versions, identifiers) are not sent for translation,
    // so they must not consume a slot here either.
    if (isMarkerTag(tag.tag) && !looksLikeProse(desc)) continue;
    result.tags[i] = {
      ...tag,
      description: translatedParts[partIdx++] || tag.description,
    };
  }

  return result;
}

/**
 * Replace the text of a multi-line description with a (possibly single-line)
 * translated version while preserving the original line count and indentation
 * as closely as possible. Falls back to a single-line replacement when the
 * translated text has fewer lines than the original.
 */
function applyTextToDescription(
  originalLines: string[],
  translated: string,
): string[] {
  const translatedLines = translated.split('\n');

  if (originalLines.length <= 1) {
    // Single-line description: just return the translated text as one line.
    return [translatedLines.join('\n').trim()];
  }

  // Multi-line: preserve the leading indent of each original line and refill
  // the translated content line by line. Any leftover translated lines are
  // appended to the last original line.
  const out: string[] = [];
  for (let i = 0; i < originalLines.length; i++) {
    const origIndent = (originalLines[i].match(/^\s*/) || [''])[0];
    if (i < translatedLines.length) {
      out.push(origIndent + translatedLines[i].trim());
    } else if (i === originalLines.length - 1) {
      // Last original line: absorb any remaining translated content.
      const rest = translatedLines.slice(i).join(' ').trim();
      out.push(origIndent + rest);
    } else {
      // Preserve blank/continuation lines so the overall shape is kept.
      out.push(originalLines[i]);
    }
  }

  return out;
}
