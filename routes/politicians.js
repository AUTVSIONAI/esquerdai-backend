const express = require('express');
const { supabase } = require('../config/supabase');
const { authenticateUser } = require('../middleware/auth');
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
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

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
      .select('*', { count: 'exact' })
      .eq('politician_id', id)
      .order(orderBy, { ascending })
      .range(offset, offset + parseInt(limit) - 1);

    if (error) {
      console.error('Erro ao buscar avaliações:', error);
      return res.status(500).json({ error: 'Erro interno do servidor' });
    }

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
      data: ratings,
      stats: {
        total_votes: totalVotes,
        average_rating: Math.round(averageRating * 100) / 100,
        rating_distribution: ratingDistribution
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

    const { data: userRating } = await supabase
      .from('politician_ratings')
      .select('*')
      .eq('politician_id', id)
      .eq('user_id', req.user.auth_id)
      .single();

    if (error && error.code !== 'PGRST116') {
      console.error('Erro ao buscar avaliação do usuário:', error);
      return res.status(500).json({ error: 'Erro interno do servidor' });
    }

    res.json({
      success: true,
      data: rating || null
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
    console.log('🔍 Verificando avaliação existente para user_id:', req.user.auth_id);
    const { data: existingRating } = await supabase
      .from('politician_ratings')
      .select('id')
      .eq('politician_id', id)
      .eq('user_id', req.user.auth_id)
      .single();

    if (existingRating) {
      console.log('❌ Erro: Usuário já avaliou este político');
      return res.status(400).json({ error: 'Você já avaliou este político. Use PUT para atualizar sua avaliação.' });
    }

    const { data: newRating, error } = await supabase
      .from('politician_ratings')
      .insert({
        politician_id: id,
        user_id: req.user.auth_id,
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
      .eq('user_id', req.user.auth_id)
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
      .eq('user_id', req.user.auth_id)
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
      .eq('user_id', req.user.auth_id);

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

module.exports = router;