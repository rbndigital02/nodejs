const assistantService = require('../services/assistantService');

class AssistantController {
  async handleMessage(request, reply) {
    const { assistantId, user_input } = request.body;

    try {
      // Validar datos de entrada
      if (!user_input || !assistantId) {
        return reply.status(400).send({
          error: 'Datos inválidos',
          details: 'assistantId y user_input son requeridos.'
        });
      }

      // Validar el asistente
      await assistantService.validateAssistant(assistantId);

      // Crear thread y añadir mensaje
      const thread = await assistantService.createThread();
      await assistantService.addMessageToThread(thread.id, user_input);

      // Crear y ejecutar el run
      const run = await assistantService.createRun(thread.id, assistantId);

      // Esperar respuesta
      const runStatus = await assistantService.pollRunStatus(thread.id, run.id);

      if (runStatus.status === 'failed') {
        throw new Error(`Run falló: ${runStatus.last_error?.message || 'Error desconocido'}`);
      }

      if (runStatus.status !== 'completed') {
        throw new Error(`Estado inesperado: ${runStatus.status}`);
      }

      // Obtener respuesta
      const botReply = await assistantService.getAssistantResponse(thread.id);
      reply.send({ reply: botReply });

    } catch (error) {
      console.error('Error en handleMessage:', error);
      
      // Intentar cancelar el run si existe
      if (run?.id) {
        await assistantService.cancelRun(thread.id, run.id);
      }

      return reply.status(500).send({
        error: 'Error procesando la solicitud',
        details: error.message
      });
    }
  }
}

module.exports = new AssistantController();
