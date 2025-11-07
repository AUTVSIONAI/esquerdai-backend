const { supabase } = require('../config/supabase');

// Função para analisar metadados de imagem sem enviar o conteúdo completo
function analyzeImageMetadata(dataUrl) {
  try {
    // Extrair informações do data URL
    const [header, base64Data] = dataUrl.split(',');
    const mimeMatch = header.match(/data:image\/(\w+)/);
    const format = mimeMatch ? mimeMatch[1].toUpperCase() : 'UNKNOWN';
    
    // Calcular tamanho aproximado
    const sizeBytes = Math.round((base64Data.length * 3) / 4);
    const sizeKB = Math.round(sizeBytes / 1024);
    const size = sizeKB > 1024 ? `${Math.round(sizeKB / 1024)}MB` : `${sizeKB}KB`;
    
    // Verificar se contém indicadores de C2PA nos metadados
    // C2PA geralmente aparece em formatos como JPEG, PNG, WebP
    const hasC2PA = base64Data.includes('c2pa') || 
                    base64Data.includes('C2PA') || 
                    base64Data.includes('contentauthenticity') ||
                    header.includes('c2pa');
    
    return {
      format,
      size,
      hasC2PA,
      sizeBytes
    };
  } catch (error) {
    console.error('Erro ao analisar metadados da imagem:', error);
    return {
      format: 'UNKNOWN',
      size: 'UNKNOWN',
      hasC2PA: false,
      sizeBytes: 0
    };
  }
}

// Limites por plano
const PLAN_LIMITS = {
  gratuito: 10,
  engajado: 50,
  premium: 200
};

// Verificar limites de uso do usuário
async function checkUserLimits(userId, userPlan = 'gratuito') {
  try {
    const today = new Date().toISOString().split('T')[0];
    
    // Contar conversas de hoje
    const { count: todayUsage, error } = await supabase
      .from('ai_conversations')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('created_at', today + 'T00:00:00.000Z')
      .lt('created_at', today + 'T23:59:59.999Z');

    if (error) {
      console.warn('⚠️ Supabase indisponível ao checar limites, usando padrão de desenvolvimento');
      const limitFallback = PLAN_LIMITS[userPlan] || PLAN_LIMITS.gratuito;
      return {
        canUse: true,
        used: 0,
        limit: limitFallback,
        remaining: limitFallback
      };
    }

    const limit = PLAN_LIMITS[userPlan] || PLAN_LIMITS.gratuito;
    const used = todayUsage || 0;
    const remaining = Math.max(0, limit - used);
    const canUse = used < limit;

    return {
      canUse,
      used,
      limit,
      remaining
    };
  } catch (error) {
    console.error('Error in checkUserLimits:', error);
    return {
      canUse: false,
      used: 0,
      limit: 0,
      remaining: 0
    };
  }
}

// Lista de modelos gratuitos da OpenRouter para fallback inteligente
const FREE_OPENROUTER_MODELS = [
  'meta-llama/llama-3.3-70b-instruct:free',
  'google/gemini-2.0-flash-exp:free',
  'nvidia/llama-3.1-nemotron-ultra-253b-v1:free',
  'google/gemma-3-27b-it:free',
  'qwen/qwq-32b:free',
  'deepseek/deepseek-chat-v3-0324:free',
  'google/gemini-2.5-pro-exp-03-25:free',
  'mistralai/mistral-small-3.1-24b-instruct:free',
  'meta-llama/llama-4-maverick:free',
  'meta-llama/llama-4-scout:free'
];

