const assistantController = require('../controllers/assistantController');

const assistantRoutes = async (fastify) => {
  fastify.route({
    method: 'POST',
    url: '/api/assistants/message',
    schema: {
      tags: ['Assistant'],
      summary: 'Envía un mensaje al asistente',
      description: 'Procesa un mensaje del usuario y obtiene una respuesta del asistente de IA',
      body: {
        type: 'object',
        required: ['assistantId', 'user_input'],
        properties: {
          assistantId: {
            type: 'string',
            description: 'ID del asistente de OpenAI (debe comenzar con asst_)',
            pattern: '^asst_'
          },
          user_input: {
            type: 'string',
            description: 'Mensaje del usuario'
          }
        }
      },
      response: {
        200: {
          description: 'Respuesta exitosa',
          type: 'object',
          properties: {
            reply: {
              type: 'string',
              description: 'Respuesta del asistente'
            }
          }
        },
        400: {
          description: 'Datos inválidos',
          type: 'object',
          properties: {
            error: { type: 'string' },
            details: { type: 'string' }
          }
        },
        500: {
          description: 'Error del servidor',
          type: 'object',
          properties: {
            error: { type: 'string' },
            details: { type: 'string' }
          }
        }
      }
    },
    handler: assistantController.handleMessage
  });
};

module.exports = assistantRoutes;
