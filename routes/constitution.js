const express = require('express');
const { supabase } = require('../config/supabase');
const { authenticateUser, resolveUserId } = require('../middleware/auth');

const router = express.Router();

// Verificar se usuário já baixou a Constituição
router.get('/download-status/:userId', authenticateUser, async (req, res) => {
  try {
    const { userId } = req.params;

    const resolvedUserId = await resolveUserId(userId);
    if (!resolvedUserId) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }
    
    // Verificar se o usuário pode acessar estes dados
    if (req.user.id !== resolvedUserId && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Acesso negado' });
    }

    const { data, error } = await supabase
      .from('constitution_downloads')
      .select('*')
      .eq('user_id', resolvedUserId)
      .single();

    if (error) {
      const msg = error?.message || '';
      const code = error?.code || '';
      const missingTable = code === '42P01' || /relation .*constitution_downloads/i.test(msg);
      if (missingTable) {
        // Fallback: verificar se já existem pontos pela razão 'constitution_download'
        try {
          const { data: pointsCheck } = await supabase
            .from('points')
            .select('id')
            .eq('user_id', resolvedUserId)
            .eq('reason', 'constitution_download')
            .limit(1);
          const hasDownloaded = Array.isArray(pointsCheck) && pointsCheck.length > 0;
          return res.json({ hasDownloaded, downloadInfo: null, is_fallback: true });
        } catch (fallbackErr) {
          console.warn('⚠️ Fallback status falhou:', fallbackErr?.message);
          return res.json({ hasDownloaded: false, downloadInfo: null, is_fallback: true });
        }
      }
      // PGRST116 = no rows found
      if (code === 'PGRST116') {
        return res.json({ hasDownloaded: false, downloadInfo: null });
      }
      console.error('Erro ao verificar download:', error);
      return res.status(500).json({ error: 'Erro interno do servidor' });
    }

    res.json({
      hasDownloaded: !!data,
      downloadInfo: data || null
    });
  } catch (error) {
    console.error('Erro ao verificar status de download:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Registrar download da Constituição
router.post('/download/:userId', authenticateUser, async (req, res) => {
  try {
    const { userId } = req.params;

    const resolvedUserId = await resolveUserId(userId);
    if (!resolvedUserId) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }
    
    // Verificar se o usuário pode acessar estes dados
    if (req.user.id !== resolvedUserId && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Acesso negado' });
    }

    // Verificar se já baixou (tabela constitution_downloads)
    const { data: existingDownload, error: existingError } = await supabase
      .from('constitution_downloads')
      .select('id')
      .eq('user_id', resolvedUserId)
      .single();

    if (existingDownload) {
      return res.status(400).json({ error: 'Usuário já baixou a Constituição' });
    }

    // Se a tabela não existir, usar fallback baseado na tabela de pontos
    if (existingError) {
      const msg = existingError?.message || '';
      const code = existingError?.code || '';
      const missingTable = code === '42P01' || /relation .*constitution_downloads/i.test(msg);
      if (missingTable) {
        // Checar se já existe um registro de pontos para este download
        const { data: pointsCheck } = await supabase
          .from('points')
          .select('id')
          .eq('user_id', resolvedUserId)
          .eq('reason', 'constitution_download')
          .limit(1);
        const alreadyAwarded = Array.isArray(pointsCheck) && pointsCheck.length > 0;
        if (alreadyAwarded) {
          return res.status(400).json({ error: 'Usuário já baixou a Constituição', is_fallback: true });
        }
        // Conceder pontos uma única vez
        try {
          await supabase
            .from('points')
            .insert({
              user_id: resolvedUserId,
              type: 'reward',
              amount: 100,
              reason: 'constitution_download',
              source: 'constitution',
              reference_id: null,
              reference_type: 'constitution_download',
              created_at: new Date().toISOString()
            });
        } catch (pointsError) {
          console.warn('Falha ao premiar pontos (fallback):', pointsError);
        }
        return res.status(200).json({
          success: true,
          download: null,
          pointsAwarded: 100,
          is_fallback: true,
          message: 'Registro de download indisponível; pontos concedidos uma única vez.'
        });
      }
    }

    // Tentar registrar o download
    const { data, error } = await supabase
      .from('constitution_downloads')
      .insert({
        user_id: resolvedUserId,
        downloaded_at: new Date().toISOString(),
        points_awarded: 100
      })
      .select()
      .single();

    if (error) {
      console.error('Erro ao registrar download:', error);
      // Fallback: conceder pontos, garantindo idempotência pela razão
      try {
        const { data: pointsCheck } = await supabase
          .from('points')
          .select('id')
          .eq('user_id', resolvedUserId)
          .eq('reason', 'constitution_download')
          .limit(1);
        const alreadyAwarded = Array.isArray(pointsCheck) && pointsCheck.length > 0;
        if (alreadyAwarded) {
          return res.status(400).json({ error: 'Usuário já baixou a Constituição', is_fallback: true });
        }
        await supabase
          .from('points')
          .insert({
            user_id: resolvedUserId,
            type: 'reward',
            amount: 100,
            reason: 'constitution_download',
            source: 'constitution',
            reference_id: null,
            reference_type: 'constitution_download',
            created_at: new Date().toISOString()
          });
      } catch (pointsError) {
        console.warn('Falha ao premiar pontos (fallback):', pointsError);
      }

      return res.status(200).json({
        success: true,
        download: null,
        pointsAwarded: 100,
        is_fallback: true,
        message: 'Registro de download indisponível; pontos concedidos uma única vez.'
      });
    }

    // Premiar pontos ao usuário (idempotente: apenas se não havia registro antes)
    try {
      await supabase
        .from('points')
        .insert({
          user_id: resolvedUserId,
          type: 'reward',
          amount: 100,
          reason: 'constitution_download',
          source: 'constitution',
          reference_id: data?.id || null,
          reference_type: 'constitution_download',
          created_at: new Date().toISOString()
        });
    } catch (pointsError) {
      console.warn('Falha ao premiar pontos pelo download da Constituição:', pointsError);
      // Não falhar a requisição por conta dos pontos
    }

    res.json({
      success: true,
      download: data,
      pointsAwarded: 100
    });
  } catch (error) {
    console.error('Erro ao registrar download:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

module.exports = router;