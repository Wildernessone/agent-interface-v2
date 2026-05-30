// Setup deep-links for the four LLM providers (the "agents"). Tool setup lives
// next to each tool in src/tools/registry.js; this is the agent equivalent,
// shared by Settings and OnboardingPanel so the links live in exactly one place.
// URLs verified 2026-05-30.
export const AGENT_SETUP = {
  claude: {
    signupUrl:  'https://console.anthropic.com/login',
    getKeyUrl:  'https://console.anthropic.com/settings/keys',
    billingUrl: 'https://console.anthropic.com/settings/billing',
    seeText:    "Click 'Create Key', name it, and copy the sk-ant-… value.",
    note:       'Requires prepaid credits before keys work; the key is shown only once.',
  },
  gpt: {
    signupUrl:  'https://platform.openai.com/signup',
    getKeyUrl:  'https://platform.openai.com/settings/organization/api-keys',
    billingUrl: 'https://platform.openai.com/settings/organization/billing/overview',
    seeText:    "Click 'Create new secret key', name it, and copy the sk-proj-… value.",
    note:       'Requires prepaid credits (min $5); the key is shown only once.',
  },
  gemini: {
    signupUrl: 'https://aistudio.google.com/',
    getKeyUrl: 'https://aistudio.google.com/app/apikey',
    seeText:   "Click 'Create API key' — it appears in the list, fully copyable.",
    note:      'Free tier available to start; billing is handled in the linked Google Cloud project.',
  },
  grok: {
    signupUrl:  'https://console.x.ai',
    getKeyUrl:  'https://console.x.ai/team/default/api-keys',
    billingUrl: 'https://console.x.ai/team/default/billing',
    seeText:    "Click 'Create API Key', pick allowed models, and copy the xai-… string.",
    note:       'Prepaid billing; new accounts get promo credits that expire.',
  },
}
