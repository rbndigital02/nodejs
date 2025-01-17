const config = require('./config');

const swaggerConfig = {
  swagger: {
    info: {
      title: 'O-Lab AI API',
      description: 'API para servicios de inteligencia artificial usando OpenAI Assistants',
      version: '0.0.1'
    },
    host: `localhost:${config.server.port}`,
    schemes: ['http'],
    consumes: ['application/json'],
    produces: ['application/json'],
    tags: [
      { name: 'Assistant', description: 'Endpoints relacionados con el asistente de IA' }
    ],
    securityDefinitions: {
      apiKey: {
        type: 'apiKey',
        name: 'x-api-key',
        in: 'header'
      }
    }
  },
  exposeRoute: true
};

module.exports = swaggerConfig;
