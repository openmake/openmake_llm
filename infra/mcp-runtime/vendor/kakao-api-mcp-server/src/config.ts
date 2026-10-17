import dotenv from "dotenv";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

// Load environment variables from .env file
dotenv.config();

// --- Configuration ---

export const argv = yargs(hideBin(process.argv))
  .option('kakao-api-key', {
    alias: 'k',
    type: 'string',
    description: 'Kakao REST API Key',
  })
  .option('mode', {
    type: 'string',
    choices: ['stdio', 'http'],
    default: 'stdio',
    description: 'Transport mode: stdio or http (default: stdio)',
  })
  .option('port', {
    type: 'number',
    default: 3000,
    description: 'Port for HTTP server (HTTP mode only)',
  })
  .help()
  .alias('help', 'h')
  .parseSync();

// Custom logger to prevent interference with stdio transport
export const logger = {
  log: (message: string, ...args: unknown[]) => {
    // In stdio mode, write to stderr to avoid interfering with JSON messages
    if (argv.mode === 'stdio') {
      process.stderr.write(`LOG: ${message}\n`);
    } else {
      console.log(message, ...args);
    }
  },
  error: (message: string, ...args: unknown[]) => {
    // Always write errors to stderr
    if (argv.mode === 'stdio') {
      process.stderr.write(`ERROR: ${message}\n`);
    } else {
      console.error(message, ...args);
    }
  }
};

// Get Kakao API Key: prioritize command-line arg, then env var
export const KAKAO_API_KEY = argv.kakaoApiKey || process.env.KAKAO_REST_API_KEY;

if (!KAKAO_API_KEY) {
  logger.error(
    "Error: Kakao REST API Key not found. " +
    "Provide it via --kakao-api-key argument or KAKAO_REST_API_KEY environment variable."
  );
  process.exit(1); // Exit if no key is found
}

logger.log("Kakao REST API Key loaded successfully.");
