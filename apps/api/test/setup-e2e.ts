import path from 'node:path';
import dotenv from 'dotenv';

// Load local defaults first (DATABASE_URL, JWT settings), then force the test
// database so an e2e run can never touch development data.
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://postgres@localhost:55432/smart_finance_test?schema=public';
process.env.JWT_SECRET =
  process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 32
    ? process.env.JWT_SECRET
    : 'e2e-test-secret-key-that-is-long-enough-1234567890';
process.env.JWT_EXPIRES_IN = '1h';
process.env.COOKIE_SECURE = 'false';
process.env.WEB_ORIGIN = 'http://localhost:5173';
process.env.AI_SERVICE_URL = 'http://127.0.0.1:9';
process.env.AI_TIMEOUT_MS = '300';
