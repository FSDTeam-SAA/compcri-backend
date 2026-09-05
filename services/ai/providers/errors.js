export const emptyUsage = () => ({
  inputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  cachedInputTokens: 0
});

export const addUsage = (target, usage = {}) => {
  target.inputTokens += usage.inputTokens || 0;
  target.outputTokens += usage.outputTokens || 0;
  target.reasoningTokens += usage.reasoningTokens || 0;
  target.cachedInputTokens += usage.cachedInputTokens || 0;
  return target;
};

export class AiProviderError extends Error {
  constructor(message, { category = 'unavailable', provider, statusCode, fallbackEligible = true, usage, cause } = {}) {
    super(message, { cause });
    this.name = 'AiProviderError';
    this.category = category;
    this.provider = provider;
    this.statusCode = statusCode;
    this.fallbackEligible = fallbackEligible;
    this.usage = usage || emptyUsage();
  }
}

export const withTimeout = async (operation, timeoutMs, provider) => {
  let timer;
  try {
    return await Promise.race([
      operation,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new AiProviderError('AI provider timed out', {
          category: 'timeout', provider, statusCode: 504
        })), timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
};

export const normalizeProviderError = (error, provider) => {
  if (error instanceof AiProviderError) return error;
  const statusCode = error?.status || error?.statusCode;
  const message = error?.message || 'AI provider request failed';
  if (['AbortError', 'TimeoutError'].includes(error?.name) || /timed?\s*out/i.test(message)) {
    return new AiProviderError('AI provider timed out', { category: 'timeout', provider, statusCode: 504, cause: error });
  }
  if (statusCode === 429) return new AiProviderError(message, { category: 'rate_limit', provider, statusCode, cause: error });
  if ([401, 403].includes(statusCode)) return new AiProviderError(message, { category: 'authentication', provider, statusCode, cause: error });
  if (statusCode >= 500) return new AiProviderError(message, { category: 'unavailable', provider, statusCode, cause: error });
  return new AiProviderError(message, { category: 'invalid_response', provider, statusCode, cause: error });
};
