const express = require('express');
const { supabase } = require('../config/supabase');
const aiService = require('../services/aiService');
const { authenticateUser, optionalAuthenticateUser } = require('../middleware/auth');
const { randomUUID } = require('crypto');
const router = express.Router();

// Choose auth middleware based on Supabase env presence (dev fallback)
const requireAuth = (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
  ? authenticateUser
  : optionalAuthenticateUser;

// Fallback de usuário dev quando não há autenticação (apenas em desenvolvimento)
const ensureDevUser = (req, res, next) => {
  if (!req.user) {
    req.user = {
      id: 'dev-user',
      plan: 'premium',
      email: 'dev@local'
    };
  }
  next();
};

// EsquerdaGPT Chat com APIs reais
router.post('/chat', requireAuth, ensureDevUser, async (req, res) => {
  try {
    const { message, conversation_id } = req.body;
    const authId = req.user.id;

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // User data is already available from middleware
    const userId = req.user.id;
    const userProfile = req.user;

    const userPlan = userProfile?.plan || 'free';
    
    // Check user limits
    const limits = await aiService.checkUserLimits(userId, userPlan);
    
    if (!limits.canUse) {
      return res.status(429).json({ 
        error: 'Daily usage limit reached',
        limit: limits.limit,
        used: limits.used,
        remaining: limits.remaining
      });
    }

    // Generate AI response using real APIs
    const aiResult = await aiService.generateResponse(message);

    if (!aiResult.success) {
      return res.status(500).json({ 
        error: 'Failed to generate AI response',
        details: aiResult.error
      });
    }

    // Generate conversation ID if not provided
    const finalConversationId = conversation_id || randomUUID();

    // Save conversation to database
    const saveResult = await aiService.saveConversation(
      userId,
      finalConversationId,
      message,
      aiResult.content,
      aiResult.tokensUsed || 0,
      aiResult.model,
      aiResult.provider
    );

    if (!saveResult.success) {
      console.error('Error saving conversation:', saveResult.error);
    }

    // Get updated usage
    const updatedLimits = await aiService.checkUserLimits(userId, userPlan);

    res.json({
      response: aiResult.content,
      conversation_id: finalConversationId,
      model: aiResult.model,
      provider: aiResult.provider,
      tokens_used: aiResult.tokensUsed,
      usage: {
        used: updatedLimits.used,
        limit: updatedLimits.limit,
        remaining: updatedLimits.remaining
      }
    });
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get user usage statistics
router.get('/usage', requireAuth, ensureDevUser, async (req, res) => {
  try {
    const userId = req.user.id;
    const userPlan = req.user.plan || 'Gratuito';

    const limits = await aiService.checkUserLimits(userId, userPlan);

    res.json({
      dailyUsage: limits.used,
      planLimit: limits.limit,
      remaining: limits.remaining,
      plan: userPlan
    });
  } catch (error) {
    console.error('Usage error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get Creative AI usage statistics
router.get('/creative-ai/usage', requireAuth, ensureDevUser, async (req, res) => {
  try {
    const userId = req.user.id;
    const userPlan = req.user.plan || 'gratuito';
    const today = new Date().toISOString().split('T')[0];

    // Today's generation usage
    const { count: todayGenerations } = await supabase
      .from('ai_generations')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('created_at', today + 'T00:00:00.000Z')
      .lt('created_at', today + 'T23:59:59.999Z');

    // Total generation usage
    const { count: totalGenerations } = await supabase
      .from('ai_generations')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    const generationLimits = {
      gratuito: 0,
      engajado: 20,
      premium: -1,
    };

    const limit = generationLimits[userPlan] || generationLimits.gratuito;
    const used = todayGenerations || 0;
    const remaining = limit === -1 ? -1 : Math.max(0, limit - used);

    res.json({
      plan: userPlan,
      today: {
        generations: used,
      },
      total: {
        generations: totalGenerations || 0,
      },
      limits: {
        generations: limit,
      },
      remaining: remaining,
      canUse: limit === -1 || used < limit
    });
  } catch (error) {
    console.error('Creative AI usage error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get user conversation history
router.get('/conversations', requireAuth, ensureDevUser, async (req, res) => {
  try {
    const userId = req.user.id;
    const { limit = 50 } = req.query;

    const result = await aiService.getUserConversations(userId, parseInt(limit));

    if (!result.success) {
      return res.status(500).json({ 
        error: 'Failed to fetch conversations',
        details: result.error
      });
    }

    return res.json(result.data);
  } catch (error) {
    console.error('Error fetching conversations:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Creative AI Content Generation
router.post('/generate', requireAuth, ensureDevUser, async (req, res) => {
  try {
    const { type, prompt, tone, length, template } = req.body;
    const userId = req.user.id;

    if (!type || !prompt) {
      return res.status(400).json({ error: 'Type and prompt are required' });
    }

    // Get user profile to check plan access
    const { data: userProfile } = await supabase
      .from('users')
      .select('plan')
      .eq('id', userId)
      .single();

    // Resolve plan from DB or fallback to req.user or default dev plan
    const planName = userProfile?.plan || (req.user && req.user.plan) || 'engajado';

    // Check if user has access to Creative AI
    if (planName === 'gratuito') {
      return res.status(403).json({ 
        error: 'Creative AI requires Engajado or Premium plan'
      });
    }

    // Check usage limits
    const today = new Date().toISOString().split('T')[0];
    const { count: todayUsage } = await supabase
      .from('ai_generations')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('created_at', today + 'T00:00:00.000Z')
      .lt('created_at', today + 'T23:59:59.999Z');

    const limits = {
      engajado: 20,
      premium: -1, // unlimited
    };

    const userLimit = limits[planName] ?? 0;
    const todayCount = todayUsage || 0;
    if (userLimit !== -1 && todayCount >= userLimit) {
      return res.status(429).json({ 
        error: 'Daily generation limit reached',
        limit: userLimit,
        usage: todayCount
      });
    }

    // Generate content based on type
    const generatedContent = generateCreativeContent(type, prompt, tone, length, template);

    // Save generation
    const { data: generation, error: generationError } = await supabase
      .from('ai_generations')
      .insert([
        {
          user_id: userId,
          type,
          prompt,
          tone,
          length,
          template,
          generated_content: generatedContent,
          created_at: new Date().toISOString(),
        },
      ])
      .select()
      .single();

    if (generationError) {
      console.error('Error saving generation:', generationError);
    }

    res.json({
      content: generatedContent,
      type,
      generation_id: generation?.id,
      usage: {
        today: todayUsage + 1,
        limit: userLimit,
      },
    });
  } catch (error) {
    console.error('Generation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Rota duplicada removida - usando a implementação anterior com aiService

// Get generation history
router.get('/generations', requireAuth, ensureDevUser, async (req, res) => {
  try {
    const { limit = 50, offset = 0, type } = req.query;
    const userId = req.user.id;

    let query = supabase
      .from('ai_generations')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

    if (type) {
      query = query.eq('type', type);
    }

    const { data: generations, error } = await query;

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json({ generations });
  } catch (error) {
    console.error('Get generations error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get AI usage statistics
router.get('/usage', requireAuth, ensureDevUser, async (req, res) => {
  try {
    const userId = req.user.id;
    const today = new Date().toISOString().split('T')[0];

    // Today's chat usage
    const { count: todayChats } = await supabase
      .from('ai_conversations')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('created_at', today + 'T00:00:00.000Z')
      .lt('created_at', today + 'T23:59:59.999Z');

    // Today's generation usage
    const { count: todayGenerations } = await supabase
      .from('ai_generations')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('created_at', today + 'T00:00:00.000Z')
      .lt('created_at', today + 'T23:59:59.999Z');

    // Total usage
    const { count: totalChats } = await supabase
      .from('ai_conversations')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    const { count: totalGenerations } = await supabase
      .from('ai_generations')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    // Get user plan for limits
    const { data: userProfile } = await supabase
      .from('users')
      .select('plan')
      .eq('id', userId)
      .single();

    const chatLimits = {
      gratuito: 10,
      engajado: 50,
      premium: -1,
    };

    const generationLimits = {
      gratuito: 0,
      engajado: 20,
      premium: -1,
    };

    res.json({
      today: {
        chats: todayChats || 0,
        generations: todayGenerations || 0,
      },
      total: {
        chats: totalChats || 0,
        generations: totalGenerations || 0,
      },
      limits: {
        chats: chatLimits[userProfile?.plan] || chatLimits.gratuito,
        generations: generationLimits[userProfile?.plan] || generationLimits.gratuito,
      },
    });
  } catch (error) {
    console.error('Get usage error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get messages from a specific conversation
router.get('/conversations/:conversationId/messages', requireAuth, ensureDevUser, async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { page = 1, limit = 50 } = req.query;
    const userId = req.user.id;

    // Verificar se a conversa pertence ao usuário
    const { data: conversation } = await supabase
      .from('ai_conversations')
      .select('user_id')
      .eq('conversation_id', conversationId)
      .single();

    if (!conversation || conversation.user_id !== userId) {
      return res.status(404).json({ error: 'Conversa não encontrada' });
    }

    // Buscar mensagens da conversa
    const offset = (page - 1) * limit;
    const { data: messages, error } = await supabase
      .from('ai_messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .range(offset, offset + limit - 1);

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json({ messages: messages || [] });
  } catch (error) {
    console.error('Get conversation messages error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Helper functions
function generateConversationId() {
  return randomUUID();
}

function generateDireitaGPTResponse(message) {
  const lowerMessage = message.toLowerCase();
  
  // Progressive-themed responses based on keywords
  if (lowerMessage.includes('economia') || lowerMessage.includes('econômica')) {
    return 'Uma economia justa precisa combinar crescimento com distribuição de renda, valorização do trabalho e combate às desigualdades. Políticas públicas responsáveis, tributação progressiva e investimentos em saúde, educação e infraestrutura são essenciais para um desenvolvimento sustentável e inclusivo.';
  }
  
  if (lowerMessage.includes('família') || lowerMessage.includes('valores')) {
    return 'Defendemos famílias em sua diversidade, com políticas de cuidado, proteção social e promoção de direitos para todas as pessoas. O respeito, a solidariedade e a igualdade devem orientar um Brasil mais acolhedor e democrático.';
  }
  
  if (lowerMessage.includes('educação') || lowerMessage.includes('escola')) {
    return 'Educação pública, gratuita e de qualidade é a base de um país justo. Investimento em professores, ciência, cultura e inclusão garante oportunidades, combate a desigualdade e fortalece nossa democracia.';
  }
  
  if (lowerMessage.includes('política') || lowerMessage.includes('governo')) {
    return 'Transparência, participação popular e respeito às instituições são pilares de um governo democrático. Fortalecer políticas sociais, direitos humanos e combate à desinformação é fundamental para um Brasil mais igualitário.';
  }
  
  if (lowerMessage.includes('segurança') || lowerMessage.includes('violência')) {
    return 'Segurança pública efetiva se constrói com prevenção, justiça, direitos e políticas sociais. Enfrentar violência com foco em direitos humanos, redução de desigualdades e respeito às comunidades é caminho para paz duradoura.';
  }
  
  // Default response
  return 'Obrigado pela pergunta! Como EsquerdaGPT, atuo com perspectiva progressista comprometida com justiça social, direitos humanos e democracia. Em que posso ajudar com propostas inclusivas e baseadas em evidências?';
}

function generateCreativeContent(type, prompt, tone, length, template) {
  const toneAdjectives = {
    formal: 'respeitoso e profissional',
    casual: 'descontraído e acessível',
    inspirational: 'motivador e inspirador',
    humorous: 'bem-humorado e cativante'
  };

  const lengthWords = {
    short: '50-100 palavras',
    medium: '150-300 palavras',
    long: '400-600 palavras'
  };

  switch (type) {
    case 'social_post':
      return `🇧🇷 ${prompt}\n\nNossos valores progressistas nos guiam para um Brasil mais justo, inclusivo e democrático! ✊\n\n#Brasil #JustiçaSocial #DireitosHumanos #Democracia #BrasilProgressista`;
    
    case 'meme':
      return `[MEME CONCEPT]\n\nTítulo: "${prompt}"\n\nImagem sugerida: Pessoas diversas com cartazes por direitos\n\nTexto superior: "QUANDO LUTAMOS POR"\nTexto inferior: "JUSTIÇA SOCIAL E DEMOCRACIA"\n\nTom: ${toneAdjectives[tone] || 'inspirador'}`;
    
    case 'video_script':
      return `ROTEIRO DE VÍDEO\n\nTema: ${prompt}\n\nDuração estimada: ${length === 'short' ? '30-60 segundos' : length === 'medium' ? '2-3 minutos' : '5-8 minutos'}\n\nINTRODUÇÃO:\n"Olá! Hoje vamos falar sobre ${prompt} sob a perspectiva progressista, com foco em direitos, inclusão e justiça social."\n\nDESENVOLVIMENTO:\n- Contextualização do tema com dados e evidências\n- Políticas públicas e propostas inclusivas relacionadas\n- Exemplos práticos de impacto social positivo\n\nCONCLUSÃO:\n"Juntos, construímos um Brasil mais justo, democrático e sustentável — com participação popular e respeito às diferenças."\n\nTom: ${toneAdjectives[tone] || 'inspirador'}`;
    
    case 'speech':
      return `DISCURSO: ${prompt}\n\n"Companheiras e companheiros,\n\nEstamos aqui porque acreditamos em um Brasil mais justo, inclusivo e democrático. ${prompt} expressa nosso compromisso com direitos humanos, igualdade e participação popular.\n\nDefendemos políticas públicas que reduzam desigualdades, valorizem o trabalho e protejam o meio ambiente. A diversidade é nossa força, e a democracia nosso caminho.\n\nCom solidariedade e coragem, construiremos um país onde todas as pessoas tenham dignidade, voz e oportunidades.\n\nViva a democracia, viva o Brasil!"\n\nTom: ${toneAdjectives[tone] || 'inspirador'}\nExtensão: ${lengthWords[length] || 'média'}`;
    
    default:
      return `Conteúdo gerado para: ${prompt}\n\nTipo: ${type}\nTom: ${toneAdjectives[tone] || 'neutro'}\nTamanho: ${lengthWords[length] || 'médio'}\n\nEste conteúdo segue valores progressistas brasileiros: justiça social, inclusão, direitos humanos e democracia.`;
  }
}

module.exports = router;