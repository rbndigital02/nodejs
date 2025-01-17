const { OpenAI } = require('openai');
const config = require('../config/config');

class AssistantService {
  constructor() {
    this.openai = new OpenAI({ apiKey: config.openai.apiKey });
    this.TIMEOUT = config.assistant.timeout;
    this.MAX_RETRIES = config.assistant.maxRetries;
  }

  async validateAssistant(assistantId) {
    if (!assistantId.startsWith('asst_')) {
      throw new Error('ID de asistente inválido');
    }
    return await this.openai.beta.assistants.retrieve(assistantId);
  }

  async createThread() {
    return await this.openai.beta.threads.create();
  }

  async addMessageToThread(threadId, content) {
    return await this.openai.beta.threads.messages.create(threadId, {
      role: 'user',
      content
    });
  }

  async createRun(threadId, assistantId) {
    return await this.openai.beta.threads.runs.create(threadId, {
      assistant_id: assistantId
    });
  }

  async handleToolCalls(toolCalls) {
    return Promise.all(
      toolCalls.map(async (toolCall) => {
        const toolName = toolCall.function.name;
        const toolFunction = this.registeredTools[toolName];
        if (!toolFunction) throw new Error(`Tool ${toolName} is not implemented`);
        const args = JSON.parse(toolCall.function.arguments);
        const output = await toolFunction(args);
        return { tool_call_id: toolCall.id, output: JSON.stringify(output) };
      })
    );
  }

  async submitToolOutputs(threadId, runId, toolOutputs) {
    return await this.openai.beta.threads.runs.submitToolOutputs(threadId, runId, {
      tool_outputs: toolOutputs
    });
  }

  async pollRunStatus(threadId, runId) {
    const startTime = Date.now();
    let retryCount = 0;
    let runStatus = await this.openai.beta.threads.runs.retrieve(threadId, runId);

    while (['in_progress', 'queued'].includes(runStatus.status)) {
      if (Date.now() - startTime > this.TIMEOUT) {
        throw new Error('Timeout esperando respuesta del asistente');
      }

      await new Promise(resolve => setTimeout(resolve, 1000));

      try {
        runStatus = await this.openai.beta.threads.runs.retrieve(threadId, runId);
      } catch (error) {
        retryCount++;
        if (retryCount > this.MAX_RETRIES) throw error;
        await new Promise(resolve => setTimeout(resolve, 2000));
        continue;
      }

      if (runStatus.status === 'requires_action') {
        const toolCalls = runStatus.required_action?.submit_tool_outputs?.tool_calls;
        if (toolCalls) {
          const toolOutputs = await this.handleToolCalls(toolCalls);
          await this.submitToolOutputs(threadId, runId, toolOutputs);
          runStatus = await this.openai.beta.threads.runs.retrieve(threadId, runId);
        }
      }
    }

    return runStatus;
  }

  async getAssistantResponse(threadId) {
    const messages = await this.openai.beta.threads.messages.list(threadId);
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

    return botReply;
  }

  async cancelRun(threadId, runId) {
    try {
      await this.openai.beta.threads.runs.cancel(threadId, runId);
    } catch (error) {
      console.warn('Error cancelando run:', error);
    }
  }
}

module.exports = new AssistantService();
