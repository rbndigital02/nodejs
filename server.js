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
  get_lab: async ({ id }) => {
    try {
      // Hacer la solicitud a la API
      const response = await axios.get(`https://us-central1-olab-46253.cloudfunctions.net/app/api/users/content/1065649585`)
  
      const data = response.data
  
      const labs = data.data.laboratories

      const lab = labs.filter(lab => lab.name === id)

      // Validar que se encontró el laboratorio específico
      if (lab.length === 0) {
        return `No se encontró el laboratorio con id: '${id}'. Por favor verifica que el id sea correcto.`
      }
  
      // Mensaje de bienvenida sobre los laboratorios encontrados
      let mensaje = `Bienvenido al laboratorio: ${lab[0].displayName}`
  
      return mensaje
    } catch (error) {
      // Manejo de errores en caso de que falle la solicitud o haya un error de red
      console.error(error)
      return `Lo siento, hubo un problema al buscar el laboratorio para la identificacion '${id}'. Intenta nuevamente con un numero que este registrado en la plataforma.`
    }
  },
  get_modules: async ({ id, labName }) => {
    const response = await axios.get(`https://us-central1-olab-46253.cloudfunctions.net/app/api/users/content/${id}`);
    const data = response.data;
    const lab = data.data.laboratories.find((l) => l.displayName === labName);
    return lab ? lab.modules.map((mod) => mod.displayName) : `Laboratorio '${labName}' no encontrado.`;
  },
  get_units: async ({ id, labName, moduleName }) => {
    const response = await axios.get(`https://us-central1-olab-46253.cloudfunctions.net/app/api/users/content/${id}`);
    const data = response.data;
    const lab = data.data.laboratories.find((l) => l.displayName === labName);
    const module = lab?.modules.find((m) => m.displayName === moduleName);
    return module ? module.challenges.map((ch) => ch.name) : `Módulo '${moduleName}' no encontrado.`;
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

    if (!user_input || !assistantId) {
      return reply.status(400).send({ error: 'assistantId y user_input son requeridos.' });
    }

    // Crear un nuevo thread
    const thread = await openai.beta.threads.create();

    // Añadir mensaje del usuario al thread
    await openai.beta.threads.messages.create(thread.id, {
      role: 'user',
      content: user_input,
    });

    // Iniciar la ejecución del assistant
    const run = await openai.beta.threads.runs.create(thread.id, {
      assistant_id: assistantId,
    });

    // Polling para verificar estado
    let runStatus = await openai.beta.threads.runs.retrieve(thread.id, run.id);
    while (runStatus.status === 'in_progress') {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      runStatus = await openai.beta.threads.runs.retrieve(thread.id, run.id);
    }


    // Manejo de herramientas si las hay
    if (runStatus.required_action?.submit_tool_outputs?.tool_calls) {
      const toolCalls = runStatus.required_action.submit_tool_outputs.tool_calls;
      const toolOutputs = await handleToolCalls(toolCalls);
      await submitToolOutputs(thread.id, run.id, process.env.OPENAI_API_KEY, toolOutputs);
    }

    // Recuperar mensajes de respuesta
    const messages = await openai.beta.threads.messages.list(thread.id);
    const botReply = messages.data
      .filter((msg) => msg.role === 'assistant')
      .map((msg) => msg.content[0]?.text?.value || '')
      .join('\n');

    reply.send({ reply: botReply });
  } catch (error) {
    console.error('Error en /api/assistants/message', error);
    reply.status(500).send({ error: 'Error al procesar la solicitud.', details: error.message });
  }
});

// Iniciar el servidor
const start = async () => {
  try {
    await fastify.listen({ port: process.env.PORT || 3000, host: 'nodejs-production-3a7c.up.railway.app' });
    fastify.log.info(`Servidor corriendo en https://nodejs-production-3a7c.up.railway.app:${process.env.PORT || 3000}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
