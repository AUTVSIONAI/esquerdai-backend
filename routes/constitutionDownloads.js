const express = require('express');
const { supabase } = require('../config/supabase');
const { authenticateUser, resolveUserId } = require('../middleware/auth');
const router = express.Router();

// Middleware de autenticação para todas as rotas
router.use(authenticateUser);

// GET /constitution-downloads/users/:userId/status - Verificar se usuário já baixou a Constituição
router.get('/users/:userId/status', async (req, res) => {
  try {
    const { userId } = req.params;

    // Resolver o userId (aceita tanto auth_id quanto ID da tabela users)
    const resolvedUserId = await resolveUserId(userId);
    if (!resolvedUserId) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }
    
    // Verificar se o usuário pode acessar estes dados
    if (req.user.id !== resolvedUserId && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Acesso negado' });
    }

    // Verificar se já existe um download registrado para este usuário
    const { data: download, error } = await supabase
      .from('constitution_downloads')
      .select('*')
      .eq('user_id', resolvedUserId)
      .single();

    if (error && error.code !== 'PGRST116') { // PGRST116 = no rows found
      console.error('Erro ao verificar download:', error);
      return res.status(500).json({ error: 'Erro interno do servidor' });
    }

    res.json({
      hasDownloaded: !!download,
      downloadedAt: download?.downloaded_at || null,
      pointsAwarded: download?.points_awarded || null
    });
  } catch (error) {
    console.error('Error checking constitution download status:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// POST /constitution-downloads/users/:userId/register - Registrar download da Constituição
router.post('/users/:userId/register', async (req, res) => {
  try {
    const { userId } = req.params;

    // Resolver o userId (aceita tanto auth_id quanto ID da tabela users)
    const resolvedUserId = await resolveUserId(userId);
    if (!resolvedUserId) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }
    
    // Verificar se o usuário pode registrar este download
    if (req.user.id !== resolvedUserId) {
      return res.status(403).json({ error: 'Acesso negado' });
    }

    // Verificar se já existe um download registrado para este usuário
    const { data: existingDownload } = await supabase
      .from('constitution_downloads')
      .select('id')
      .eq('user_id', resolvedUserId)
      .single();

    if (existingDownload) {
      return res.status(409).json({ 
        error: 'Download já registrado',
        message: 'Você já baixou a Constituição anteriormente'
      });
    }

    // Registrar o download
    const { data: download, error: downloadError } = await supabase
      .from('constitution_downloads')
      .insert({
        user_id: resolvedUserId,
        points_awarded: 100
      })
      .select()
      .single();

    if (downloadError) {
      console.error('Erro ao registrar download:', downloadError);
      return res.status(500).json({ error: 'Erro ao registrar download' });
    }

    // Adicionar pontos ao usuário
    const { error: pointsError } = await supabase
      .from('points')
      .insert({
        user_id: resolvedUserId,
        amount: 100,
        reason: 'Download da Constituição Federal',
        category: 'constitution_download',
        created_at: new Date().toISOString()
      });

    if (pointsError) {
      console.error('Erro ao adicionar pontos:', pointsError);
      // Não retornar erro aqui, pois o download foi registrado com sucesso
    }

    res.json({
      success: true,
      download,
      pointsAwarded: 100,
      message: 'Download registrado com sucesso! Você ganhou 100 pontos.'
    });
  } catch (error) {
    console.error('Error registering constitution download:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// GET /constitution-downloads/stats - Estatísticas gerais de downloads
router.get('/stats', async (req, res) => {
  try {
    // Verificar se é admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Acesso negado. Apenas administradores.' });
    }

    // Buscar estatísticas
    const { count: totalDownloads } = await supabase
      .from('constitution_downloads')
      .select('*', { count: 'exact', head: true });

    const { data: recentDownloads } = await supabase
      .from('constitution_downloads')
      .select('downloaded_at')
      .gte('downloaded_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
      .order('downloaded_at', { ascending: false });

    res.json({
      totalDownloads: totalDownloads || 0,
      downloadsThisWeek: recentDownloads?.length || 0,
      totalPointsAwarded: (totalDownloads || 0) * 100
    });
  } catch (error) {
    console.error('Error fetching constitution download stats:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

module.exports = router;