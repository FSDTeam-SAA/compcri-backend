import OpenAI from 'openai';
import { env } from '../../../config/env.js';
import { AiProviderError, normalizeProviderError, withTimeout } from './errors.js';

const normalizeUsage = (usage = {}) => ({
  inputTokens: usage.input_tokens || 0,
  outputTokens: usage.output_tokens || 0,
  reasoningTokens: usage.output_tokens_details?.reasoning_tokens || 0,
  cachedInputTokens: usage.input_tokens_details?.cached_tokens || 0
});

const responseText = (response) => response.output_text || response.output
  ?.filter((item) => item.type === 'message')
  .flatMap((item) => item.content || [])
  .filter((item) => item.type === 'output_text')
  .map((item) => item.text)
  .join('') || '';

const hasRefusal = (response) => response.output?.some((item) => item.type === 'message'
  && item.content?.some((content) => content.type === 'refusal'))
  || response.incomplete_details?.reason === 'content_filter';

export const createOpenAiClient = () => {
  if (!env.OPENAI_API_KEY) throw new AiProviderError('OpenAI is not configured', {
    category: 'configuration', provider: 'openai', statusCode: 503
  });
  return new OpenAI({ apiKey: env.OPENAI_API_KEY, timeout: env.AI_PROVIDER_TIMEOUT_MS, maxRetries: 0 });
};

export const createOpenAiSession = ({ client, systemInstruction, history, tools, timeoutMs = env.AI_PROVIDER_TIMEOUT_MS }) => {
  const input = history.map((message) => ({
    role: message.role === 'ASSISTANT' ? 'assistant' : 'user',
    content: message.content
  }));

  const payload = () => ({
    model: env.OPENAI_MODEL,
    instructions: systemInstruction,
    input,
    tools: tools.map((tool) => ({
      type: 'function',
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      strict: false
    })),
    tool_choice: 'auto',
    parallel_tool_calls: true,
    reasoning: { effort: env.OPENAI_REASONING_EFFORT },
    max_output_tokens: 2048,
    store: false
  });

  // Shared by the buffered and streamed paths: whichever way the response
  // arrived, it is read the same way and appended to the running input.
  const finish = (response) => {
    if (hasRefusal(response)) throw new AiProviderError('AI provider refused the request', {
      category: 'safety', provider: 'openai', statusCode: 422, fallbackEligible: false
    });

    const toolCalls = (response.output || [])
      .filter((item) => item.type === 'function_call')
      .map((call) => {
        try {
          return { id: call.call_id, name: call.name, args: JSON.parse(call.arguments || '{}') };
        } catch (error) {
          throw new AiProviderError('OpenAI returned malformed tool arguments', {
            category: 'invalid_response', provider: 'openai', statusCode: 502, cause: error
          });
        }
      });

    input.push(...(response.output || []));
    return { text: responseText(response), toolCalls, usage: normalizeUsage(response.usage) };
  };

  const request = async () => {
    try {
      return finish(await withTimeout(client.responses.create(payload()), timeoutMs, 'openai'));
    } catch (error) {
      throw normalizeProviderError(error, 'openai');
    }
  };

  const requestStream = async (onDelta) => {
    const consume = async () => {
      const stream = await client.responses.create({ ...payload(), stream: true });
      let completed;
      for await (const event of stream) {
        if (event.type === 'response.output_text.delta' && event.delta) onDelta(event.delta);
        if (event.type === 'error') throw new AiProviderError(event.message || 'OpenAI stream failed', {
          category: 'unavailable', provider: 'openai', statusCode: 502
        });
        // `incomplete` still carries whatever was produced — a truncated answer
        // beats discarding the turn and burning the user's quota for nothing.
        if (['response.completed', 'response.incomplete'].includes(event.type)) completed = event.response;
        if (event.type === 'response.failed') throw new AiProviderError(
          event.response?.error?.message || 'OpenAI reported a failed response',
          { category: 'unavailable', provider: 'openai', statusCode: 502 }
        );
      }
      if (!completed) throw new AiProviderError('OpenAI stream ended without a response', {
        category: 'invalid_response', provider: 'openai', statusCode: 502
      });
      return completed;
    };

    try {
      // One timeout for the whole stream: a stall mid-answer is the failure
      // that matters, not just a slow first byte.
      return finish(await withTimeout(consume(), timeoutMs, 'openai'));
    } catch (error) {
      throw normalizeProviderError(error, 'openai');
    }
  };

  const pushToolResults = (results) => input.push(...results.map((result) => ({
    type: 'function_call_output',
    call_id: result.id,
    output: JSON.stringify(result.output)
  })));

  return {
    provider: 'openai',
    model: env.OPENAI_MODEL,
    sendUserMessage: async (content) => {
      input.push({ role: 'user', content });
      return request();
    },
    sendToolResults: async (results) => {
      pushToolResults(results);
      return request();
    },
    sendUserMessageStream: async (content, onDelta) => {
      input.push({ role: 'user', content });
      return requestStream(onDelta);
    },
    sendToolResultsStream: async (results, onDelta) => {
      pushToolResults(results);
      return requestStream(onDelta);
    }
  };
};
