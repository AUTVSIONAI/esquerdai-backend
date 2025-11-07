const express = require('express');
const { supabase } = require('../config/supabase');
const { authenticateUser } = require('../middleware/auth');
const { analyzeFakeNews, checkUserLimits } = require('../services/aiService');
const { randomUUID } = require('crypto');
const router = express.Router();

// Função para analisar conteúdo com IA
async function analyzeContentWithAI(content, type) {
  const openRouterKey = process.env.OPENROUTER_API_KEY;
  
  if (!openRouterKey) {
    throw new Error('OPENROUTER_API_KEY não configurada');
  }

  const systemPrompt = `Você é um especialista em verificação de fatos e detecção de fake news. 
Analise o conteúdo fornecido e determine se é:
- VERDADE: Informação verificada e confiável
- TENDENCIOSO: Informação parcialmente verdadeira mas com viés
- FAKE: Informação falsa ou enganosa

Forneça uma análise detalhada incluindo:
1. Classificação (verdade/tendencioso/fake)
2. Pontuação de confiança (0-100)
3. Explicação detalhada
4. Fontes ou referências quando possível

Responda APENAS em formato JSON válido:
{
  "resultado": "verdade|tendencioso|fake",
  "confianca": 0-100,
  "explicacao": "explicação detalhada",
  "fontes": ["fonte1", "fonte2"]
}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openRouterKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://direitai.com',
        'X-Title': 'DireitaAI - Detector de Fake News'
      },
      body: JSON.stringify({
        model: 'meta-llama/llama-3.3-70b-instruct:free',
        messages: [
          {
            role: 'system',
            content: systemPrompt
          },
          {
            role: 'user',
            content: `Analise este ${type}: ${content}`
          }
        ],
        temperature: 0.3,
        max_tokens: 1000
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`OpenRouter API error: ${response.status}`);
    }

    const data = await response.json();
    const aiResponse = data.choices[0]?.message?.content;

    if (!aiResponse) {
      throw new Error('Resposta vazia da IA');
    }

    // Tentar fazer parse do JSON
    try {
      const analysis = JSON.parse(aiResponse);
      return {
        success: true,
        analysis,
        tokensUsed: data.usage?.total_tokens || 0
      };
    } catch (parseError) {
      // Se não conseguir fazer parse, criar resposta padrão
      return {
        success: true,
        analysis: {
          resultado: 'tendencioso',
          confianca: 50,
          explicacao: aiResponse,
          fontes: []
        },
        tokensUsed: data.usage?.total_tokens || 0
      };
    }
  } catch (error) {
    clearTimeout(timeoutId);
    console.error('Erro na análise de IA:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// Função para extrair conteúdo de URL
async function extractContentFromUrl(url) {
  try {
    // Validar URL
    const urlObj = new URL(url);
    
    // Por enquanto, retornar a URL como conteúdo
    // Em uma implementação completa, usaríamos web scraping
    return {
      success: true,
      content: `Conteúdo da URL: ${url}`,
      title: 'Título extraído da página'
    };
  } catch (error) {
    return {
      success: false,
      error: 'URL inválida'
    };
  }
}

// Rota principal para verificar fake news
router.post('/analyze', authenticateUser, async (req, res) => {
  try {
    const { content, type = 'texto' } = req.body;
    const userId = req.user.id;

    if (!content || content.trim().length === 0) {
      return res.status(400).json({ error: 'Conteúdo é obrigatório' });
    }

    const limitsCheck = await checkUserLimits(userId);
    if (!limitsCheck.canUse) {
      return res.status(429).json({ 
        error: 'Limite de uso excedido',
        details: limitsCheck
      });
    }

    let processedContent = content;
    if (type === 'link') {
      try {
        processedContent = content;
      } catch (error) {
        console.error('Erro ao extrair conteúdo do link:', error);
        processedContent = content;
      }
    }

    const analysisResult = await analyzeFakeNews(processedContent, type);
    if (!analysisResult.success) {
      console.warn('Análise de IA indisponível, usando resultado de fallback.');
    }

    const { data: savedCheck, error: saveError } = await supabase
      .from('fake_news_checks')
      .insert({
        user_id: userId,
        tipo_input: type,
        conteudo: content.substring(0, 1000),
        resultado: analysisResult.resultado,
        explicacao: analysisResult.explicacao,
        confianca: analysisResult.confianca,
        fontes: analysisResult.fontes || [],
        feedback_positivo: 0,
        feedback_negativo: 0,
        denuncias: 0,
        created_at: new Date().toISOString()
      })
      .select()
      .single();

    if (saveError) {
      console.error('Erro ao salvar verificação:', saveError);
      return res.status(200).json({
        id: null,
        resultado: analysisResult.resultado,
        confianca: analysisResult.confianca,
        explicacao: analysisResult.explicacao,
        fontes: analysisResult.fontes || [],
        created_at: new Date().toISOString(),
        not_saved: true,
        message: 'Verificação não foi salva, exibindo resultado mesmo assim.'
      });
    }

    return res.json({
      id: savedCheck.id,
      resultado: analysisResult.resultado,
      confianca: analysisResult.confianca,
      explicacao: analysisResult.explicacao,
      fontes: analysisResult.fontes || [],
      created_at: savedCheck.created_at
    });
  } catch (error) {
    console.error('Erro na análise:', error);
    return res.status(200).json({
      id: null,
      resultado: 'tendencioso',
      confianca: 30,
      explicacao: 'Análise indisponível no momento. Tente novamente mais tarde.',
      fontes: [],
      not_saved: true,
      message: 'Falha interna durante a análise; retornando resultado padrão.'
    });
  }
});

// Rota para obter histórico do usuário
router.get('/history', authenticateUser, async (req, res) => {
  try {
    const { page = 1, limit = 10, search, resultado, tipo } = req.query;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const offset = (pageNum - 1) * limitNum;
    const userId = req.user.id;

    const buildQuery = (columnName) => {
      let q = supabase
        .from('fake_news_checks')
        .select('*', { count: 'exact' })
        .eq(columnName, userId);

      if (search) {
        q = q.or(`conteudo.ilike.%${search}%,explicacao.ilike.%${search}%`);
      }
      if (resultado) {
        q = q.eq('resultado', resultado);
      }
      if (tipo) {
        q = q.eq('tipo_input', tipo);
      }

      return q.order('created_at', { ascending: false }).range(offset, offset + limitNum - 1);
    };

    // Primeiro tenta com user_id (schema correto)
    let { data, error, count } = await buildQuery('user_id');

    // Se der erro (ex.: coluna inexistente), tenta fallback para usuario_id
    if (error) {
      console.warn('⚠️ Supabase erro em /history com user_id, tentando fallback para usuario_id:', error.message || error);
      ({ data, error, count } = await buildQuery('usuario_id'));
    }

    // Se ainda houver erro, não retornar 500: responder vazio com indicador
    if (error) {
      return res.status(200).json({
        success: true,
        verificacoes: [],
        total: 0,
        page: pageNum,
        totalPages: 0,
        not_loaded: true,
        message: 'Histórico indisponível temporariamente.'
      });
    }

    res.json({
      success: true,
      verificacoes: data || [],
      total: count || 0,
      page: pageNum,
      totalPages: Math.ceil(((count || 0) / limitNum))
    });
  } catch (error) {
    console.error('Erro ao buscar histórico:', error);
    return res.status(200).json({
      success: true,
      verificacoes: [],
      total: 0,
      page: parseInt(req.query.page || '1'),
      totalPages: 0,
      not_loaded: true,
      message: 'Histórico indisponível.'
    });
  }
});

// Rota para buscar verificações mais populares
router.get('/trending', async (req, res) => {
  try {
    const { limit = 10 } = req.query;

    const { data: checks, error } = await supabase
      .from('fake_news_checks')
      .select('*')
      .order('feedback_positivo', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      return res.status(500).json({ 
        error: 'Erro ao buscar verificações populares',
        details: error.message
      });
    }

    res.json({ checks });
  } catch (error) {
    console.error('Erro ao buscar verificações populares:', error);
    res.status(500).json({ 
      error: 'Erro interno do servidor',
      details: error.message
    });
  }
});

// Rota para dar feedback em uma verificação
router.post('/:id/feedback', authenticateUser, async (req, res) => {
  try {
    const { id } = req.params;
    const { tipo_feedback, comentario } = req.body;
    const userId = req.user.id;

    if (!['concordo', 'discordo', 'denuncia'].includes(tipo_feedback)) {
      return res.status(400).json({ 
        error: 'Tipo de feedback inválido',
        details: 'Tipo deve ser: concordo, discordo ou denuncia'
      });
    }

    // Verificar se a verificação existe
    const { data: check, error: checkError } = await supabase
      .from('fake_news_checks')
      .select('id')
      .eq('id', id)
      .single();

    if (checkError || !check) {
      return res.status(404).json({ 
        error: 'Verificação não encontrada'
      });
    }

    // Inserir feedback
    const { data: feedback, error: feedbackError } = await supabase
      .from('fake_news_feedback')
      .upsert({
        check_id: id,
        user_id: userId,
        tipo_feedback,
        comentario
      })
      .select()
      .single();

    if (feedbackError) {
      return res.status(500).json({ 
        error: 'Erro ao salvar feedback',
        details: feedbackError.message
      });
    }

    // Atualizar contadores na tabela principal
    if (tipo_feedback === 'concordo') {
      await supabase.rpc('increment_feedback_positivo', { check_id: id });
    } else if (tipo_feedback === 'discordo') {
      await supabase.rpc('increment_feedback_negativo', { check_id: id });
    } else if (tipo_feedback === 'denuncia') {
      await supabase.rpc('increment_denuncias', { check_id: id });
    }

    res.json({ 
      message: 'Feedback registrado com sucesso',
      feedback
    });
  } catch (error) {
    console.error('Erro ao registrar feedback:', error);
    res.status(500).json({ 
      error: 'Erro interno do servidor',
      details: error.message
    });
  }
});

// Rota para buscar estatísticas gerais
router.get('/stats', async (req, res) => {
  try {
    // Total de verificações
    const { count: totalChecks } = await supabase
      .from('fake_news_checks')
      .select('*', { count: 'exact', head: true });

    // Verificações por resultado
    const { data: resultStats } = await supabase
      .from('fake_news_checks')
      .select('resultado')
      .then(({ data }) => {
        const stats = { verdade: 0, tendencioso: 0, fake: 0 };
        data?.forEach(item => {
          stats[item.resultado] = (stats[item.resultado] || 0) + 1;
        });
        return { data: stats };
      });

    // Verificações desta semana
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    
    const { count: weeklyChecks } = await supabase
      .from('fake_news_checks')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', weekAgo.toISOString());

    res.json({
      total_verificacoes: totalChecks || 0,
      verificacoes_semana: weeklyChecks || 0,
      por_resultado: resultStats || { verdade: 0, tendencioso: 0, fake: 0 }
    });
  } catch (error) {
    console.error('Erro ao buscar estatísticas:', error);
    res.status(500).json({ 
      error: 'Erro interno do servidor',
      details: error.message
    });
  }
});

// Rota para excluir uma verificação
router.delete('/:id', authenticateUser, async (req, res) => {
  try {
    const { id } = req.params

    // Verificar se a verificação pertence ao usuário
    const { data: verificacao, error: fetchError } = await supabase
      .from('fake_news_checks')
      .select('user_id')
      .eq('id', id)
      .single()

    if (fetchError || !verificacao) {
      return res.status(404).json({ success: false, error: 'Verificação não encontrada' })
    }

    if (verificacao.user_id !== req.user.id) {
      return res.status(403).json({ success: false, error: 'Acesso negado' })
    }

    // Excluir a verificação
    const { error: deleteError } = await supabase
      .from('fake_news_checks')
      .delete()
      .eq('id', id)

    if (deleteError) throw deleteError

    res.json({ success: true, message: 'Verificação excluída com sucesso' })
  } catch (error) {
    console.error('Erro ao excluir verificação:', error)
    res.status(500).json({ success: false, error: 'Erro interno do servidor' })
  }
})

module.exports = router;