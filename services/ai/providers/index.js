import { createGeminiClient, createGeminiSession } from './gemini.js';
import { createOpenAiClient, createOpenAiSession } from './openai.js';

const clientOverrides = { gemini: null, openai: null };
const clients = { gemini: null, openai: null };

const clientFactory = { gemini: createGeminiClient, openai: createOpenAiClient };
const sessionFactory = { gemini: createGeminiSession, openai: createOpenAiSession };

export const getAiProviderClient = (provider) => {
  if (clientOverrides[provider]) return clientOverrides[provider];
  if (!clients[provider]) clients[provider] = clientFactory[provider]();
  return clients[provider];
};

export const createAiProviderSession = (provider, options) => sessionFactory[provider]({
  ...options,
  client: getAiProviderClient(provider)
});

export const setAiProviderClientForTests = (provider, client) => {
  clientOverrides[provider] = client;
};

export const resetAiProviderClientsForTests = () => {
  clientOverrides.gemini = null;
  clientOverrides.openai = null;
  clients.gemini = null;
  clients.openai = null;
};

export const fallbackProviderFor = (provider) => provider === 'gemini' ? 'openai' : 'gemini';
