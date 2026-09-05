import { GoogleGenAI } from '@google/genai';
import { env } from '../../../config/env.js';
import { AiProviderError, normalizeProviderError, withTimeout } from './errors.js';

const normalizeUsage = (usage = {}) => ({
  inputTokens: usage.promptTokenCount || 0,
  outputTokens: usage.candidatesTokenCount || 0,
  reasoningTokens: usage.thoughtsTokenCount || 0,
  cachedInputTokens: usage.cachedContentTokenCount || 0
});

const isSafetyResponse = (response) => response?.promptFeedback?.blockReason === 'SAFETY'
  || response?.candidates?.some((candidate) => candidate.finishReason === 'SAFETY');

export const createGeminiClient = () => {
  if (!env.GEMINI_API_KEY) throw new AiProviderError('Gemini is not configured', {
    category: 'configuration', provider: 'gemini', statusCode: 503
  });
  return new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
};

export const createGeminiSession = ({ client, systemInstruction, history, tools, timeoutMs = env.AI_PROVIDER_TIMEOUT_MS }) => {
  const chat = client.chats.create({
    model: env.GEMINI_MODEL,
    history: history.map((message) => ({
      role: message.role === 'ASSISTANT' ? 'model' : 'user',
      parts: [{ text: message.content }]
    })),
    config: {
      systemInstruction,
      tools: [{ functionDeclarations: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parametersJsonSchema: tool.parameters
      })) }],
      toolConfig: { functionCallingConfig: { mode: 'VALIDATED' } },
      maxOutputTokens: 2048
    }
  });

  const send = async (message) => {
    try {
      const response = await withTimeout(chat.sendMessage({ message }), timeoutMs, 'gemini');
      if (isSafetyResponse(response)) throw new AiProviderError('AI provider refused the request', {
        category: 'safety', provider: 'gemini', statusCode: 422, fallbackEligible: false
      });
      return {
        text: response.text || '',
        toolCalls: (response.functionCalls || []).map((call) => ({ id: call.id, name: call.name, args: call.args || {} })),
        usage: normalizeUsage(response.usageMetadata)
      };
    } catch (error) {
      throw normalizeProviderError(error, 'gemini');
    }
  };

  return {
    provider: 'gemini',
    model: env.GEMINI_MODEL,
    sendUserMessage: (content) => send(content),
    sendToolResults: (results) => send(results.map((result) => ({
      functionResponse: {
        id: result.id,
        name: result.name,
        response: result.output
      }
    })))
  };
};
