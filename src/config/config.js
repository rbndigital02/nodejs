require('dotenv').config();

const config = {
  openai: {
    apiKey: process.env.OPENAI_API_KEY
  },
  server: {
    port: process.env.PORT || 3000,
    host: process.env.HOST || '0.0.0.0'
  },
  assistant: {
    timeout: 30000, 
    maxRetries: 3
  }
};

module.exports = config;
