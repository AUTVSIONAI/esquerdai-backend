const express = require('express');
const { supabase } = require('../config/supabase');
const { authenticateUser, optionalAuthenticateUser, resolveUserId } = require('../middleware/auth');
const router = express.Router();

// Get user profile
router.get('/profile', authenticateUser, async (req, res) => {
  try {
    console.log('📋 Getting profile for user:', req.user.email);

    // Buscar perfil completo na tabela users usando o ID do banco
    const { data: dbUser, error: dbError } = await supabase
      .from('users')
      .select('*')
      .eq('id', req.user.id)
      .single();

    if (dbError || !dbUser) {
      console.warn('⚠️ Falha ao buscar perfil completo, retornando dados básicos do middleware:', dbError?.message);
      const profile = { ...req.user };
      return res.json(profile);
    }

    // Mesclar dados básicos do middleware (auth_id etc.) com o registro do banco
    const profile = {
      ...dbUser,
      auth_id: req.user.auth_id || dbUser.auth_id,
      email: dbUser.email || req.user.email,
      role: dbUser.role || req.user.role,
    };

    console.log('✅ Profile retrieved successfully from DB');
    res.json(profile);
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update user profile
router.put('/profile', authenticateUser, async (req, res) => {
  try {
    console.log('📝 Profile update request for user:', req.user.id);
    console.log('📝 Request body:', req.body);
    
    // Construir updateData apenas com campos presentes no body
    const candidateFields = ['username', 'full_name', 'bio', 'city', 'state', 'phone', 'birth_date', 'avatar_url'];
    let updateData = {};
    for (const key of candidateFields) {
      if (Object.prototype.hasOwnProperty.call(req.body, key)) {
        const val = req.body[key];
        if (val !== undefined && val !== null && val !== '') {
          updateData[key] = val;
        }
      }
    }

    // NÃO filtrar por req.user; tentar atualizar e remover colunas inválidas dinamicamente
    if (Object.keys(updateData).length === 0) {
      console.log('ℹ️ Nenhuma alteração no perfil após construção; respondendo sucesso.');
      return res.json({ message: 'No changes', profile: req.user });
    }

    console.log('📝 Update data (prepared):', updateData);
    console.log('🔍 User ID from req.user:', req.user.id);

    // Tentar atualizar e remover campos inexistentes dinamicamente se necessário
    let attempts = 0;
    const maxAttempts = Object.keys(updateData).length + 3;
    let lastError = null;
    let result = null;

    while (attempts < maxAttempts) {
      const { data, error } = await supabase
        .from('users')
        .update(updateData)
        .eq('id', req.user.id)
        .select()
        .single();

      if (!error) {
        result = data;
        lastError = null;
        break;
      }

      lastError = error;
      console.log('❌ Supabase update error (attempt', attempts + 1, '):', error);

      // Detectar coluna inexistente e removê-la do update
      const msg = error?.message || '';
      const missingColMatch = msg.match(/Could not find the '([^']+)' column/i) || msg.match(/column\s+([^\s]+)\s+of\s+'users'/i);
      if (missingColMatch) {
        const missingColumn = missingColMatch[1];
        if (updateData.hasOwnProperty(missingColumn)) {
          console.warn(`⚠️ Removendo coluna inexistente do update: ${missingColumn}`);
          delete updateData[missingColumn];
        } else {
          console.warn('⚠️ Coluna inexistente não presente no updateData:', missingColumn);
        }
        if (Object.keys(updateData).length === 0) {
          console.log('ℹ️ Nenhuma alteração após filtragem; respondendo sucesso.');
          return res.json({ message: 'No changes', profile: req.user });
        }
      } else if (/invalid input syntax for type date/i.test(msg) && updateData.hasOwnProperty('birth_date')) {
        console.warn('⚠️ Removendo birth_date inválido do update');
        delete updateData['birth_date'];
        if (Object.keys(updateData).length === 0) {
          console.log('ℹ️ Nenhuma alteração após filtragem de birth_date; respondendo sucesso.');
          return res.json({ message: 'No changes', profile: req.user });
        }
      } else {
        // Erro diferente, sair do loop
        break;
      }

      attempts++;
    }

    if (lastError) {
      const payloadError = { error: lastError.message, code: lastError.code, details: lastError?.details };
      console.log('❌ Profile update failed:', payloadError);
      return res.status(400).json(payloadError);
    }

    console.log('✅ Profile updated successfully:', result);
    res.json({ message: 'Profile updated successfully', profile: result });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get user statistics
router.get('/:userId/stats', authenticateUser, async (req, res) => {
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

    // Get check-ins count
    const { count: checkinsCount } = await supabase
      .from('checkins')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', resolvedUserId);

    // Get points
    const { data: pointsData } = await supabase
      .from('points')
      .select('amount')
      .eq('user_id', resolvedUserId);

    const totalPoints = pointsData?.reduce((sum, point) => sum + point.amount, 0) || 0;

    // Get badges count
    const { count: badgesCount } = await supabase
      .from('badges')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', resolvedUserId);

    // Get AI conversations count
    const { count: aiConversationsCount } = await supabase
      .from('ai_conversations')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', resolvedUserId);

    const aiConversations = aiConversationsCount || 0;

    res.json({
      checkins: checkinsCount || 0,
      points: totalPoints,
      badges: badgesCount || 0,
      ai_conversations: aiConversations,
    });
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get user ranking
router.get('/ranking', optionalAuthenticateUser, async (req, res) => {
  try {
    const { scope = 'city', period = 'month' } = req.query;
    const userId = req.user?.id || null;

    console.log('🏆 Ranking - Buscando ranking para usuário:', userId || 'anon');

    // Buscar cidade/estado do usuário apenas se autenticado
    let userData = null;
    if (userId) {
      const { data: fetchedUser } = await supabase
        .from('users')
        .select('city, state')
        .eq('id', userId)
        .single();
      userData = fetchedUser || null;
    }

    let userQuery = supabase
      .from('users')
      .select('id, username, full_name, city, state, avatar_url');

    // Aplicar filtro por escopo somente se houver dados de localização
    if (scope === 'city' && userData?.city) {
      userQuery = userQuery.eq('city', userData.city);
    } else if (scope === 'state' && userData?.state) {
      userQuery = userQuery.eq('state', userData.state);
    }

    const { data: users, error: usersError } = await userQuery.limit(100);

    if (usersError) {
      console.warn('⚠️ Ranking - Erro ao buscar usuários, retornando fallback:', usersError?.message);
      return res.status(200).json({ rankings: [], user_position: 0, scope, period, is_fallback: true });
    }

    // Somar pontos por usuário
    const userIds = users.map(user => user.id);
    const { data: pointsData, error: pointsError } = await supabase
      .from('points')
      .select('user_id, amount')
      .in('user_id', userIds);

    if (pointsError) {
      console.error('❌ Ranking - Erro ao buscar pontos:', pointsError);
    }

    const userPoints = {};
    if (pointsData) {
      pointsData.forEach(point => {
        userPoints[point.user_id] = (userPoints[point.user_id] || 0) + point.amount;
      });
    }

    const rankings = users.map(user => ({
      ...user,
      points: userPoints[user.id] || 0
    })).sort((a, b) => b.points - a.points);

    const userPosition = userId ? (rankings.findIndex(user => user.id === userId) + 1) : 0;

    console.log('🏆 Ranking - Rankings calculados:', rankings.length, 'usuários');
    console.log('🏆 Ranking - Posição do usuário:', userPosition);

    res.json({
      rankings,
      user_position: userPosition,
      scope,
      period
    });
  } catch (error) {
    console.error('Get ranking error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get user achievements
router.get('/achievements', authenticateUser, async (req, res) => {
  try {
    const userId = req.user.id;
    console.log('🏅 Achievements - Buscando conquistas para usuário:', userId);

    const { data: badges, error } = await supabase
      .from('badges')
      .select('*')
      .eq('user_id', userId)
      .order('earned_at', { ascending: false });

    if (error) {
      console.error('❌ Achievements - Erro ao buscar badges:', error);
      return res.status(400).json({ error: error.message });
    }

    // Se não há badges, adicionar algumas conquistas iniciais
    if (!badges || badges.length === 0) {
      console.log('🏅 Achievements - Adicionando conquistas iniciais...');
      const initialBadges = [
        {
          user_id: userId,
          achievement_id: 'welcome',
          earned_at: new Date().toISOString()
        },
        {
          user_id: userId,
          achievement_id: 'first_login',
          earned_at: new Date().toISOString()
        }
      ];
      
      const { error: insertError } = await supabase
        .from('badges')
        .insert(initialBadges);
        
      if (!insertError) {
        badges.push(...initialBadges);
        console.log('✅ Achievements - Conquistas iniciais adicionadas');
      }
    }

    // Available achievements
    const allAchievements = [
      {
        id: 'welcome',
        name: 'Bem-vindo!',
        description: 'Cadastrou-se na plataforma DireitaAI',
        icon: '👋',
        category: 'onboarding',
        points: 50,
        rarity: 'comum',
      },
      {
        id: 'first_login',
        name: 'Primeiro Acesso',
        description: 'Realizou o primeiro login na plataforma',
        icon: '🚪',
        category: 'onboarding',
        points: 25,
        rarity: 'comum',
      },
      {
        id: 'constitution_download',
        name: 'Guardião da Constituição',
        description: 'Baixou a Constituição Federal',
        icon: '📜',
        category: 'education',
        points: 100,
        rarity: 'raro',
      },
      {
        id: 'first_checkin',
        name: 'Primeiro Check-in',
        description: 'Realize seu primeiro check-in em um evento',
        icon: '🎯',
        category: 'checkin',
        points: 10,
        rarity: 'comum',
      },
      {
        id: 'social_butterfly',
        name: 'Borboleta Social',
        description: 'Participe de 10 eventos diferentes',
        icon: '🦋',
        category: 'social',
        points: 50,
        rarity: 'raro',
      },
      {
        id: 'ai_enthusiast',
        name: 'Entusiasta da IA',
        description: 'Tenha 100 conversas com o DireitaGPT',
        icon: '🤖',
        category: 'ai',
        points: 100,
        rarity: 'épico',
      },
      {
        id: 'survey_master',
        name: 'Mestre das Pesquisas',
        description: 'Responda 5 pesquisas diferentes',
        icon: '📊',
        category: 'engagement',
        points: 75,
        rarity: 'raro',
      },
      {
        id: 'politician_tracker',
        name: 'Rastreador Político',
        description: 'Visualize o perfil de 10 políticos diferentes',
        icon: '🔍',
        category: 'politics',
        points: 60,
        rarity: 'comum',
      },
    ];

    const unlockedIds = badges.map(badge => badge.achievement_id);
    const achievements = allAchievements.map(achievement => ({
      ...achievement,
      unlocked: unlockedIds.includes(achievement.id),
      earned_at: badges.find(b => b.achievement_id === achievement.id)?.earned_at,
    }));

    res.json({ achievements });
  } catch (error) {
    console.error('Get achievements error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update user plan
router.put('/plan', authenticateUser, async (req, res) => {
  try {
    const { plan, billing_cycle } = req.body;

    const { data, error } = await supabase
      .from('users')
      .update({
        plan,
        billing_cycle,
        updated_at: new Date().toISOString(),
      })
      .eq('id', req.user.id)
      .select()
      .single();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json({ message: 'Plan updated successfully', profile: data });
  } catch (error) {
    console.error('Update plan error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get online users
router.get('/online', async (req, res) => {
  try {
    // Para demonstração, vamos retornar usuários que fizeram login recentemente
    const { data: users, error } = await supabase
      .from('users')
      .select('id, username, full_name, city, state, latitude, longitude, last_login')
      .not('latitude', 'is', null)
      .not('longitude', 'is', null)
      .gte('last_login', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()) // últimas 24 horas
      .order('last_login', { ascending: false })
      .limit(100);

    if (error) {
      console.error('Get online users error:', error);
      return res.status(400).json({ error: error.message });
    }

    res.json(users || []);
  } catch (error) {
    console.error('Get online users error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;