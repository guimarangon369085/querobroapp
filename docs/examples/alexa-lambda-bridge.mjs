// Lambda sample for Alexa Custom Skill -> QUEROBROAPP bridge.
// Runtime: Node.js 20.x
// Env vars:
// - APP_BRIDGE_URL: https://<seu-endpoint-publico>/alexa/bridge
// - APP_BRIDGE_TOKEN: mesmo valor de ALEXA_BRIDGE_TOKEN no backend
// - APP_BRIDGE_HMAC_SECRET: mesmo valor de ALEXA_BRIDGE_HMAC_SECRET no backend

import Alexa from 'ask-sdk-core';
import crypto from 'node:crypto';

const APP_BRIDGE_URL = (process.env.APP_BRIDGE_URL || '').trim();
const APP_BRIDGE_TOKEN = (process.env.APP_BRIDGE_TOKEN || '').trim();
const APP_BRIDGE_HMAC_SECRET = (process.env.APP_BRIDGE_HMAC_SECRET || '').trim();

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function extractSlots(intent) {
  const result = {};
  const slots = intent?.slots || {};
  for (const [key, raw] of Object.entries(slots)) {
    const value = typeof raw?.value === 'string' ? raw.value.trim() : '';
    if (!value) continue;
    result[key] = value;
  }
  return result;
}

async function callBridge(handlerInput, intentName = '') {
  if (!APP_BRIDGE_URL) {
    throw new Error('APP_BRIDGE_URL ausente.');
  }
  if (!APP_BRIDGE_TOKEN) {
    throw new Error('APP_BRIDGE_TOKEN ausente.');
  }
  if (!APP_BRIDGE_HMAC_SECRET) {
    throw new Error('APP_BRIDGE_HMAC_SECRET ausente.');
  }

  const requestEnvelope = handlerInput.requestEnvelope || {};
  const request = requestEnvelope.request || {};
  const session = requestEnvelope.session || {};
  const app = session.application || {};
  const user = session.user || {};

  const payload = {
    applicationId: app.applicationId || '',
    userId: user.userId || '',
    locale: request.locale || 'pt-BR',
    requestType: request.type || '',
    requestId: request.requestId || '',
    intentName,
    slots: extractSlots(request.intent),
    utterance: request?.intent?.name || '',
    accessToken: user.accessToken || ''
  };

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const canonicalBody = stableStringify(payload);
  const signature = crypto
    .createHmac('sha256', APP_BRIDGE_HMAC_SECRET)
    .update(`${timestamp}.${canonicalBody}`)
    .digest('hex');

  const response = await fetch(APP_BRIDGE_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-alexa-token': APP_BRIDGE_TOKEN,
      'x-alexa-timestamp': timestamp,
      'x-alexa-signature': `sha256=${signature}`
    },
    body: canonicalBody
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Bridge HTTP ${response.status}: ${text}`);
  }

  return response.json();
}

const LaunchRequestHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'LaunchRequest';
  },
  async handle(handlerInput) {
    const bridge = await callBridge(handlerInput, '');
    return handlerInput.responseBuilder
      .speak(bridge.speechText || 'Conexao pronta com o QUEROBROAPP.')
      .reprompt('Diga um comando para iniciar uma automacao.')
      .getResponse();
  }
};

const IntentRequestHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest';
  },
  async handle(handlerInput) {
    const intentName = Alexa.getIntentName(handlerInput.requestEnvelope);
    const bridge = await callBridge(handlerInput, intentName);

    const shouldEndSession = Boolean(bridge?.shouldEndSession);
    const speech = bridge?.speechText || 'Comando processado.';

    const builder = handlerInput.responseBuilder.speak(speech);
    if (!shouldEndSession) {
      builder.reprompt('Pode repetir o comando.');
    }
    return builder.getResponse();
  }
};

const ErrorHandler = {
  canHandle() {
    return true;
  },
  handle(handlerInput, error) {
    console.error(error);
    return handlerInput.responseBuilder
      .speak('Nao consegui processar agora. Tente novamente em instantes.')
      .getResponse();
  }
};

export const handler = Alexa.SkillBuilders.custom()
  .addRequestHandlers(LaunchRequestHandler, IntentRequestHandler)
  .addErrorHandlers(ErrorHandler)
  .lambda();
