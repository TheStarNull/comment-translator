/**
 * Test/Demo runner - uses MockTranslator to demonstrate the translation flow
 * without requiring a DeepL API key.
 *
 * For real translation, pass --api-key (or set DEEPL_API_KEY) to the CLI,
 * which uses DeepLTranslator under the hood.
 */

import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { TranslationEngine } from './engine';
import { MockTranslator } from './mock-translator';
import { extractComments, cleanCommentText } from './parser';
import { parseJSDoc, extractTranslatableParts, applyTranslations, serializeJSDoc } from './jsdoc-parser';

// Sample test file content
const sampleCode = `
/**
 * Represents a user in the system.
 * This class handles user authentication and profile management.
 *
 * @description This is a sample class for demonstration purposes
 * @author John Doe
 * @version 1.0.0
 */
class User {
  /**
   * The unique identifier for the user
   */
  private id: string;

  /**
   * Creates a new User instance
   * @param name - The user's display name
   * @param email - The user's email address
   * @param options - Additional configuration options
   * @returns A new User object
   * @example
   * const user = new User("John", "john@example.com");
   */
  constructor(name: string, email: string, options?: { role: string }) {
    // Initialize the user object
    this.id = this.generateId();

    /*
     * This is a multi-line block comment
     * It should also be translated
     */
    this.setupProfile(name, email, options);
  }

  /**
   * Gets the user's full name
   * @returns The formatted full name string
   */
  getName(): string {
    return this.name;
  }

  /**
   * Calculates the user's age based on birthdate
   * @param birthdate - The user's birthdate as ISO string
   * @returns The calculated age in years
   * @throws Error if birthdate is invalid
   */
  getAge(birthdate: string): number {
    // Simple age calculation
    const birth = new Date(birthdate);
    const now = new Date();
    return now.getFullYear() - birth.getFullYear();
  }

  // TODO: Implement profile update method
  // FIXME: Handle edge cases for timezone
  private setupProfile(name: string, email: string, options?: any): void {
    // Implementation here
  }
}

/**
 * Utility function to format a date
 * @param date - The date to format
 * @param format - The format string (default: "YYYY-MM-DD")
 * @returns Formatted date string
 */
function formatDate(date: Date, format: string = "YYYY-MM-DD"): string {
  return date.toISOString().split('T')[0];
}

export { User, formatDate };
`;

async function main() {
  console.log(chalk.bold('🧪 Comment Translator - Test & Demo\n'));
  console.log(chalk.gray('Using MockTranslator (simulated translation)\n'));

  // Write sample to temp file
  const testDir = path.join(__dirname, '..', 'test-fixtures');
  const testFile = path.join(testDir, 'sample.ts');
  fs.mkdirSync(testDir, { recursive: true });
  fs.writeFileSync(testFile, sampleCode);

  // Test parsing first
  console.log(chalk.bold('📝 Step 1: Parsing comments'));
  const { comments } = extractComments(sampleCode, 'sample.ts');
  console.log(chalk.gray(`  Found ${comments.length} comments\n`));

  for (const c of comments) {
    console.log(chalk.cyan(`  [${c.type}] Line ${c.line}:`));
    const cleaned = cleanCommentText(c);
    console.log(chalk.gray(`    ${cleaned.substring(0, 80).replace(/\n/g, ' ⏎ ')}`));
    console.log('');
  }

  // Test JSDoc parsing
  console.log(chalk.bold('🔍 Step 2: JSDoc tag parsing'));
  for (const c of comments) {
    if (c.type === 'jsdoc') {
      const cleaned = cleanCommentText(c);
      const parsed = parseJSDoc(cleaned);
      const parts = extractTranslatableParts(parsed);
      console.log(chalk.cyan(`  JSDoc at line ${c.line}:`));
      console.log(chalk.gray(`    Description: ${parsed.description.substring(0, 60)}`));
      console.log(chalk.gray(`    Tags: ${parsed.tags.map(t => '@' + t.tag).join(', ')}`));
      console.log(chalk.gray(`    Translatable parts: ${parts.length}`));
      console.log('');
    }
  }

  // Run full translation with mock
  console.log(chalk.bold('🌐 Step 3: Translating (mock)'));
  const outputDir = path.join(__dirname, '..', 'test-output');

  const engine = new TranslationEngine({
    input: testDir,
    output: outputDir,
    translator: new MockTranslator({ targetLanguage: 'zh' }),
    extensions: ['.ts'],
    recursive: true,
    verbose: true,
  });

  await engine.run();

  // Show result
  console.log(chalk.bold('\n📄 Step 4: Output file content\n'));
  const outputFile = path.join(outputDir, 'sample.ts');
  if (fs.existsSync(outputFile)) {
    const output = fs.readFileSync(outputFile, 'utf-8');
    console.log(chalk.gray('─'.repeat(60)));
    console.log(output);
    console.log(chalk.gray('─'.repeat(60)));
  }

  // Also test with different target languages
  console.log(chalk.bold('\n🌍 Step 5: Multi-language test\n'));

  for (const lang of ['ja', 'ko', 'es']) {
    const langEngine = new TranslationEngine({
      input: testDir,
      output: path.join(__dirname, '..', `test-output-${lang}`),
      translator: new MockTranslator({ targetLanguage: lang }),
      extensions: ['.ts'],
      recursive: true,
      verbose: false,
    });
    await langEngine.run();
    console.log(chalk.green(`  ✓ Translated to ${lang}`));
  }

  console.log(chalk.bold('\n✅ Demo complete!'));
  console.log(chalk.gray('\nTo use with real DeepL translation:'));
  console.log('  1. Get a free key at https://www.deepl.com/pro-api');
  console.log('  2. Set DEEPL_API_KEY (or pass --api-key)');
  console.log('  3. Run: node dist/cli.js <input> --api-key YOUR_KEY:fx --target ZH');
}

main().catch(console.error);