// Função para chamar OpenRouter com modelo específico
async function callOpenRouterModel(message, systemPrompt, model) {
  const openRouterKey = process.env.OPENROUTER_API_KEY;
  
  if (!openRouterKey) {
    throw new Error('OPENROUTER_API_KEY não configurada');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 25000); // 25 segundos timeout

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openRouterKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://esquerdai.com',
        'X-Title': 'EsquerdaGPT - Assistente IA Progressista'
      },
      body: JSON.stringify({
        model: model,
        messages: [
          {
            role: 'system',
            content: systemPrompt
          },
          {
            role: 'user',
            content: message
          }
        ],
        max_tokens: 500,
        temperature: 0.7
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorData = await response.text();
      console.error(`Erro no modelo ${model}:`, response.status, errorData);
      throw new Error(`OpenRouter API Error: ${response.status}`);
    }

    const data = await response.json();
    return {
      content: data.choices[0]?.message?.content || 'Desculpe, não consegui processar sua mensagem.',
      tokensUsed: data.usage?.total_tokens || 100,
      model: model,
      provider: 'openrouter',
      cost: 0
    };
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

// Função para chamar Together.ai API como fallback final
async function callTogetherAPI(message, systemPrompt) {
  const togetherKey = process.env.TOGETHER_API_KEY;
  
  if (!togetherKey) {
    throw new Error('TOGETHER_API_KEY não configurada');
  }

  const response = await fetch('https://api.together.xyz/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${togetherKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo',
      messages: [
        {
          role: 'system',
          content: systemPrompt
        },
        {
          role: 'user',
          content: message
        }
      ],
      max_tokens: 500,
      temperature: 0.7
    })
  });

  if (!response.ok) {
    const errorData = await response.text();
    console.error('Erro na Together.ai API:', response.status, errorData);
    throw new Error(`Together API Error: ${response.status}`);
  }

  const data = await response.json();
  return {
    content: data.choices[0]?.message?.content || 'Desculpe, não consegui processar sua mensagem.',
    tokensUsed: data.usage?.total_tokens || 100,
    model: 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo',
    provider: 'together',
    cost: 0
  };
}

// Sistema de dispatcher inteligente que tenta múltiplas LLMs
async function smartDispatcher(message, systemPrompt) {
  const openRouterKey = process.env.OPENROUTER_API_KEY;
  const togetherKey = process.env.TOGETHER_API_KEY;
  
  // Primeiro, tenta o Claude 3.5 Sonnet (modelo principal)
  if (openRouterKey) {
    try {
      console.log('🎯 Tentando Claude 3.5 Sonnet...');
      const result = await callOpenRouterModel(message, systemPrompt, 'anthropic/claude-3.5-sonnet');
      console.log('✅ Claude 3.5 Sonnet funcionou!');
      return result;
    } catch (error) {
      console.log('❌ Claude 3.5 Sonnet falhou:', error.message);
      
      // Se for erro 402 (sem créditos), tenta os modelos gratuitos
      if (error.message.includes('402')) {
        console.log('💡 Tentando modelos gratuitos da OpenRouter...');
        
        for (const model of FREE_OPENROUTER_MODELS) {
          try {
            console.log(`🔄 Tentando ${model}...`);
            const result = await callOpenRouterModel(message, systemPrompt, model);
            console.log(`✅ ${model} funcionou!`);
            return result;
          } catch (modelError) {
            console.log(`❌ ${model} falhou:`, modelError.message);
            continue; // Tenta o próximo modelo
          }
        }
        
        console.log('⚠️ Todos os modelos gratuitos da OpenRouter falharam');
      }
    }
  }
  
  // Se OpenRouter falhou completamente, tenta Together.ai
  if (togetherKey) {
    try {
      console.log('🔄 Tentando Together.ai como fallback...');
      const result = await callTogetherAPI(message, systemPrompt);
      console.log('✅ Together.ai funcionou!');
      return result;
    } catch (error) {
      console.log('❌ Together.ai também falhou:', error.message);
    }
  }
  
  // Se tudo falhou, retorna fallback interno
  console.log('🆘 Usando fallback interno');
  throw new Error('Todos os provedores de IA falharam');
}

