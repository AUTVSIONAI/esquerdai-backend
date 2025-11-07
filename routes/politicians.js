const express = require('express');
const { supabase } = require('../config/supabase');
const { authenticateUser } = require('../middleware/auth');
const { smartDispatcher } = require('../services/aiService');
const router = express.Router();

// Listar políticos
router.get('/', async (req, res) => {
  try {
    const { state, party, position, search, limit = 12, page = 1 } = req.query;
    
    const offset = (parseInt(page) - 1) * parseInt(limit);
    
    let query = supabase
      .from('politicians')
      .select('*', { count: 'exact' })
      .eq('is_active', true)
      .eq('is_approved', true)
      .order('name')
      .range(offset, offset + parseInt(limit) - 1);

    // Aplicar filtros condicionalmente
    if (state) {
      query = query.eq('state', state.toUpperCase());
    }
    if (party) {
      query = query.eq('party', party);
    }
    if (position) {
      query = query.eq('position', position);
    }
    if (search) {
      query = query.or(`name.ilike.%${search}%,short_bio.ilike.%${search}%`);
    }

    const { data: politicians, error, count: totalCount } = await query;

    if (error) {
      console.error('Erro ao buscar políticos:', error);
      return res.status(500).json({ 
        error: 'Erro ao buscar políticos', 
        details: error.message 
      });
    }

    // Calcular informações de paginação
    const totalPages = Math.ceil((totalCount || 0) / parseInt(limit));
    const currentPage = parseInt(page);

    res.json({
      success: true,
      data: politicians,
      pagination: {
        page: currentPage,
        pages: totalPages,
        limit: parseInt(limit),
        total: totalCount || 0
      }
    });
  } catch (error) {
    console.error('Erro na listagem de políticos:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Buscar político específico
router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    // Evitar capturar rotas estáticas como '/states', '/cities', '/parties', '/positions', '/ranking', '/me'
    const reservedPaths = new Set(['states','cities','parties','positions','ranking','me']);
    if (reservedPaths.has(id)) return next();

    const { data: politician, error } = await supabase
      .from('politicians')
      .select(`
        *,
        politician_agents (
          id,
          trained_prompt,
          voice_id,
          personality_config,
          is_active
        )
      `)
      .eq('id', id)
      .eq('is_active', true)
      .eq('is_approved', true)
      .single();

    if (error || !politician) {
      return res.status(404).json({ error: 'Político não encontrado' });
    }

    res.json({
      success: true,
      data: politician
    });
  } catch (error) {
    console.error('Erro ao buscar político:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Criar político (apenas admin)
router.post('/', authenticateUser, async (req, res) => {
  try {
    // Verificar se é admin usando o role já definido no middleware
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Acesso negado. Apenas administradores podem criar políticos.' });
    }

    const {
      name,
      position,
      state,
      party,
      photo_url,
      short_bio,
      social_links,
      government_plan,
      government_plan_pdf_url,
      main_ideologies
    } = req.body;

    if (!name || !position) {
      return res.status(400).json({ error: 'Nome e cargo são obrigatórios' });
    }

    const { data: politician, error } = await supabase
      .from('politicians')
      .insert({
        name,
        position,
        state: state?.toUpperCase(),
        party,
        photo_url,
        short_bio,
        social_links: social_links || {},
        government_plan,
        government_plan_pdf_url,
        main_ideologies: main_ideologies || []
      })
      .select()
      .single();

    if (error) {
      console.error('Erro ao criar político:', error);
      return res.status(500).json({ error: 'Erro ao criar político' });
    }

    res.status(201).json({
      success: true,
      data: politician,
      message: 'Político criado com sucesso'
    });
  } catch (error) {
    console.error('Erro na criação de político:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Atualizar político (apenas admin)
router.put('/:id', authenticateUser, async (req, res) => {
  try {
    // Verificar se é admin usando o role já definido no middleware
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Acesso negado. Apenas administradores podem editar políticos.' });
    }

    const { id } = req.params;
    const updateData = req.body;

    // Remover campos que não devem ser atualizados diretamente
    delete updateData.id;
    delete updateData.created_at;
    delete updateData.average_rating;
    delete updateData.total_votes;
    delete updateData.popularity_score;

    if (updateData.state) {
      updateData.state = updateData.state.toUpperCase();
    }

    const { data: politician, error } = await supabase
      .from('politicians')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Erro ao atualizar político:', error);
      return res.status(500).json({ error: 'Erro ao atualizar político' });
    }

    if (!politician) {
      return res.status(404).json({ error: 'Político não encontrado' });
    }

    res.json({
      success: true,
      data: politician,
      message: 'Político atualizado com sucesso'
    });
  } catch (error) {
    console.error('Erro na atualização de político:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Deletar político (apenas admin)
router.delete('/:id', authenticateUser, async (req, res) => {
  try {
    // Verificar se é admin usando o role já definido no middleware
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Acesso negado. Apenas administradores podem deletar políticos.' });
    }

    const { id } = req.params;

    const { error } = await supabase
      .from('politicians')
      .update({ is_active: false })
      .eq('id', id);

    if (error) {
      console.error('Erro ao deletar político:', error);
      return res.status(500).json({ error: 'Erro ao deletar político' });
    }

    res.json({
      success: true,
      message: 'Político removido com sucesso'
    });
  } catch (error) {
    console.error('Erro na remoção de político:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Rotas de avaliações para políticos específicos

// Listar avaliações de um político
router.get('/:id/ratings', async (req, res) => {
  try {
    const { id } = req.params;
    const { page = 1, sort = 'recent', limit = 10 } = req.query;
    
    const offset = (parseInt(page) - 1) * parseInt(limit);
    
    // Verificar se o político existe
    const { data: politician } = await supabase
      .from('politicians')
      .select('id')
      .eq('id', id)
      .eq('is_active', true)
      .single();

    if (!politician) {
      return res.status(404).json({ error: 'Político não encontrado' });
    }

    // Definir ordenação
    let orderBy = 'created_at';
    let ascending = false;
    
    if (sort === 'rating_high') {
      orderBy = 'rating';
      ascending = false;
    } else if (sort === 'rating_low') {
      orderBy = 'rating';
      ascending = true;
    }

    const { data: ratings, error, count } = await supabase
      .from('politician_ratings')
      .select(`
        *,
        users:users (
          id,
          full_name,
          username,
          email,
          avatar_url
        )
      `, { count: 'exact' })
      .eq('politician_id', id)
      .order(orderBy, { ascending })
      .range(offset, offset + parseInt(limit) - 1);

    if (error) {
      console.error('Erro ao buscar avaliações:', error);
      return res.status(500).json({ error: 'Erro interno do servidor' });
    }

    // Garantir que informações de exibição do usuário estejam presentes
    const userIds = [...new Set((ratings || []).map(r => r.user_id).filter(Boolean))];

    let usersMap = new Map();
    if (userIds.length > 0) {
      const { data: usersData, error: usersError } = await supabase
        .from('users')
        .select('id, full_name, username, email, avatar_url')
        .in('id', userIds);

      if (!usersError && usersData) {
        usersMap = new Map(usersData.map(u => [u.id, u]));
      }
    }

    const enrichedRatings = await Promise.all((ratings || []).map(async (r) => {
      let userInfo = r.users || usersMap.get(r.user_id) || null;

      // Se ainda não temos dados suficientes, buscar no auth.admin
      if (!userInfo || (!userInfo.full_name && !userInfo.username && !userInfo.email)) {
        try {
          const { data: adminData } = await supabase.auth.admin.getUserById(r.user_id);
          const authUser = adminData?.user;
          if (authUser) {
            userInfo = {
              id: authUser.id,
              full_name: authUser.user_metadata?.full_name || authUser.user_metadata?.name || null,
              username: authUser.user_metadata?.username || null,
              email: authUser.email || null,
              avatar_url: authUser.user_metadata?.avatar_url || authUser.user_metadata?.picture || null
            };
          }
        } catch (e) {
          // silenciosamente ignorar
        }
      }

      return { ...r, users: userInfo };
    }));

    // Calcular estatísticas
    const { data: allRatings } = await supabase
      .from('politician_ratings')
      .select('rating')
      .eq('politician_id', id);

    const totalVotes = allRatings?.length || 0;
    const averageRating = totalVotes > 0 
      ? allRatings.reduce((sum, r) => sum + r.rating, 0) / totalVotes 
      : 0;

    const ratingDistribution = {
      1: allRatings?.filter(r => r.rating === 1).length || 0,
      2: allRatings?.filter(r => r.rating === 2).length || 0,
      3: allRatings?.filter(r => r.rating === 3).length || 0,
      4: allRatings?.filter(r => r.rating === 4).length || 0,
      5: allRatings?.filter(r => r.rating === 5).length || 0
    };

    const totalPages = Math.ceil((count || 0) / parseInt(limit));

    res.json({
      success: true,
      data: enrichedRatings,
      stats: {
        total: totalVotes,
        average_rating: Math.round(averageRating * 100) / 100,
        distribution: ratingDistribution
      },
      pagination: {
        page: parseInt(page),
        pages: totalPages,
        limit: parseInt(limit),
        total: count || 0
      }
    });
  } catch (error) {
    console.error('Erro ao listar avaliações do político:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Buscar avaliação do usuário logado para um político
router.get('/:id/user-rating', authenticateUser, async (req, res) => {
  try {
    const { id } = req.params;

    const { data: userRating, error } = await supabase
      .from('politician_ratings')
      .select('*')
      .eq('politician_id', id)
      .eq('user_id', req.user.id)
      .single();

    if (error && error.code !== 'PGRST116') {
      console.error('Erro ao buscar avaliação do usuário:', error);
      return res.status(500).json({ error: 'Erro interno do servidor' });
    }

    res.json({
      success: true,
      data: userRating || null
    });
  } catch (error) {
    console.error('Erro ao buscar avaliação do usuário:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Criar avaliação para um político
router.post('/:id/ratings', authenticateUser, async (req, res) => {
  try {
    const { id } = req.params;
    const { rating, comment } = req.body;

    console.log('🔍 POST Rating - Dados recebidos:', { id, rating, comment, user: req.user });

    if (!rating || rating < 1 || rating > 5) {
      console.log('❌ Erro: Rating inválido:', rating);
      return res.status(400).json({ error: 'Avaliação deve ser entre 1 e 5 estrelas' });
    }

    // Verificar se o político existe
    const { data: politician } = await supabase
      .from('politicians')
      .select('id')
      .eq('id', id)
      .eq('is_active', true)
      .single();

    if (!politician) {
      return res.status(404).json({ error: 'Político não encontrado' });
    }

    // Verificar se o usuário já avaliou este político
    console.log('🔍 Verificando avaliação existente para user_id:', req.user.id);
    const { data: existingRating } = await supabase
      .from('politician_ratings')
      .select('id')
      .eq('politician_id', id)
      .eq('user_id', req.user.id)
      .single();

    if (existingRating) {
      console.log('❌ Erro: Usuário já avaliou este político');
      return res.status(400).json({ error: 'Você já avaliou este político. Use PUT para atualizar sua avaliação.' });
    }

    const { data: newRating, error } = await supabase
      .from('politician_ratings')
      .insert({
        politician_id: id,
        user_id: req.user.id,
        rating: parseInt(rating),
        comment: comment || null
      })
      .select('*')
      .single();

    if (error) {
      console.error('Erro ao criar avaliação:', error);
      return res.status(500).json({ error: 'Erro ao criar avaliação' });
    }

    // Atualizar estatísticas do político
    await updatePoliticianStats(id);

    res.status(201).json({
      success: true,
      data: newRating,
      message: 'Avaliação criada com sucesso'
    });
  } catch (error) {
    console.error('Erro na criação de avaliação:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Atualizar avaliação de um político
router.put('/:id/ratings', authenticateUser, async (req, res) => {
  try {
    const { id } = req.params;
    const { rating, comment } = req.body;

    if (rating && (rating < 1 || rating > 5)) {
      return res.status(400).json({ error: 'Avaliação deve ser entre 1 e 5 estrelas' });
    }

    // Verificar se a avaliação existe
    const { data: existingRating, error: checkError } = await supabase
      .from('politician_ratings')
      .select('id')
      .eq('politician_id', id)
      .eq('user_id', req.user.id)
      .single();

    if (checkError || !existingRating) {
      return res.status(404).json({ error: 'Avaliação não encontrada' });
    }

    const updateData = {};
    if (rating !== undefined) updateData.rating = parseInt(rating);
    if (comment !== undefined) updateData.comment = comment;

    const { data: updatedRating, error } = await supabase
      .from('politician_ratings')
      .update(updateData)
      .eq('politician_id', id)
      .eq('user_id', req.user.id)
      .select('*')
      .single();

    if (error) {
      console.error('Erro ao atualizar avaliação:', error);
      return res.status(500).json({ error: 'Erro ao atualizar avaliação' });
    }

    // Atualizar estatísticas do político
    await updatePoliticianStats(id);

    res.json({
      success: true,
      data: updatedRating,
      message: 'Avaliação atualizada com sucesso'
    });
  } catch (error) {
    console.error('Erro na atualização de avaliação:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Deletar avaliação de um político
router.delete('/:id/ratings', authenticateUser, async (req, res) => {
  try {
    const { id } = req.params;

    const { error } = await supabase
      .from('politician_ratings')
      .delete()
      .eq('politician_id', id)
      .eq('user_id', req.user.id);

    if (error) {
      console.error('Erro ao deletar avaliação:', error);
      return res.status(500).json({ error: 'Erro ao deletar avaliação' });
    }

    // Atualizar estatísticas do político
    await updatePoliticianStats(id);

    res.json({
      success: true,
      message: 'Avaliação removida com sucesso'
    });
  } catch (error) {
    console.error('Erro na remoção de avaliação:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Função auxiliar para atualizar estatísticas do político
async function updatePoliticianStats(politicianId) {
  try {
    const { data: ratings, error } = await supabase
      .from('politician_ratings')
      .select('rating')
      .eq('politician_id', politicianId);

    if (error) {
      console.error('Erro ao buscar avaliações para atualizar stats:', error);
      return;
    }

    const totalVotes = ratings?.length || 0;
    const averageRating = totalVotes > 0 
      ? ratings.reduce((sum, r) => sum + r.rating, 0) / totalVotes 
      : 0;

    // Calcular pontuação de popularidade (baseada em número de votos e média)
    const popularityScore = Math.round((averageRating * totalVotes) / 5 * 100);

    await supabase
      .from('politicians')
      .update({
        total_votes: totalVotes,
        average_rating: Math.round(averageRating * 100) / 100,
        popularity_score: popularityScore
      })
      .eq('id', politicianId);
  } catch (error) {
    console.error('Erro ao atualizar estatísticas do político:', error);
  }
}

// Obter cidades disponíveis
router.get('/cities', async (req, res) => {
  try {
    const { data: cities, error } = await supabase
      .from('politicians')
      .select('city')
      .not('city', 'is', null)
      .neq('city', '')
      .eq('is_active', true);

    if (error) {
      console.error('Erro ao buscar cidades:', error);
      return res.status(500).json({ error: 'Erro interno do servidor' });
    }

    // Extrair cidades únicas e ordenar
    const uniqueCities = [...new Set(cities.map(p => p.city).filter(Boolean))].sort();

    res.json({
      success: true,
      data: uniqueCities
    });
  } catch (error) {
    console.error('Erro na busca de cidades:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Obter estados disponíveis
router.get('/states', async (req, res) => {
  try {
    const { data: states, error } = await supabase
      .from('politicians')
      .select('state')
      .not('state', 'is', null)
      .neq('state', '')
      .eq('is_active', true);

    if (error) {
      console.error('Erro ao buscar estados:', error);
      return res.status(500).json({ error: 'Erro interno do servidor' });
    }

    // Extrair estados únicos e ordenar
    const uniqueStates = [...new Set(states.map(p => p.state).filter(Boolean))].sort();

    res.json({
      success: true,
      data: uniqueStates
    });
  } catch (error) {
    console.error('Erro na busca de estados:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Obter partidos disponíveis
router.get('/parties', async (req, res) => {
  try {
    const { data: parties, error } = await supabase
      .from('politicians')
      .select('party')
      .not('party', 'is', null)
      .neq('party', '')
      .eq('is_active', true);

    if (error) {
      console.error('Erro ao buscar partidos:', error);
      return res.status(500).json({ error: 'Erro interno do servidor' });
    }

    // Extrair partidos únicos e ordenar
    const uniqueParties = [...new Set(parties.map(p => p.party).filter(Boolean))].sort();

    res.json({
      success: true,
      data: uniqueParties
    });
  } catch (error) {
    console.error('Erro na busca de partidos:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Obter posições disponíveis
router.get('/positions', async (req, res) => {
  try {
    const { data: positions, error } = await supabase
      .from('politicians')
      .select('position')
      .not('position', 'is', null)
      .neq('position', '')
      .eq('is_active', true);

    if (error) {
      console.error('Erro ao buscar posições:', error);
      return res.status(500).json({ error: 'Erro interno do servidor' });
    }

    // Extrair posições únicas e ordenar
    const uniquePositions = [...new Set(positions.map(p => p.position).filter(Boolean))].sort();

    res.json({
      success: true,
      data: uniquePositions
    });
  } catch (error) {
    console.error('Erro na busca de posições:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});



// Endpoint para obter o político vinculado ao usuário logado
router.get('/me', authenticateUser, async (req, res) => {
  try {
    const userEmail = req.user?.email;
    if (!userEmail) {
      return res.status(400).json({ error: 'Usuário autenticado sem e-mail vinculado.' });
    }

    const { data: politician, error } = await supabase
      .from('politicians')
      .select(`
        *,
        politician_agents (
          id,
          trained_prompt,
          voice_id,
          personality_config,
          is_active
        )
      `)
      .eq('email', userEmail)
      .eq('is_active', true)
      .eq('is_approved', true)
      .single();

    if (error || !politician) {
      return res.status(404).json({ error: 'Político não encontrado ou não aprovado para este usuário.' });
    }

    res.json({ success: true, data: politician });
  } catch (error) {
    console.error('Erro ao obter político do usuário (/politicians/me):', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Endpoint para estatísticas do agente do político logado
router.get('/me/stats', authenticateUser, async (req, res) => {
  try {
    const userEmail = req.user?.email;
    if (!userEmail) {
      return res.status(400).json({ error: 'Usuário autenticado sem e-mail vinculado.' });
    }

    // Buscar político e agente
    const { data: politician, error: polErr } = await supabase
      .from('politicians')
      .select(`
        id,
        name,
        average_rating,
        total_votes,
        politician_agents ( id, is_active )
      `)
      .eq('email', userEmail)
      .eq('is_active', true)
      .eq('is_approved', true)
      .single();

    if (polErr || !politician) {
      return res.status(404).json({ error: 'Político não encontrado ou não aprovado.' });
    }

    const agentId = politician?.politician_agents?.id;
    if (!agentId || !politician?.politician_agents?.is_active) {
      return res.status(404).json({ error: 'Agente do político não encontrado ou inativo.' });
    }

    // Contagem de mensagens do agente
    const { count: total_messages, error: msgErr } = await supabase
      .from('agent_conversations')
      .select('id', { count: 'exact', head: true })
      .eq('agent_id', agentId);

    if (msgErr) {
      console.error('Erro ao contar mensagens do agente:', msgErr);
    }

    // Contagem de avaliações do político
    const { count: total_ratings, error: rateErr } = await supabase
      .from('politician_ratings')
      .select('id', { count: 'exact', head: true })
      .eq('politician_id', politician.id);

    if (rateErr) {
      console.error('Erro ao contar avaliações do político:', rateErr);
    }

    res.json({
      success: true,
      data: {
        politician_id: politician.id,
        agent_id: agentId,
        total_messages: total_messages || 0,
        total_ratings: total_ratings || 0,
        average_rating: politician.average_rating || 0,
        total_votes: politician.total_votes || 0
      }
    });
  } catch (error) {
    console.error('Erro ao obter estatísticas do agente (/politicians/me/stats):', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Endpoint para atualizar o prompt do agente do político logado
router.put('/me/agent/prompt', authenticateUser, async (req, res) => {
  try {
    const userEmail = req.user?.email;
    const { trained_prompt } = req.body || {};

    if (!userEmail) {
      return res.status(400).json({ error: 'Usuário autenticado sem e-mail vinculado.' });
    }
    if (!trained_prompt || typeof trained_prompt !== 'string') {
      return res.status(400).json({ error: 'Campo trained_prompt é obrigatório e deve ser uma string.' });
    }

    // Buscar político e agente
    const { data: politician, error: polErr } = await supabase
      .from('politicians')
      .select('id, politician_agents ( id, is_active )')
      .eq('email', userEmail)
      .eq('is_active', true)
      .eq('is_approved', true)
      .single();

    if (polErr || !politician) {
      return res.status(404).json({ error: 'Político não encontrado ou não aprovado.' });
    }

    const agentId = politician?.politician_agents?.id;
    if (!agentId || !politician?.politician_agents?.is_active) {
      return res.status(404).json({ error: 'Agente do político não encontrado ou inativo.' });
    }

    // Atualizar prompt do agente
    const { data: updated, error: updErr } = await supabase
      .from('politician_agents')
      .update({ trained_prompt })
      .eq('id', agentId)
      .select('id, trained_prompt')
      .single();

    if (updErr) {
      console.error('Erro ao atualizar prompt do agente:', updErr);
      return res.status(500).json({ error: 'Erro ao atualizar prompt do agente' });
    }

    res.json({ success: true, data: updated, message: 'Prompt do agente atualizado com sucesso' });
  } catch (error) {
    console.error('Erro ao atualizar prompt do agente (/politicians/me/agent/prompt):', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Endpoint para interações recentes do agente do político logado
router.get('/me/agent/interactions', authenticateUser, async (req, res) => {
  try {
    const userEmail = req.user?.email;
    if (!userEmail) {
      return res.status(400).json({ error: 'Usuário autenticado sem e-mail vinculado.' });
    }

    const { data: politician, error: polErr } = await supabase
      .from('politicians')
      .select('id, politician_agents ( id, is_active )')
      .eq('email', userEmail)
      .eq('is_active', true)
      .eq('is_approved', true)
      .single();

    if (polErr || !politician) {
      return res.status(404).json({ error: 'Político não encontrado ou não aprovado.' });
    }

    const agentId = politician?.politician_agents?.id;
    if (!agentId || !politician?.politician_agents?.is_active) {
      return res.status(404).json({ error: 'Agente do político não encontrado ou inativo.' });
    }

    const limit = parseInt(req.query.limit || '20');
    const { data: interactions, error: convErr } = await supabase
      .from('agent_conversations')
      .select('id, user_id, user_message, agent_response, created_at')
      .eq('agent_id', agentId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (convErr) {
      console.error('Erro ao buscar interações do agente:', convErr);
      return res.status(500).json({ error: 'Erro ao buscar interações' });
    }

    res.json({ success: true, data: interactions || [] });
  } catch (error) {
    console.error('Erro no endpoint /politicians/me/agent/interactions:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Endpoint para sugestões de melhoria do prompt do agente do político logado
router.get('/me/agent/suggestions', authenticateUser, async (req, res) => {
  try {
    const userEmail = req.user?.email;
    if (!userEmail) {
      return res.status(400).json({ error: 'Usuário autenticado sem e-mail vinculado.' });
    }

    const { data: politician, error: polErr } = await supabase
      .from('politicians')
      .select(`id, name, position, state, party, government_plan, main_ideologies, politician_agents ( id, trained_prompt, is_active )`)
      .eq('email', userEmail)
      .eq('is_active', true)
      .eq('is_approved', true)
      .single();

    if (polErr || !politician) {
      return res.status(404).json({ error: 'Político não encontrado ou não aprovado.' });
    }

    const agent = politician?.politician_agents;
    if (!agent?.id || !agent?.is_active) {
      return res.status(404).json({ error: 'Agente do político não encontrado ou inativo.' });
    }

    const systemPrompt = `Você é um especialista em engenharia de prompts para agentes de políticos brasileiros.\nContexto do político:\n- Nome: ${politician.name}\n- Cargo: ${politician.position}\n- Estado: ${politician.state || 'Nacional'}\n- Partido: ${politician.party}\n- Plano de governo: ${politician.government_plan || 'Não especificado'}\n- Ideologias principais: ${Array.isArray(politician.main_ideologies) ? politician.main_ideologies.join(', ') : (politician.main_ideologies || 'Não especificado')}\n\nObjetivo: gerar sugestões claras e práticas para melhorar o prompt do agente, mantendo coerência com o perfil do político e linguagem adequada.`;

    const userMessage = `Prompt atual do agente:\n\"\"\"\n${agent.trained_prompt || 'Sem prompt definido'}\n\"\"\"\n\nProduza exatamente 5 sugestões objetivas para aprimorar o prompt acima. Formate sua resposta EXCLUSIVAMENTE como um JSON array de strings, por exemplo: [\"sugestão 1\", \"sugestão 2\", ...]. As sugestões devem ser curtas (1 frase), específicas, e sem explicações adicionais.`;

    let suggestions = [];
    try {
      const result = await smartDispatcher(userMessage, systemPrompt);
      const text = result?.content || '';
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        suggestions = JSON.parse(jsonMatch[0]);
      } else {
        suggestions = text
          .split('\n')
          .map(s => s.replace(/^[\-•]\s*/, '').trim())
          .filter(Boolean)
          .slice(0, 5);
      }
    } catch (genErr) {
      console.error('Erro ao gerar sugestões de prompt:', genErr);
      suggestions = [];
    }

    res.json({ success: true, data: { suggestions } });
  } catch (error) {
    console.error('Erro no endpoint /politicians/me/agent/suggestions:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Ranking de políticos por atividade
router.get('/ranking', async (req, res) => {
  try {
    const { period = 'month', state } = req.query;

    // Determinar janela de tempo
    let startDate = null;
    const now = new Date();
    if (period === 'week') {
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    } else if (period === 'month') {
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    } // 'all' mantém startDate como null

    // Buscar políticos ativos e aprovados
    let polQuery = supabase
      .from('politicians')
      .select('id, name, party, state, average_rating, total_votes')
      .eq('is_active', true)
      .eq('is_approved', true);

    if (state) polQuery = polQuery.eq('state', String(state).toUpperCase());

    const { data: politicians, error: polErr } = await polQuery;
    if (polErr) {
      console.error('Erro ao buscar políticos para ranking:', polErr);
      return res.status(500).json({ error: 'Erro interno ao calcular ranking' });
    }

    const politicianIds = (politicians || []).map(p => p.id);
    if (politicianIds.length === 0) {
      return res.json({ success: true, rankings: [], total: 0 });
    }

    // Buscar agentes ativos por político
    const { data: agents, error: agErr } = await supabase
      .from('politician_agents')
      .select('id, politician_id, is_active')
      .in('politician_id', politicianIds)
      .eq('is_active', true);

    if (agErr) {
      console.error('Erro ao buscar agentes para ranking:', agErr);
      return res.status(500).json({ error: 'Erro interno ao calcular ranking' });
    }

    const agentsByPolitician = new Map();
    const agentIds = [];
    (agents || []).forEach(a => {
      agentsByPolitician.set(a.politician_id, a.id);
      agentIds.push(a.id);
    });

    // Função auxiliar para contar mensagens por agente
    const countMessagesForAgent = async (agentId) => {
      if (!agentId) return 0;
      let msgQuery = supabase
        .from('agent_conversations')
        .select('id', { count: 'exact', head: true })
        .eq('agent_id', agentId);
      if (startDate) msgQuery = msgQuery.gte('created_at', startDate);
      const { count } = await msgQuery;
      return count || 0;
    };

    // Função auxiliar para contar avaliações por político
    const countRatingsForPolitician = async (politicianId) => {
      if (!politicianId) return 0;
      let rateQuery = supabase
        .from('politician_ratings')
        .select('id', { count: 'exact', head: true })
        .eq('politician_id', politicianId);
      if (startDate) rateQuery = rateQuery.gte('created_at', startDate);
      const { count } = await rateQuery;
      return count || 0;
    };

    // Construir ranking
    const rankings = [];
    for (const p of politicians) {
      const agentId = agentsByPolitician.get(p.id);
      const [agent_messages, ratings_count] = await Promise.all([
        countMessagesForAgent(agentId),
        countRatingsForPolitician(p.id)
      ]);

      const avg = Number(p.average_rating || 0);
      const score = (agent_messages * 1) + (ratings_count * 2) + (avg * 5);

      rankings.push({
        id: p.id,
        name: p.name,
        party: p.party,
        state: p.state,
        agent_id: agentId || null,
        agent_messages,
        ratings_count,
        average_rating: avg,
        total_votes: p.total_votes || 0,
        activity_score: Math.round(score)
      });
    }

    // Ordenar por score
    rankings.sort((a, b) => b.activity_score - a.activity_score);

    res.json({ success: true, rankings, total: rankings.length, period });
  } catch (error) {
    console.error('Erro no endpoint /politicians/ranking:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

module.exports = router;