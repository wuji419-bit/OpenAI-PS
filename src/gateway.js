// OpenAI-compatible gateway contract. Model identifiers are opaque gateway IDs.
// Selecting a protocol is explicit: an HTTP error must never change it.
function path(value, fallback) {
  const text = String(value || fallback).trim();
  return text.startsWith('/') ? text : `/${text}`;
}

function configuration(settings = {}) {
  const protocol = settings.apiProtocol || 'images';
  if (protocol !== 'images' && protocol !== 'responses') {
    throw new Error(`不支持的 API 协议：${protocol}`);
  }
  return Object.freeze({
    protocol,
    generationPath: path(settings.generationPath, '/images/generations'),
    editPath: path(settings.editPath, '/images/edits'),
    responsesPath: path(settings.responsesPath, '/responses'),
    responsesModel: String(settings.responsesModel || 'gpt-5.5').trim(),
    fastModel: String(settings.fastModel || 'gpt-image-2.5-flare').trim(),
    deepModel: String(settings.deepModel || 'gpt-image-2.5-sunburst').trim(),
  });
}

module.exports = { configuration };