// Gerar resposta da IA usando sistema de dispatcher inteligente
async function generateResponse(message) {
  const openRouterKey = process.env.OPENROUTER_API_KEY;
  const togetherKey = process.env.TOGETHER_API_KEY;
  
  if (!openRouterKey && !togetherKey) {
    console.warn('Nenhuma chave de API configurada, usando resposta de fallback');
    const fallbackResponses = [
      "Como progressista, defendo justiça social, direitos humanos e políticas públicas inclusivas.",
      "Fortalecer saúde, educação e proteção social é essencial para reduzir desigualdades.",
      "Combater racismo, violência e desinformação requer compromisso democrático e políticas baseadas em evidências.",
      "A transição ecológica justa e o desenvolvimento sustentável devem orientar o crescimento econômico.",
      "Valorizo diversidade, trabalho digno e participação popular para um Brasil mais igualitário."
    ];
    
    return {
      success: true,
      content: fallbackResponses[Math.floor(Math.random() * fallbackResponses.length)],
      model: 'esquerdaGPT-fallback',
      provider: 'internal',
      tokensUsed: 50
    };
  }

  try {
    const systemPrompt = `Você é o EsquerdaGPT, um assistente de IA com perspectiva progressista brasileira.
Suas características:
- Defende justiça social, direitos humanos, igualdade e democracia participativa
- Valoriza saúde, educação pública, cultura, ciência e trabalho digno
- Apoia políticas ambientais e transição ecológica justa
- Combate racismo, misoginia, LGBTQ+fobia e qualquer forma de discriminação
- Baseia respostas em evidências, dados públicos e respeito institucional

Responda com clareza, empatia e foco na redução de desigualdades, propondo caminhos concretos e inclusivos.`;

    console.log('🚀 Iniciando sistema de dispatcher inteligente...');
    const result = await smartDispatcher(message, systemPrompt);
    
    return {
      success: true,
      content: result.content,
      model: result.model,
      provider: result.provider,
      tokensUsed: result.tokensUsed,
      cost: result.cost || 0
    };
    
  } catch (error) {
    console.error('Erro ao gerar resposta da IA:', error);
    
    // Fallback para respostas progressistas básicas
    const fallbackResponses = [
      "Como progressista, acredito que políticas públicas fortes reduzem desigualdades e ampliam direitos.",
      "É fundamental garantir acesso universal a saúde e educação, com investimento e transparência.",
      "A democracia se fortalece com participação social, respeito às instituições e combate à desinformação.",
      "Defendo transição energética justa, proteção ambiental e desenvolvimento com inclusão.",
      "Diversidade e direitos civis são pilares para um país mais seguro e solidário."
    ];
    
    return {
      success: true,
      content: fallbackResponses[Math.floor(Math.random() * fallbackResponses.length)],
      model: 'esquerdaGPT-fallback',
      provider: 'fallback',
      tokensUsed: 50
    };
  }
}

