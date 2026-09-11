/**
 * Minimal / fallback type declarations.
 * deepl-node ships its own types; this ambient declaration is a safety net
 * for environments where the installed version lacks full .d.ts exports.
 * It is augmented, not replaced, so real types take precedence.
 */
declare module 'deepl-node' {
  export type Formality = 'default' | 'prefer_less' | 'prefer_more' | 'less' | 'more';

  export interface TranslateTextOptions {
    target_lang: string;
    source_lang?: string;
    preserve_formatting?: boolean;
    split_sentences?: 'on' | 'off' | 'nonewlines';
    formality?: Formality;
    glossary?: string;
  }

  export interface Translation {
    text: string;
    detected_source_language?: string;
  }

  export class DeepLClient {
    constructor(authKey: string, options?: { serverUrl?: string });
    translateText(
      text: string | string[],
      options: TranslateTextOptions
    ): Promise<Translation | Translation[]>;
  }

  /** Older deepl-node versions export a class named `Translator`. */
  export class Translator {
    constructor(authKey: string, options?: { serverUrl?: string });
    translateText(
      text: string | string[],
      options: TranslateTextOptions
    ): Promise<Translation | Translation[]>;
  }
}
