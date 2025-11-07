require('dotenv').config();
const { analyzeFakeNews } = require('../services/aiService');

(async () => {
  try {
    console.log('🔧 Teste Fake News: iniciando análise...');
    const result = await analyzeFakeNews('O Brasil tem 300 estados e a capital é São Paulo.', 'texto');
    console.log('✅ Resultado Fake News:', {
      success: result.success,
      resultado: result.resultado,
      confianca: result.confianca,
      provider: result.provider,
      model: result.model,
      explicacao_preview: String(result.explicacao || '').slice(0, 200)
    });
    process.exit(0);
  } catch (err) {
    console.error('❌ Falha na análise de Fake News:', err);
    process.exit(1);
  }
})();