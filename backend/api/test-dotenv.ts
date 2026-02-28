import * as dotenv from 'dotenv';
import * as pathModule from 'path';
const envPath = pathModule.resolve(__dirname, '../../.env');
const envPath2 = pathModule.resolve(__dirname, '../../../.env');
console.log('__dirname:', __dirname);
console.log('envPath:', envPath);
console.log('envPath2:', envPath2);
dotenv.config({ path: envPath2 });
console.log('OLLAMA_API_KEY_1:', process.env.OLLAMA_API_KEY_1);