// Salvar conversa no banco de dados
async function saveConversation(userId, conversationId, userMessage, aiResponse, tokensUsed, model, provider) {
  try {
    console.log('💾 Salvando conversa no banco de dados...');
    console.log('📋 Estrutura real da tabela ai_conversations: id, user_id, conversation_id, message, response, tokens_used, created_at, model_used, provider_used');
    
    // Usar a estrutura real da tabela ai_conversations
    const { error: conversationError } = await supabase
      .from('ai_conversations')
      .insert({
        user_id: userId,
        conversation_id: conversationId,
        message: userMessage,
        response: aiResponse,
        tokens_used: tokensUsed || 0,
        model_used: model || 'unknown',
        provider_used: provider || 'unknown',
        created_at: new Date().toISOString()
      });

    if (conversationError) {
      console.error('Error saving conversation:', conversationError);
    } else {
      console.log('✅ Conversa salva com sucesso');
    }

    // Nota: A tabela ai_messages parece não ter a estrutura esperada
    // Vamos comentar por enquanto até verificarmos a estrutura correta
    console.log('⚠️ Tabela ai_messages não tem estrutura compatível - pulando salvamento de mensagens individuais');

    return {
      success: true
    };
  } catch (error) {
    console.error('Error in saveConversation:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// Buscar conversas do usuário
async function getUserConversations(userId, limit = 50) {
  try {
    const { data: conversations, error } = await supabase
      .from('ai_conversations')
      .select('id, conversation_id, message, response, created_at, tokens_used, model_used')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('Error fetching conversations:', error);
      return {
        success: false,
        error: error.message
      };
    }

    // Transformar os dados para o formato esperado pelo frontend
    const formattedConversations = conversations?.map(conv => ({
      id: conv.id,
      conversation_id: conv.conversation_id,
      title: conv.message?.substring(0, 50) + '...' || 'Conversa sem título',
      created_at: conv.created_at,
      updated_at: conv.created_at,
      message_count: 2, // Sempre 2 (pergunta + resposta)
      last_message_preview: conv.response?.substring(0, 100) || ''
    })) || [];

    return {
      success: true,
      data: formattedConversations
    };
  } catch (error) {
    console.error('Error in getUserConversations:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// Função específica para análise de fake news
async function analyzeFakeNews(content, contentType = 'texto') {
  try {
    let analysisPrompt = '';
    
    if (contentType === 'link') {
      analysisPrompt = `Você é um especialista em verificação de fatos e detecção de fake news. 
Analise o seguinte link/URL e determine se o conteúdo é:
- VERDADE: Informação verificada e confiável
- TENDENCIOSO: Parcialmente verdadeiro mas com viés
- FAKE: Informação falsa ou enganosa

Link para análise: ${content}

Responda APENAS no seguinte formato JSON:
{
  "resultado": "verdade|tendencioso|fake",
  "confianca": 85,
  "explicacao": "Explicação detalhada da análise",
  "fontes": ["fonte1.com", "fonte2.com"]
}`;
    } else if (contentType === 'imagem' && content.startsWith('data:image/')) {
      // Para imagens, usar análise visual com IA
      console.log('🖼️ Analisando imagem com IA...');
      const imageInfo = analyzeImageMetadata(content);
      console.log('📊 Metadados da imagem:', imageInfo);
      
      analysisPrompt = `Você é um especialista em verificação de fatos e análise de imagens.
Analise esta imagem e determine se é:
- VERDADE: Imagem autêntica e não manipulada
- TENDENCIOSO: Imagem real mas usada fora de contexto ou com informações parciais
- FAKE: Imagem manipulada, gerada por IA, ou completamente falsa

Descreva detalhadamente:
1. O que você vê na imagem (pessoas, objetos, cenário, etc.)
2. Sinais de manipulação digital ou geração por IA
3. Qualidade da imagem e possíveis inconsistências
4. Contexto provável da imagem

Informações técnicas: Formato ${imageInfo.format}, Tamanho: ${imageInfo.size}${imageInfo.hasC2PA ? ', Contém metadados C2PA (indicador de autenticidade)' : ', Sem metadados C2PA'}

Responda APENAS no seguinte formato JSON:
{
  "resultado": "verdade|tendencioso|fake",
  "confianca": 85,
  "explicacao": "Descrição detalhada do que foi observado na imagem e análise de autenticidade",
  "fontes": ["fonte1.com", "fonte2.com"]
}`;
    } else {
      analysisPrompt = `Você é um especialista em verificação de fatos e detecção de fake news.
Analise o seguinte conteúdo e determine se é:
- VERDADE: Informação verificada e confiável
- TENDENCIOSO: Parcialmente verdadeiro mas com viés
- FAKE: Informação falsa ou enganosa

Conteúdo para análise:
${content}

Responda APENAS no seguinte formato JSON:
{
  "resultado": "verdade|tendencioso|fake",
  "confianca": 85,
  "explicacao": "Explicação detalhada da análise baseada em fatos verificáveis",
  "fontes": ["fonte1.com", "fonte2.com"]
}`;
    }

    console.log('🔍 Iniciando análise de fake news...');
    
    // Preparar o prompt final
    let finalPrompt = analysisPrompt;
    
    // Para imagens, incluir a imagem no prompt
    if (contentType === 'imagem' && content.startsWith('data:image/')) {
      console.log('🔄 Preparando prompt com imagem para IA...');
      finalPrompt = {
        role: 'user',
        content: [
          {
            type: 'text',
            text: analysisPrompt
          },
          {
            type: 'image_url',
            image_url: {
              url: content
            }
          }
        ]
      };
      console.log('✅ Prompt preparado, enviando para IA...');
    }
    
    console.log('📤 Enviando para análise de IA...');
    const result = await smartDispatcher(
      finalPrompt,
      'Você é um verificador de fatos. Responda APENAS em JSON válido. Se o conteúdo for um fato objetivo confirmado por fontes (ex.: dados oficiais, registros históricos), classifique como "verdade". Use "tendencioso" apenas quando houver viés ou parcialidade. Nunca retorne "tendencioso" com confiança acima de 80 se a própria explicação confirmar o fato.'
    );
    console.log('📥 Resposta da IA recebida:', result);
    console.log('✅ Análise concluída:', result);
    
    // Tentar fazer parse do JSON retornado
    let analysisResult;
    try {
      // Limpar a resposta para extrair apenas o JSON
      const jsonMatch = result.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        analysisResult = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('JSON não encontrado na resposta');
      }
    } catch (parseError) {
      console.warn('Erro ao fazer parse do JSON, usando fallback:', parseError.message);
      // Fallback se o JSON não for válido
      analysisResult = {
        resultado: 'tendencioso',
        confianca: 50,
        explicacao: 'Não foi possível analisar completamente o conteúdo. Recomendamos verificar com fontes adicionais.',
        fontes: ['Análise automática limitada']
      };
    }

    // Validar e normalizar o resultado
    if (!['verdade', 'tendencioso', 'fake'].includes(analysisResult.resultado)) {
      analysisResult.resultado = 'tendencioso';
    }
    
    if (!analysisResult.confianca || analysisResult.confianca < 0 || analysisResult.confianca > 100) {
      analysisResult.confianca = 50;
    }
    
    if (!analysisResult.explicacao) {
      analysisResult.explicacao = 'Análise não disponível no momento.';
    }
    
    if (!Array.isArray(analysisResult.fontes)) {
      analysisResult.fontes = ['Análise baseada em IA'];
    }

    // Harmonizar classificação com a explicação para evitar incoerências
    try {
      const exp = (analysisResult.explicacao || '').toLowerCase();
      const ct = (content || '').toLowerCase();
      const mentionsFact = exp.includes('fato') || exp.includes('verificado') || exp.includes('amplamente documentado') || exp.includes('confirmado');
      const mentionsPresidentBR = (exp + ' ' + ct).includes('presidente do brasil');
      const clearlyTrueByExplanation = mentionsFact || mentionsPresidentBR || exp.includes('foi') && exp.includes('presidente');

      // Se a explicação afirma claramente um fato objetivo, não classificar como tendencioso
      if (analysisResult.resultado === 'tendencioso' && (clearlyTrueByExplanation || analysisResult.confianca >= 90)) {
        analysisResult.resultado = 'verdade';
        if (!analysisResult.confianca || analysisResult.confianca < 80) {
          analysisResult.confianca = 90;
        }
      }

      // Evitar confiança excessiva para "tendencioso"
      if (analysisResult.resultado === 'tendencioso' && analysisResult.confianca > 80) {
        analysisResult.confianca = 80;
      }
    } catch (normError) {
      console.warn('Falha ao harmonizar classificação:', normError?.message || normError);
    }

    return {
      success: true,
      ...analysisResult,
      model: result.model,
      provider: result.provider,
      tokensUsed: result.tokensUsed
    };
    
  } catch (error) {
    console.error('Erro na análise de fake news:', error);
    
    // Fallback em caso de erro
    return {
      success: false,
      resultado: 'tendencioso',
      confianca: 30,
      explicacao: 'Não foi possível analisar o conteúdo no momento. Tente novamente mais tarde ou verifique manualmente com fontes confiáveis.',
      fontes: ['Sistema temporariamente indisponível'],
      error: error.message
    };
  }
}

module.exports = {
  checkUserLimits,
  generateResponse,
  saveConversation,
  getUserConversations,
  smartDispatcher,
  analyzeFakeNews
};