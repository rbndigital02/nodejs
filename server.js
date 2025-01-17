require('dotenv').config();

const fastify = require('fastify')({ logger: true });
const { OpenAI } = require('openai');
const axios = require('axios');

// Inicialización de OpenAI
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Middleware CORS
fastify.register(require('@fastify/cors'), { origin: '*' });

// Configuración de Rate Limiting
fastify.register(require('@fastify/rate-limit'), {
  max: 10,
  timeWindow: '1 minute',
  errorResponseBuilder: (req, context) => ({
    statusCode: 429,
    error: 'Too Many Requests',
    message: `Has excedido el límite de ${context.max} solicitudes por ${context.timeWindow}. Inténtalo más tarde.`,
  }),
});

// Funciones de herramientas registradas
const registeredTools = {
  get_lab: async ({ name }) => {
    try {
      const response = await axios.get(
        `https://us-central1-olab-46253.cloudfunctions.net/app/api/users/content/1065649585`
      );

      const data = response.data;
      const labs = data.data.laboratories;
      const lab = labs.filter((lab) => lab.name === name);

      if (lab.length === 0) {
        return `No se encontró el laboratorio con name: '${name}'. Por favor verifica que el id sea correcto.`;
      }

      return `Bienvenido al laboratorio: ${lab[0].displayName}`;
    } catch (error) {
      console.error('Error en get_lab:', error);
      return `Lo siento, hubo un problema al buscar el laboratorio para el name '${name}'. Intenta nuevamente con un número que esté registrado en la plataforma.`;
    }
  },
  get_modules: async ({ id, labName }) => {
    try {
      const response = await axios.get(
        `https://us-central1-olab-46253.cloudfunctions.net/app/api/users/content/${id}`
      );

      const data = response.data;
      const lab = data.data.laboratories.find((l) => l.displayName === labName);

      return lab
        ? lab.modules.map((mod) => mod.displayName)
        : `Laboratorio '${labName}' no encontrado.`;
    } catch (error) {
      console.error('Error en get_modules:', error);
      return `Hubo un problema al buscar los módulos para el laboratorio '${labName}'.`;
    }
  },
  get_units: async ({ id, labName, moduleName }) => {
    try {
      const response = await axios.get(
        `https://us-central1-olab-46253.cloudfunctions.net/app/api/users/content/${id}`
      );

      const data = response.data;
      const lab = data.data.laboratories.find((l) => l.displayName === labName);
      const module = lab?.modules.find((m) => m.displayName === moduleName);

      return module
        ? module.challenges.map((ch) => ch.name)
        : `Módulo '${moduleName}' no encontrado.`;
    } catch (error) {
      console.error('Error en get_units:', error);
      return `Hubo un problema al buscar las unidades para el módulo '${moduleName}'.`;
    }
  },
};

// Función para manejar múltiples llamadas a herramientas
async function handleToolCalls(toolCalls) {
  return Promise.all(
    toolCalls.map(async (toolCall) => {
      const toolName = toolCall.function.name;
      const toolFunction = registeredTools[toolName];
      if (!toolFunction) throw new ReferenceError(`Tool ${toolName} is not implemented`);
      const args = JSON.parse(toolCall.function.arguments);
      const output = await toolFunction(args);
      return { tool_call_id: toolCall.id, output: JSON.stringify(output) };
    })
  );
}

