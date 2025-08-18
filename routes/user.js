const express = require('express');
const { authenticateUser } = require('../middleware/auth');
const { checkUserLimits } = require('../services/aiService');
const { supabase } = require('../config/supabase');

const router = express.Router();

// Rota para obter estatísticas de uso do usuário
router.get('/usage-stats', authenticateUser, async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Buscar informações do plano do usuário
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('subscription_plan')
      .eq('id', userId)
      .single();
    
    if (userError) {
      console.error('Erro ao buscar dados do usuário:', userError);
      return res.status(500).json({ 
        success: false, 
        error: 'Erro ao buscar dados do usuário' 
      });
    }
    
    const userPlan = userData?.subscription_plan || 'gratuito';
    
    // Verificar limites para cada funcionalidade
    const features = ['fake_news', 'ai_creative', 'political_agents'];
    const usageStats = {};
    
    for (const feature of features) {
      try {
        // Se não temos o serviço aiService, vamos usar valores padrão
        const limitCheck = {
          used: 0,
          limit: userPlan === 'gratuito' ? 5 : 50,
          remaining: userPlan === 'gratuito' ? 5 : 50,
          canUse: true
        };
        
        usageStats[feature] = limitCheck;
      } catch (error) {
        console.error(`Erro ao verificar limites para ${feature}:`, error);
        usageStats[feature] = {
          used: 0,
          limit: 0,
          remaining: 0,
          canUse: false
        };
      }
    }
    
    // Adicionar informações do plano
    usageStats.plan = userPlan;
    usageStats.resetTime = '00:00'; // Horário de reset dos limites
    
    res.json({
      success: true,
      data: usageStats
    });
    
  } catch (error) {
    console.error('Erro ao obter estatísticas de uso:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Erro interno do servidor' 
    });
  }
});

// Rota para obter histórico de uso semanal
router.get('/usage-history', authenticateUser, async (req, res) => {
  try {
    const userId = req.user.id;
    const { days = 7 } = req.query;
    
    // Calcular data de início
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days));
    startDate.setHours(0, 0, 0, 0);
    
    // Buscar histórico de conversas (fake news)
    const { data: fakeNewsHistory, error: fakeNewsError } = await supabase
      .from('verificacoes_fake_news')
      .select('created_at')
      .eq('user_id', userId)
      .gte('created_at', startDate.toISOString())
      .order('created_at', { ascending: true });
    
    if (fakeNewsError) {
      console.error('Erro ao buscar histórico de fake news:', fakeNewsError);
    }

    // Buscar histórico de conversas AI
    const { data: aiHistory, error: aiError } = await supabase
      .from('ai_conversations')
      .select('created_at, conversation_type')
      .eq('user_id', userId)
      .gte('created_at', startDate.toISOString())
      .order('created_at', { ascending: true });
    
    if (aiError) {
      console.error('Erro ao buscar histórico de AI:', aiError);
    }
    
    // Criar estrutura de dados diários
    const dailyUsage = {};
    for (let i = 0; i < parseInt(days); i++) {
      const date = new Date(startDate);
      date.setDate(date.getDate() + i);
      const dateKey = date.toISOString().split('T')[0];
      
      dailyUsage[dateKey] = {
        fake_news: 0,
        ai_creative: 0,
        political_agents: 0,
        total: 0
      };
    }
    
    // Processar dados de fake news
    if (fakeNewsHistory) {
      fakeNewsHistory.forEach(item => {
        const dateKey = item.created_at.split('T')[0];
        if (dailyUsage[dateKey]) {
          dailyUsage[dateKey].fake_news++;
          dailyUsage[dateKey].total++;
        }
      });
    }
    
    // Processar dados de AI
    if (aiHistory) {
      aiHistory.forEach(item => {
        const dateKey = item.created_at.split('T')[0];
        if (dailyUsage[dateKey]) {
          if (item.conversation_type === 'ai_creative') {
            dailyUsage[dateKey].ai_creative++;
          } else if (item.conversation_type === 'political_agent') {
            dailyUsage[dateKey].political_agents++;
          }
          dailyUsage[dateKey].total++;
        }
      });
    }
    
    // Converter para array ordenado
    const historyArray = Object.entries(dailyUsage)
      .map(([date, usage]) => ({ date, ...usage }))
      .sort((a, b) => new Date(a.date) - new Date(b.date));
    
    res.json({
      success: true,
      data: {
        history: historyArray,
        period: {
          start: startDate.toISOString().split('T')[0],
          end: new Date().toISOString().split('T')[0],
          days: parseInt(days)
        }
      }
    });
    
  } catch (error) {
    console.error('Erro ao obter histórico de uso:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Erro interno do servidor' 
    });
  }
});

// Rota para obter informações do plano do usuário
router.get('/plan-info', authenticateUser, async (req, res) => {
  try {
    const userId = req.user.id;
    
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select(`
        subscription_plan,
        subscription_status,
        subscription_expires_at,
        created_at
      `)
      .eq('id', userId)
      .single();
    
    if (userError) {
      console.error('Erro ao buscar informações do plano:', userError);
      return res.status(500).json({ 
        success: false, 
        error: 'Erro ao buscar informações do plano' 
      });
    }
    
    // Buscar créditos avulsos se existirem
    const { data: creditsData, error: creditsError } = await supabase
      .from('user_credits')
      .select('credit_type, remaining_credits')
      .eq('user_id', userId)
      .gt('remaining_credits', 0);
    
    if (creditsError) {
      console.error('Erro ao buscar créditos:', creditsError);
    }
    
    const planInfo = {
      plan: userData.subscription_plan || 'gratuito',
      status: userData.subscription_status || 'active',
      expiresAt: userData.subscription_expires_at,
      memberSince: userData.created_at,
      credits: creditsData || []
    };
    
    res.json({
      success: true,
      data: planInfo
    });
    
  } catch (error) {
    console.error('Erro ao obter informações do plano:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Erro interno do servidor' 
    });
  }
});

module.exports = router;