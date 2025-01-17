require('dotenv').config();
const config = require('./config/config');
const fastify = require('fastify')({
  logger: {
    transport: {
      target: 'pino-pretty',
      options: {
        translateTime: 'HH:MM:ss Z',
        ignore: 'pid,hostname'
      }
    }
  }
});

// Plugins
fastify.register(require('@fastify/cors'), { 
  origin: true,
  methods: ['GET', 'PUT', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key'],
  credentials: true
});

fastify.register(require('@fastify/rate-limit'), {
  max: 100,
  timeWindow: '1 minute',
  errorResponseBuilder: (req, context) => ({
    statusCode: 429,
    error: 'Too Many Requests',
    message: `Has excedido el límite de ${context.max} solicitudes por ${context.timeWindow}. Inténtalo más tarde.`,
  }),
});

// Swagger
const swagger = require('./config/swagger');
fastify.register(require('@fastify/swagger'), swagger);
fastify.register(require('@fastify/swagger-ui'), {
  routePrefix: '/documentation',
  uiConfig: {
    docExpansion: 'full',
    deepLinking: false
  },
  uiHooks: {
    onRequest: function (request, reply, next) { next(); },
    preHandler: function (request, reply, next) { next(); }
  },
  staticCSP: true,
  transformStaticCSP: (header) => header,
});

// Rutas
fastify.register(require('./routes/assistantRoutes'));

// Health check
fastify.get('/health', async () => ({ status: 'OK' }));

// Manejador de errores global
fastify.setErrorHandler((error, request, reply) => {
  fastify.log.error(error);
  reply.status(500).send({
    error: 'Error interno del servidor',
    message: error.message
  });
});

// Iniciar servidor
const start = async () => {
  try {
    await fastify.listen({ 
      port: config.server.port, 
      host: config.server.host 
    });
    fastify.log.info(`Servidor ejecutándose en: ${fastify.server.address().port}`);
    fastify.log.info(`Documentación disponible en: http://localhost:${config.server.port}/documentation`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