// Función para enviar los resultados de herramientas a OpenAI
async function submitToolOutputs(threadId, runId, openai_key, toolOutputs) {
  try {
    const response = await axios.post(
      `https://api.openai.com/v1/threads/${threadId}/runs/${runId}/submit_tool_outputs`,
      { tool_outputs: toolOutputs },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${openai_key}`,
          'OpenAI-Beta': 'assistants=v2',
        },
      }
    );
    return response.data;
  } catch (error) {
    console.error('Error submitting tool outputs:', error);
    throw error;
  }
}

fastify.post('/api/assistants/message', async (request, reply) => {
  try {
    const { assistantId, user_input } = request.body;

    // Validación básica
    if (!user_input || !assistantId) {
      return reply.status(400).send({ 
        error: 'Datos inválidos', 
        details: 'assistantId y user_input son requeridos.' 
      });
    }

    // Validar formato del assistantId
    if (!assistantId.startsWith('asst_')) {
      return reply.status(400).send({ 
        error: 'ID de asistente inválido', 
        details: 'El ID del asistente debe comenzar con "asst_"' 
      });
    }

    // Verificar si el asistente existe
    try {
      await openai.beta.assistants.retrieve(assistantId);
    } catch (error) {
      if (error.status === 404) {
        return reply.status(404).send({ 
          error: 'Asistente no encontrado', 
          details: 'El ID del asistente proporcionado no existe' 
        });
      }
      throw error;
    }

    // Crear un nuevo thread y manejar el mensaje
    let thread;
    try {
      thread = await openai.beta.threads.create();
      
      // Añadir mensaje del usuario al thread
      await openai.beta.threads.messages.create(thread.id, {
        role: 'user',
        content: user_input,
      });
    } catch (error) {
      console.error('Error creando thread:', error);
      return reply.status(500).send({ 
        error: 'Error al iniciar la conversación', 
        details: error.message 
      });
    }

    // Iniciar la ejecución del assistant con manejo de errores
    let run;
    try {
      run = await openai.beta.threads.runs.create(thread.id, {
        assistant_id: assistantId
      });
    } catch (error) {
      console.error('Error iniciando run:', error);
      return reply.status(500).send({ 
        error: 'Error al procesar la solicitud', 
        details: error.message 
      });
    }

    // Polling para verificar estado con mejor manejo de errores
    let runStatus;
    const startTime = Date.now();
    const TIMEOUT = 60000; // aumentado a 60 segundos para dar más tiempo a las herramientas
    const MAX_RETRIES = 3;
    let retryCount = 0;

    try {
      runStatus = await openai.beta.threads.runs.retrieve(thread.id, run.id);

      while (['in_progress', 'queued'].includes(runStatus.status)) {
        if (Date.now() - startTime > TIMEOUT) {
          throw new Error('Timeout esperando respuesta del asistente');
        }
        
        console.log('Run en progreso... Estado:', runStatus.status);
        await new Promise((resolve) => setTimeout(resolve, 1000));
        
        try {
          runStatus = await openai.beta.threads.runs.retrieve(thread.id, run.id);
        } catch (error) {
          retryCount++;
          if (retryCount > MAX_RETRIES) throw error;
          console.warn(`Error en intento ${retryCount}, reintentando...`);
          await new Promise((resolve) => setTimeout(resolve, 2000));
          continue;
        }

        // Manejar herramientas si son requeridas
        if (runStatus.status === 'requires_action' && runStatus.required_action?.submit_tool_outputs?.tool_calls) {
          try {
            const toolCalls = runStatus.required_action.submit_tool_outputs.tool_calls;
            const toolOutputs = await handleToolCalls(toolCalls);
            await submitToolOutputs(thread.id, run.id, process.env.OPENAI_API_KEY, toolOutputs);
            runStatus = await openai.beta.threads.runs.retrieve(thread.id, run.id);
          } catch (error) {
            console.error('Error procesando herramientas:', error);
            throw new Error('Error al procesar las herramientas del asistente');
          }
        }
      }

      if (runStatus.status === 'failed') {
        throw new Error(`Run falló: ${runStatus.last_error?.message || 'Error desconocido'}`);
      }

      if (runStatus.status !== 'completed') {
        throw new Error(`Estado inesperado: ${runStatus.status}`);
      }

      // Recuperar mensajes de respuesta con mejor manejo
      const messages = await openai.beta.threads.messages.list(thread.id);
      const assistantMessages = messages.data.filter(msg => msg.role === 'assistant');
      
      if (assistantMessages.length === 0) {
        throw new Error('No se encontró respuesta del asistente');
      }

      const botReply = assistantMessages
        .map(msg => msg.content
          .filter(content => content.type === 'text')
          .map(content => content.text?.value || '')
          .join('\n')
        )
        .join('\n')
        .trim();

      if (!botReply) {
        throw new Error('Respuesta del asistente vacía');
      }

      reply.send({ reply: botReply });

    } catch (error) {
      console.error('Error en el proceso:', error);
      
      // Intentar cancelar el run si hubo un error
      try {
        if (run?.id) {
          await openai.beta.threads.runs.cancel(thread.id, run.id);
        }
      } catch (cancelError) {
        console.warn('Error cancelando run:', cancelError);
      }

      return reply.status(500).send({ 
        error: 'Error procesando la solicitud', 
        details: error.message 
      });
    }
  } catch (error) {
    console.error('Error en /api/assistants/message', error);
    reply.status(500).send({ error: 'Error al procesar la solicitud.', details: error.message });
  }
});

// Iniciar el servidor
const start = async () => {
  try {
    await fastify.listen({ port: process.env.PORT || 3000, host: '0.0.0.0' });
    fastify.log.info(`Servidor corriendo en PORT: ${process.env.PORT || 3000}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
