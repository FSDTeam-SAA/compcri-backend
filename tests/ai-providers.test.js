import { describe, expect, it, vi } from 'vitest';
import { createGeminiSession } from '../services/ai/providers/gemini.js';
import { createOpenAiSession } from '../services/ai/providers/openai.js';
import { AiProviderError } from '../services/ai/providers/errors.js';

const tools = [{
  name: 'list_events',
  description: 'List events',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: { from: { type: 'string' }, to: { type: 'string' } },
    required: ['from', 'to']
  }
}];

describe('AI provider adapters', () => {
  it('maps Gemini history, tools, function calls, and usage into the common session contract', async () => {
    const sendMessage = vi.fn()
      .mockResolvedValueOnce({
        functionCalls: [{ id: 'call-gemini', name: 'list_events', args: { from: '2026-09-01T00:00:00Z', to: '2026-09-02T00:00:00Z' } }],
        usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 4, thoughtsTokenCount: 2 }
      })
      .mockResolvedValueOnce({ text: 'One event.', usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 3 } });
    const create = vi.fn(() => ({ sendMessage }));
    const session = createGeminiSession({
      client: { chats: { create } },
      systemInstruction: 'Calendar assistant',
      history: [{ role: 'USER', content: 'Earlier question' }, { role: 'ASSISTANT', content: 'Earlier answer' }],
      tools,
      timeoutMs: 1000
    });

    const first = await session.sendUserMessage('List tomorrow');
    expect(first.toolCalls[0]).toMatchObject({ id: 'call-gemini', name: 'list_events' });
    expect(first.usage).toMatchObject({ inputTokens: 12, outputTokens: 4, reasoningTokens: 2 });
    await session.sendToolResults([{ id: 'call-gemini', name: 'list_events', output: { output: [] } }]);

    expect(create.mock.calls[0][0].history).toEqual([
      { role: 'user', parts: [{ text: 'Earlier question' }] },
      { role: 'model', parts: [{ text: 'Earlier answer' }] }
    ]);
    expect(create.mock.calls[0][0].config.tools[0].functionDeclarations[0].parametersJsonSchema).toEqual(tools[0].parameters);
    expect(sendMessage.mock.calls[1][0].message[0].functionResponse).toMatchObject({ id: 'call-gemini', name: 'list_events' });
  });

  it('replays OpenAI response items and function outputs with store disabled', async () => {
    const functionCall = {
      type: 'function_call',
      id: 'fc_1',
      call_id: 'call-openai',
      name: 'list_events',
      arguments: JSON.stringify({ from: '2026-09-01T00:00:00Z', to: '2026-09-02T00:00:00Z' })
    };
    const create = vi.fn()
      .mockResolvedValueOnce({
        output: [functionCall],
        usage: { input_tokens: 20, output_tokens: 6, output_tokens_details: { reasoning_tokens: 4 }, input_tokens_details: { cached_tokens: 5 } }
      })
      .mockResolvedValueOnce({ output: [], output_text: 'One event.', usage: { input_tokens: 10, output_tokens: 3 } });
    const session = createOpenAiSession({
      client: { responses: { create } },
      systemInstruction: 'Calendar assistant',
      history: [{ role: 'ASSISTANT', content: 'Earlier answer' }],
      tools,
      timeoutMs: 1000
    });

    const first = await session.sendUserMessage('List tomorrow');
    expect(first.toolCalls[0]).toMatchObject({ id: 'call-openai', name: 'list_events' });
    expect(first.usage).toEqual({ inputTokens: 20, outputTokens: 6, reasoningTokens: 4, cachedInputTokens: 5 });
    const second = await session.sendToolResults([{ id: 'call-openai', name: 'list_events', output: { output: [] } }]);
    expect(second.text).toBe('One event.');

    const firstRequest = create.mock.calls[0][0];
    const secondRequest = create.mock.calls[1][0];
    expect(firstRequest).toMatchObject({ store: false, reasoning: { effort: 'none' }, parallel_tool_calls: true });
    expect(firstRequest.input[0]).toEqual({ role: 'assistant', content: 'Earlier answer' });
    expect(secondRequest.input).toContain(functionCall);
    expect(secondRequest.input).toContainEqual({ type: 'function_call_output', call_id: 'call-openai', output: JSON.stringify({ output: [] }) });
  });

  it('marks safety refusals as ineligible for fallback', async () => {
    const session = createOpenAiSession({
      client: { responses: { create: vi.fn(async () => ({ output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'No' }] }] })) } },
      systemInstruction: 'Calendar assistant', history: [], tools, timeoutMs: 1000
    });
    await expect(session.sendUserMessage('Unsafe request')).rejects.toMatchObject({
      name: 'AiProviderError', category: 'safety', fallbackEligible: false
    });
  });

  it('rejects malformed OpenAI tool arguments as a fallback-eligible provider error', async () => {
    const session = createOpenAiSession({
      client: { responses: { create: vi.fn(async () => ({
        output: [{ type: 'function_call', call_id: 'call-bad', name: 'list_events', arguments: '{bad json' }]
      })) } },
      systemInstruction: 'Calendar assistant', history: [], tools, timeoutMs: 1000
    });
    await expect(session.sendUserMessage('List tomorrow')).rejects.toBeInstanceOf(AiProviderError);
    await expect(session.sendUserMessage('List tomorrow')).rejects.toMatchObject({ category: 'invalid_response', fallbackEligible: true });
  });

  it('normalizes provider timeouts', async () => {
    const session = createGeminiSession({
      client: { chats: { create: () => ({ sendMessage: () => new Promise(() => {}) }) } },
      systemInstruction: 'Calendar assistant', history: [], tools, timeoutMs: 10
    });
    await expect(session.sendUserMessage('List tomorrow')).rejects.toMatchObject({ category: 'timeout', fallbackEligible: true });
  });

  const streamOf = (chunks) => (async function* generate() {
    for (const chunk of chunks) yield chunk;
  })();

  it('reports Gemini text as it streams and still returns the whole turn', async () => {
    const sendMessageStream = vi.fn(async () => streamOf([
      { text: 'One ' },
      { text: 'event.' },
      { functionCalls: [{ id: 'call-1', name: 'list_events', args: {} }], usageMetadata: { promptTokenCount: 9, candidatesTokenCount: 5 } }
    ]));
    const session = createGeminiSession({
      client: { chats: { create: () => ({ sendMessageStream }) } },
      systemInstruction: 'Calendar assistant', history: [], tools, timeoutMs: 1000
    });

    const deltas = [];
    const result = await session.sendUserMessageStream('List tomorrow', (text) => deltas.push(text));

    expect(deltas).toEqual(['One ', 'event.']);
    expect(result.text).toBe('One event.');
    expect(result.toolCalls[0]).toMatchObject({ id: 'call-1', name: 'list_events' });
    expect(result.usage).toMatchObject({ inputTokens: 9, outputTokens: 5 });
  });

  it('reports OpenAI text as it streams and reads the completed response', async () => {
    const completed = {
      output: [{ type: 'function_call', call_id: 'call-2', name: 'list_events', arguments: '{}' }],
      output_text: 'One event.',
      usage: { input_tokens: 11, output_tokens: 4 }
    };
    const create = vi.fn(async () => streamOf([
      { type: 'response.output_text.delta', delta: 'One ' },
      { type: 'response.output_text.delta', delta: 'event.' },
      { type: 'response.completed', response: completed }
    ]));
    const session = createOpenAiSession({
      client: { responses: { create } },
      systemInstruction: 'Calendar assistant', history: [], tools, timeoutMs: 1000
    });

    const deltas = [];
    const result = await session.sendUserMessageStream('List tomorrow', (text) => deltas.push(text));

    expect(deltas).toEqual(['One ', 'event.']);
    expect(create.mock.calls[0][0].stream).toBe(true);
    expect(result.text).toBe('One event.');
    expect(result.toolCalls[0]).toMatchObject({ id: 'call-2', name: 'list_events' });
    expect(result.usage).toMatchObject({ inputTokens: 11, outputTokens: 4 });
  });

  it('fails a stream that ends without a response instead of saving nothing', async () => {
    const session = createOpenAiSession({
      client: { responses: { create: vi.fn(async () => streamOf([{ type: 'response.output_text.delta', delta: 'half' }])) } },
      systemInstruction: 'Calendar assistant', history: [], tools, timeoutMs: 1000
    });
    await expect(session.sendUserMessageStream('List tomorrow', () => {}))
      .rejects.toMatchObject({ category: 'invalid_response', fallbackEligible: true });
  });

  it('times out a stream that stalls part-way through', async () => {
    const stalled = (async function* generate() {
      yield { text: 'One ' };
      await new Promise(() => {});
    })();
    const session = createGeminiSession({
      client: { chats: { create: () => ({ sendMessageStream: async () => stalled }) } },
      systemInstruction: 'Calendar assistant', history: [], tools, timeoutMs: 20
    });
    await expect(session.sendUserMessageStream('List tomorrow', () => {}))
      .rejects.toMatchObject({ category: 'timeout', fallbackEligible: true });
  });
});
