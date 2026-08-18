// ===== AI 适配器（BYOK）=====
// 兼容所有 OpenAI 接口格式的服务：DeepSeek / OpenAI / 通义 / Kimi / Moonshot / Ollama 等
// 配置存 localStorage：baseURL / apiKey / model
// 未配置 key 时，调用方应回退到固定模板。

const DEFAULTS = {
  baseURL: 'https://api.deepseek.com',
  model: 'deepseek-chat',
};

export function getAIConfig() {
  return {
    baseURL: localStorage.getItem('ai_baseURL') || DEFAULTS.baseURL,
    apiKey: localStorage.getItem('ai_apiKey') || '',
    model: localStorage.getItem('ai_model') || DEFAULTS.model,
  };
}

export function setAIConfig({ baseURL, apiKey, model }) {
  if (baseURL !== undefined) localStorage.setItem('ai_baseURL', baseURL);
  if (apiKey !== undefined) localStorage.setItem('ai_apiKey', apiKey);
  if (model !== undefined) localStorage.setItem('ai_model', model);
}

export function hasAIKey() {
  return !!getAIConfig().apiKey;
}

// 调用 chat 补全，返回文本
export async function chat(messages, { temperature = 0.8, maxTokens = 300 } = {}) {
  const { baseURL, apiKey, model } = getAIConfig();
  if (!apiKey) throw new Error('未配置 AI key');

  const url = baseURL.replace(/\/$/, '') + '/chat/completions';
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`AI 请求失败 (${res.status})：${body.slice(0, 200)}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || '';
}
