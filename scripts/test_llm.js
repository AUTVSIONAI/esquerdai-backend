require('dotenv').config();
const aiService = require('../services/aiService');

(async () => {
  try {
    console.log('🔧 Teste LLM: iniciando geração de resposta...');
    const result = await aiService.generateResponse('Olá, escreva uma frase breve sobre o Brasil.');
    console.log('✅ Resultado LLM:', {
      success: result.success,
      provider: result.provider,
      model: result.model,
      tokensUsed: result.tokensUsed,
      preview: String(result.content).slice(0, 200)
    });
    process.exit(0);
  } catch (err) {
    console.error('❌ Falha ao gerar resposta LLM:', err);
    process.exit(1);
  }
})();