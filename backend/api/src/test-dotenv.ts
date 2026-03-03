import * as dotenv from 'dotenv';
import * as pathModule from 'path';
const envPath = pathModule.resolve(__dirname, '../../../.env');
console.log('__dirname:', __dirname);
console.log('envPath:', envPath);
const result = dotenv.config({ path: envPath });
console.log('dotenv result:', result.parsed ? Object.keys(result.parsed).filter(k => k.startsWith('OLLAMA_API_KEY')) : result.error);
console.log('OLLAMA_API_KEY_1:', process.env.OLLAMA_API_KEY_1);
