/**
 * Input Sanitizer Utility
 *
 * Provides functions to sanitize and validate user input before
 * embedding it in LLM prompts. Helps prevent prompt injection attacks.
 */

/** Maximum allowed input length in characters */
const MAX_INPUT_LENGTH = 10000;

/** Maximum consecutive newlines allowed */
const MAX_CONSECUTIVE_NEWLINES = 3;

/**
 * Patterns that indicate potential prompt injection attempts.
 * These are case-insensitive regex patterns that match common
 * techniques used to override system instructions.
 */
const DANGEROUS_PATTERNS: readonly RegExp[] = [
  /ignore\s+(previous|all|prior)\s+instructions?/i,
  /you\s+are\s+now/i,
  /disregard\s+(all|everything)/i,
  /forget\s+(everything|all)/i,
  /new\s+instructions?:/i,
  /system\s*:\s*you\s+are/i,
  /\[system\]/i,
  /\[assistant\]/i,
  /\[user\]/i,
  /<\s*system\s*>/i,
  /override\s+(previous|system)/i,
] as const;

/**
 * Sanitizes user input for safe use in LLM prompts.
 *
 * This function performs the following transformations:
 * - Removes control characters (ASCII 0-31) except newline (\n) and tab (\t)
 * - Normalizes multiple consecutive spaces to a single space
 * - Limits consecutive newlines to a maximum of 3
 * - Trims leading and trailing whitespace
 * - Truncates input to MAX_INPUT_LENGTH if exceeded
 *
 * @param input - Raw user input string
 * @returns Sanitized string safe for prompt inclusion
 *
 * @example
 * ```typescript
 * const clean = sanitizePromptInput("Hello\x00World");
 * // Returns: "HelloWorld"
 *
 * const normalized = sanitizePromptInput("Too    many   spaces");
 * // Returns: "Too many spaces"
 * ```
 */
export function sanitizePromptInput(input: string): string {
  if (!input) return '';

  let sanitized = input;

  // Remove control characters except newline (\x0A) and tab (\x09)
  // Matches: \x00-\x08, \x0B, \x0C, \x0E-\x1F, \x7F
  sanitized = sanitized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  // Normalize multiple consecutive spaces (not newlines) to single space
  // This preserves intentional line breaks while cleaning up horizontal whitespace
  sanitized = sanitized.replace(/[^\S\n]+/g, ' ');

  // Limit consecutive newlines to MAX_CONSECUTIVE_NEWLINES
  const newlinePattern = new RegExp(`\n{${MAX_CONSECUTIVE_NEWLINES + 1},}`, 'g');
  sanitized = sanitized.replace(newlinePattern, '\n'.repeat(MAX_CONSECUTIVE_NEWLINES));

  // Trim leading and trailing whitespace
  sanitized = sanitized.trim();

  // Enforce maximum length
  if (sanitized.length > MAX_INPUT_LENGTH) {
    sanitized = sanitized.slice(0, MAX_INPUT_LENGTH);
  }

  return sanitized;
}

/**
 * Validation result returned by validatePromptInput.
 */
export interface ValidationResult {
  /** Whether the input passed all validation checks */
  valid: boolean;
  /** Error message if validation failed, undefined if valid */
  error?: string;
}

/**
 * Validates user input before using in LLM prompts.
 *
 * This function checks for:
 * - Empty or whitespace-only input
 * - Input exceeding maximum length (10,000 characters)
 * - Common prompt injection patterns that attempt to override system instructions
 * - Excessive consecutive newlines (more than 3)
 *
 * Note: This function does NOT sanitize the input. Use sanitizePromptInput()
 * first if you want to clean the input, or use this to reject invalid input entirely.
 *
 * @param input - User input to validate
 * @returns Validation result with error message if invalid
 *
 * @example
 * ```typescript
 * const result = validatePromptInput("Hello, world!");
 * // Returns: { valid: true }
 *
 * const malicious = validatePromptInput("Ignore previous instructions");
 * // Returns: { valid: false, error: "Input contains potentially malicious instructions" }
 * ```
 */
export function validatePromptInput(input: string): ValidationResult {
  // Check for empty input
  if (!input || input.trim().length === 0) {
    return { valid: false, error: 'Input cannot be empty' };
  }

  // Check length limit
  if (input.length > MAX_INPUT_LENGTH) {
    return {
      valid: false,
      error: `Input exceeds maximum length of ${MAX_INPUT_LENGTH.toLocaleString()} characters`,
    };
  }

  // Check for excessive consecutive newlines
  const excessiveNewlinesPattern = new RegExp(`\n{${MAX_CONSECUTIVE_NEWLINES + 1},}`);
  if (excessiveNewlinesPattern.test(input)) {
    return {
      valid: false,
      error: `Input contains more than ${MAX_CONSECUTIVE_NEWLINES} consecutive newlines`,
    };
  }

  // Check for prompt injection patterns
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(input)) {
      return {
        valid: false,
        error: 'Input contains potentially malicious instructions',
      };
    }
  }

  return { valid: true };
}

/**
 * Convenience function that both validates and sanitizes input.
 *
 * First validates the input, returning an error if validation fails.
 * If valid, returns the sanitized version of the input.
 *
 * @param input - Raw user input to process
 * @returns Object with either sanitized input or error message
 *
 * @example
 * ```typescript
 * const result = processPromptInput("Hello   world!");
 * if (result.error) {
 *   console.error(result.error);
 * } else {
 *   console.log(result.sanitized); // "Hello world!"
 * }
 * ```
 */
export function processPromptInput(input: string): { sanitized?: string; error?: string } {
  const validation = validatePromptInput(input);

  if (!validation.valid) {
    return { error: validation.error };
  }

  return { sanitized: sanitizePromptInput(input) };
}
