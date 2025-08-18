const express = require('express');
const { supabase } = require('../config/supabase');
const { authenticateUser } = require('../middleware/auth');
const router = express.Router();

// Get user profile
router.get('/profile', authenticateUser, async (req, res) => {
  try {
    console.log('📋 Getting profile for user:', req.user.email);
    
    // O req.user já contém todos os dados do usuário vindos do middleware
    // Não precisamos fazer outra consulta
    const profile = {
      ...req.user,
      // Remover campos sensíveis se necessário
      // password: undefined,
      // stripe_customer_id: undefined
    };
    
    console.log('✅ Profile retrieved successfully');
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
    
    const { username, full_name, bio, city, state, phone, birth_date } = req.body;

    // Validate required fields
    if (!username || !full_name) {
      console.log('❌ Missing required fields: username or full_name');
      return res.status(400).json({ error: 'Username and full name are required' });
    }

    const updateData = {
      username,
      full_name,
      bio,
      city,
      state,
      phone,
      birth_date,
      updated_at: new Date().toISOString(),
    };

    console.log('📝 Update data:', updateData);
    console.log('🔍 User ID from req.user:', req.user.id);

    const { data, error } = await supabase
      .from('users')
      .update(updateData)
      .eq('id', req.user.id)
      .select()
      .single();

    if (error) {
      console.log('❌ Supabase update error:', error);
      return res.status(400).json({ error: error.message });
    }

    console.log('✅ Profile updated successfully:', data);
    res.json({ message: 'Profile updated successfully', profile: data });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get user statistics
router.get('/:userId/stats', authenticateUser, async (req, res) => {
  try {
    const { userId } = req.params;
    
    // Verificar se o usuário pode acessar estes dados
    if (req.user.id !== userId && !req.user.is_admin) {
      return res.status(403).json({ error: 'Acesso negado' });
    }

    // Get check-ins count
    const { count: checkinsCount } = await supabase
      .from('checkins')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    // Get points
    const { data: pointsData } = await supabase
      .from('points')
      .select('amount')
      .eq('user_id', userId);

    const totalPoints = pointsData?.reduce((sum, point) => sum + point.amount, 0) || 0;

    // Get badges count
    const { count: badgesCount } = await supabase
      .from('badges')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    // Get AI conversations count
    const { count: aiConversationsCount } = await supabase
      .from('ai_conversations')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

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
router.get('/ranking', authenticateUser, async (req, res) => {
  try {
    const { scope = 'city', period = 'month' } = req.query;
    const userId = req.user.id;

    console.log('🏆 Ranking - Buscando ranking para usuário:', userId);

    // Get user's city for city-based ranking
    const { data: userData } = await supabase
      .from('users')
      .select('city, state')
      .eq('id', userId)
      .single();

    let userQuery = supabase
      .from('users')
      .select('id, username, full_name, city, state, avatar_url');

    // Apply scope filter
    if (scope === 'city' && userData?.city) {
      userQuery = userQuery.eq('city', userData.city);
    } else if (scope === 'state' && userData?.state) {
      userQuery = userQuery.eq('state', userData.state);
    }

    const { data: users, error: usersError } = await userQuery.limit(100);

    if (usersError) {
      console.error('❌ Ranking - Erro ao buscar usuários:', usersError);
      return res.status(400).json({ error: usersError.message });
    }

    // Calculate points for each user from points table
    const userIds = users.map(user => user.id);
    const { data: pointsData, error: pointsError } = await supabase
      .from('points')
      .select('user_id, amount')
      .in('user_id', userIds);

    if (pointsError) {
      console.error('❌ Ranking - Erro ao buscar pontos:', pointsError);
    }

    // Calculate total points for each user
    const userPoints = {};
    if (pointsData) {
      pointsData.forEach(point => {
        if (!userPoints[point.user_id]) {
          userPoints[point.user_id] = 0;
        }
        userPoints[point.user_id] += point.amount;
      });
    }

    // Add points to users and sort by points
    const rankings = users.map(user => ({
      ...user,
      points: userPoints[user.id] || 0
    })).sort((a, b) => b.points - a.points);

    // Find user's position
    const userPosition = rankings.findIndex(user => user.id === userId) + 1;

    console.log('🏆 Ranking - Rankings calculados:', rankings.length, 'usuários');
    console.log('🏆 Ranking - Posição do usuário:', userPosition);

    res.json({
      rankings,
      user_position: userPosition || null,
      scope,
      period,
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