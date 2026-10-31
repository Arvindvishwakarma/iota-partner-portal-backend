import { createApp } from '../src/app';

const app = createApp();

// Export as serverless function handler for Vercel deployment (supports both CommonJS & ES Module)
export default app;
module.exports = app;
