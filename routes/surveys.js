const express = require('express');
const { supabase } = require('../config/supabase');
const { authenticateUser, optionalAuthenticateUser } = require('../middleware/auth');
const router = express.Router();

// Listar pesquisas ativas
router.get('/', optionalAuthenticateUser, async (req, res) => {
  try {
    const { category, politician_id, publico_alvo, limit = 10, offset = 0, include_expired = false } = req.query;
    
    let query = supabase
      .from('pesquisas')
      .select(`
        id,
        titulo,
        descricao,
        opcoes,
        tipo,
        publico_alvo,
        regiao_especifica,
        politician_id,
        data_expiracao,
        is_active,
        is_anonymous,
        allow_comments,
        max_votes_per_user,
        total_votes,
        created_at,
        politicians(name, photo_url)
      `)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

    // Filtrar pesquisas não expiradas (a menos que solicitado)
    if (!include_expired || include_expired === 'false') {
      query = query.or('data_expiracao.is.null,data_expiracao.gt.' + new Date().toISOString());
    }
    
    // Aplicar filtros
    if (politician_id) {
      query = query.eq('politician_id', politician_id);
    }
    if (publico_alvo) {
      query = query.eq('publico_alvo', publico_alvo);
    }

    let { data: pesquisas, error, count: totalCount } = await query;

    if (error) {
      console.error('Erro ao buscar pesquisas (com relação politicians):', error);
      // Fallback: tentar novamente sem a relação com politicians para evitar 500
      try {
        const fallbackQuery = supabase
          .from('pesquisas')
          .select(`
            id,
            titulo,
            descricao,
            opcoes,
            tipo,
            publico_alvo,
            regiao_especifica,
            politician_id,
            data_expiracao,
            is_active,
            is_anonymous,
            allow_comments,
            max_votes_per_user,
            total_votes,
            created_at
          `)
          .eq('is_active', true)
          .order('created_at', { ascending: false })
          .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

        const fallback = await fallbackQuery;
        pesquisas = fallback.data || [];
        error = fallback.error || null;
        totalCount = fallback.count;
      } catch (fallbackErr) {
        console.error('Erro no fallback de pesquisas:', fallbackErr);
        // Em último caso, responder 200 com lista vazia para não quebrar a UI
        return res.json({
          success: true,
          data: [],
          pagination: {
            page: Math.floor(parseInt(offset) / parseInt(limit)) + 1,
            pages: 0,
            limit: parseInt(limit),
            total: 0
          }
        });
      }
    }

    // Se usuário autenticado, verificar votos
    let pesquisasComVotos = pesquisas;
    if (req.user && req.user.id) {
      const userId = req.user.id;
      
      // Buscar votos do usuário para todas as pesquisas
      const { data: votosUsuario, error: votosError } = await supabase
        .from('votos')
        .select('pesquisa_id, opcao_id')
        .eq('usuario_id', userId)
        .in('pesquisa_id', pesquisas.map(p => p.id));

      if (!votosError && votosUsuario) {
        pesquisasComVotos = pesquisas.map(pesquisa => {
          const votoUsuario = votosUsuario.find(v => v.pesquisa_id === pesquisa.id);
          return {
            ...pesquisa,
            user_voted: votoUsuario ? votoUsuario.opcao_id : null
          };
        });
      }
    } else {
      // Para usuários não autenticados, definir user_voted como null
      pesquisasComVotos = pesquisas.map(pesquisa => ({
        ...pesquisa,
        user_voted: null
      }));
    }

    // Calcular informações de paginação
    const totalPages = Math.ceil((totalCount || pesquisas.length) / parseInt(limit));
    const currentPage = Math.floor(parseInt(offset) / parseInt(limit)) + 1;

    res.json({
      success: true,
      data: pesquisasComVotos,
      pagination: {
        page: currentPage,
        pages: totalPages,
        limit: parseInt(limit),
        total: totalCount || pesquisas.length
      }
    });
  } catch (error) {
    console.error('Erro na listagem de pesquisas:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Obter estatísticas das pesquisas
router.get('/stats', async (req, res) => {
  try {
    const { period = 'all' } = req.query;
    
    let dateFilter = '';
    const now = new Date();
    
    if (period === 'week') {
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      dateFilter = weekAgo.toISOString();
    } else if (period === 'month') {
      const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      dateFilter = monthAgo.toISOString();
    }
    
    // Total de pesquisas ativas
    let pesquisasQuery = supabase
      .from('pesquisas')
      .select('*', { count: 'exact', head: true })
      .eq('is_active', true);
    
    if (dateFilter) {
      pesquisasQuery = pesquisasQuery.gte('created_at', dateFilter);
    }
    
    const { count: totalPesquisas, error: pesquisasError } = await pesquisasQuery;
    
    if (pesquisasError) {
      console.error('Erro ao contar pesquisas:', pesquisasError);
      return res.status(500).json({ error: 'Erro interno do servidor' });
    }
    
    // Total de votos
    let votosQuery = supabase
      .from('votos')
      .select('*', { count: 'exact', head: true });
    
    if (dateFilter) {
      votosQuery = votosQuery.gte('created_at', dateFilter);
    }
    
    const { count: totalVotos, error: votosError } = await votosQuery;
    
    if (votosError) {
      console.error('Erro ao contar votos:', votosError);
      return res.status(500).json({ error: 'Erro interno do servidor' });
    }
    
    // Pesquisas mais votadas
    let topQuery = supabase
      .from('pesquisas')
      .select('id, titulo, total_votes')
      .eq('is_active', true)
      .order('total_votes', { ascending: false })
      .limit(5);
    
    if (dateFilter) {
      topQuery = topQuery.gte('created_at', dateFilter);
    }
    
    const { data: topPesquisas, error: topError } = await topQuery;
    
    if (topError) {
      console.error('Erro ao buscar top pesquisas:', topError);
      return res.status(500).json({ error: 'Erro interno do servidor' });
    }
    
    res.json({
      success: true,
      data: {
        total_pesquisas: totalPesquisas || 0,
        total_votos: totalVotos || 0,
        pesquisas_mais_votadas: topPesquisas || []
      }
    });
  } catch (error) {
    console.error('Erro ao buscar estatísticas:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Rota para /api/surveys/results (resultados gerais) - DEVE vir antes de /:id
router.get('/results', async (req, res) => {
  try {
    const { period = 'all' } = req.query;
    
    let dateFilter = '';
    const now = new Date();
    
    if (period === 'week') {
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      dateFilter = weekAgo.toISOString();
    } else if (period === 'month') {
      const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      dateFilter = monthAgo.toISOString();
    }
    
    let query = supabase
      .from('pesquisas')
      .select(`
        id,
        titulo,
        descricao,
        opcoes,
        total_votes,
        created_at,
        politicians(name, photo_url)
      `)
      .eq('is_active', true)
      .order('total_votes', { ascending: false })
      .limit(10);
    
    if (dateFilter) {
      query = query.gte('created_at', dateFilter);
    }
    
    const { data: pesquisas, error } = await query;
    
    if (error) {
      console.error('Erro ao buscar resultados:', error);
      return res.status(500).json({ error: 'Erro interno do servidor' });
    }
    
    res.json({
      success: true,
      data: pesquisas || []
    });
  } catch (error) {
    console.error('Erro ao buscar resultados:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Buscar pesquisa específica por ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const { data: pesquisa, error } = await supabase
      .from('pesquisas')
      .select(`
        *,
        politicians(name, photo_url, position, party)
      `)
      .eq('id', id)
      .eq('is_active', true)
      .single();

    if (error || !pesquisa) {
      return res.status(404).json({ error: 'Pesquisa não encontrada' });
    }

    // Verificar se a pesquisa não expirou
    if (pesquisa.data_expiracao && new Date(pesquisa.data_expiracao) < new Date()) {
      return res.status(410).json({ error: 'Pesquisa expirada' });
    }

    res.json({
      success: true,
      data: pesquisa
    });
  } catch (error) {
    console.error('Erro ao buscar pesquisa:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Obter resultados de uma pesquisa
router.get('/:id/results', async (req, res) => {
  try {
    const { id } = req.params;

    // Buscar a pesquisa
    const { data: pesquisa, error: pesquisaError } = await supabase
      .from('pesquisas')
      .select('*')
      .eq('id', id)
      .single();

    if (pesquisaError || !pesquisa) {
      return res.status(404).json({ error: 'Pesquisa não encontrada' });
    }

    // Buscar votos agrupados por opção
    const { data: votos, error: votosError } = await supabase
      .from('votos')
      .select('opcao_id')
      .eq('pesquisa_id', id);

    if (votosError) {
      console.error('Erro ao buscar votos:', votosError);
      return res.status(500).json({ error: 'Erro interno do servidor' });
    }

    // Processar resultados
    const opcoes = pesquisa.opcoes || [];
    const resultados = opcoes.map(opcao => {
      const votosOpcao = votos.filter(voto => voto.opcao_id === opcao.id).length;
      const porcentagem = pesquisa.total_votes > 0 ? (votosOpcao / pesquisa.total_votes * 100).toFixed(1) : 0;
      
      return {
        id: opcao.id,
        texto: opcao.texto,
        votos: votosOpcao,
        porcentagem: parseFloat(porcentagem)
      };
    });

    res.json({
      success: true,
      data: {
        pesquisa: {
          id: pesquisa.id,
          titulo: pesquisa.titulo,
          descricao: pesquisa.descricao,
          tipo: pesquisa.tipo,
          total_votes: pesquisa.total_votes,
          created_at: pesquisa.created_at,
          data_expiracao: pesquisa.data_expiracao
        },
        resultados
      }
    });
  } catch (error) {
    console.error('Erro ao buscar resultados:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Votar em uma pesquisa
router.post('/:id/vote', authenticateUser, async (req, res) => {
  try {
    const { id } = req.params;
    const { opcao_id, comentario } = req.body;
    const userId = req.user.id;
    const userIp = req.ip || req.connection.remoteAddress;
    const userAgent = req.get('User-Agent');

    if (!opcao_id) {
      return res.status(400).json({ error: 'Opção de voto é obrigatória' });
    }

    // Buscar a pesquisa
    const { data: pesquisa, error: pesquisaError } = await supabase
      .from('pesquisas')
      .select('*')
      .eq('id', id)
      .eq('is_active', true)
      .single();

    if (pesquisaError || !pesquisa) {
      return res.status(404).json({ error: 'Pesquisa não encontrada' });
    }

    // Verificar se a pesquisa não expirou
    if (pesquisa.data_expiracao && new Date(pesquisa.data_expiracao) < new Date()) {
      return res.status(410).json({ error: 'Pesquisa expirada' });
    }

    // Verificar se a opção existe
    const opcaoValida = pesquisa.opcoes.find(opcao => opcao.id === opcao_id);
    if (!opcaoValida) {
      return res.status(400).json({ error: 'Opção de voto inválida' });
    }

    // Verificar se o usuário já votou
    const { data: votoExistente, error: votoError } = await supabase
      .from('votos')
      .select('*')
      .eq('pesquisa_id', id)
      .eq('usuario_id', userId)
      .eq('opcao_id', opcao_id);

    if (votoError) {
      console.error('Erro ao verificar voto existente:', votoError);
      return res.status(500).json({ error: 'Erro interno do servidor' });
    }

    if (votoExistente && votoExistente.length > 0) {
      return res.status(409).json({ error: 'Você já votou nesta opção' });
    }

    // Para pesquisas de múltipla escolha, verificar limite de votos
    if (pesquisa.tipo === 'multipla') {
      const { data: votosUsuario, error: votosUsuarioError } = await supabase
        .from('votos')
        .select('*')
        .eq('pesquisa_id', id)
        .eq('usuario_id', userId);

      if (votosUsuarioError) {
        console.error('Erro ao verificar votos do usuário:', votosUsuarioError);
        return res.status(500).json({ error: 'Erro interno do servidor' });
      }

      if (votosUsuario.length >= pesquisa.max_votes_per_user) {
        return res.status(409).json({ 
          error: `Você já atingiu o limite de ${pesquisa.max_votes_per_user} votos nesta pesquisa` 
        });
      }
    } else {
      // Para pesquisas simples, verificar se já votou em qualquer opção
      const { data: qualquerVoto, error: qualquerVotoError } = await supabase
        .from('votos')
        .select('*')
        .eq('pesquisa_id', id)
        .eq('usuario_id', userId);

      if (qualquerVotoError) {
        console.error('Erro ao verificar votos do usuário:', qualquerVotoError);
        return res.status(500).json({ error: 'Erro interno do servidor' });
      }

      if (qualquerVoto && qualquerVoto.length > 0) {
        const votoAnterior = qualquerVoto[0];
        const opcaoAnterior = pesquisa.opcoes.find(opt => opt.id === votoAnterior.opcao_id);
        return res.status(409).json({ 
          error: 'Você já votou nesta pesquisa',
          previous_vote: {
            opcao_id: votoAnterior.opcao_id,
            opcao_texto: opcaoAnterior?.texto || 'Opção não encontrada',
            data_voto: votoAnterior.created_at
          }
        });
      }
    }

    // Registrar o voto
    const { data: novoVoto, error: novoVotoError } = await supabase
      .from('votos')
      .insert({
        pesquisa_id: id,
        usuario_id: userId,
        opcao_id: opcao_id,
        comentario: comentario || null,
        user_ip: userIp,
        user_agent: userAgent
      })
      .select()
      .single();

    if (novoVotoError) {
      console.error('Erro ao registrar voto:', novoVotoError);
      return res.status(500).json({ error: 'Erro ao registrar voto' });
    }

    res.json({
      success: true,
      message: 'Voto registrado com sucesso',
      data: {
        voto_id: novoVoto.id,
        opcao_escolhida: opcaoValida.texto
      }
    });
  } catch (error) {
    console.error('Erro ao votar:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Criar pesquisa (usuários autenticados)
router.post('/', authenticateUser, async (req, res) => {
  try {
    // Verificar se o usuário está autenticado
    if (!req.user) {
      return res.status(401).json({ error: 'Usuário não autenticado' });
    }

    const {
      titulo,
      descricao,
      opcoes,
      tipo = 'simples',
      publico_alvo = 'todos',
      regiao_especifica,
      politician_id,
      data_expiracao,
      is_anonymous = true,
      allow_comments = false,
      max_votes_per_user = 1
    } = req.body;

    // Validações
    if (!titulo || !opcoes || !Array.isArray(opcoes) || opcoes.length < 2) {
      return res.status(400).json({ 
        error: 'Título e pelo menos 2 opções são obrigatórios' 
      });
    }

    if (opcoes.length > 10) {
      return res.status(400).json({ 
        error: 'Máximo de 10 opções permitidas' 
      });
    }

    // Validar formato das opções
    const opcoesFormatadas = opcoes.map((opcao, index) => ({
      id: index + 1,
      texto: typeof opcao === 'string' ? opcao : opcao.texto
    }));

    // Validar data de expiração
    let dataExpiracao = null;
    if (data_expiracao) {
      dataExpiracao = new Date(data_expiracao);
      if (dataExpiracao <= new Date()) {
        return res.status(400).json({ 
          error: 'Data de expiração deve ser no futuro' 
        });
      }
    }

    // Criar pesquisa
    const { data: novaPesquisa, error } = await supabase
      .from('pesquisas')
      .insert({
        titulo,
        descricao,
        opcoes: opcoesFormatadas,
        tipo,
        publico_alvo,
        regiao_especifica,
        politician_id: politician_id || null,
        autor_id: req.user.id,
        data_expiracao: dataExpiracao,
        is_anonymous,
        allow_comments,
        max_votes_per_user: tipo === 'multipla' ? max_votes_per_user : 1
      })
      .select()
      .single();

    if (error) {
      console.error('Erro ao criar pesquisa:', error);
      return res.status(500).json({ error: 'Erro ao criar pesquisa' });
    }

    res.status(201).json({
      success: true,
      message: 'Pesquisa criada com sucesso',
      data: novaPesquisa
    });
  } catch (error) {
    console.error('Erro ao criar pesquisa:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Atualizar pesquisa (apenas admin)
router.put('/:id', authenticateUser, async (req, res) => {
  try {
    // Verificar se é admin
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Acesso negado. Apenas administradores podem editar pesquisas.' });
    }

    const { id } = req.params;
    const {
      titulo,
      descricao,
      opcoes,
      tipo,
      publico_alvo,
      data_expiracao,
      is_active,
      allow_comments
    } = req.body;

    // Buscar pesquisa existente
    const { data: pesquisaExistente, error: pesquisaError } = await supabase
      .from('pesquisas')
      .select('*')
      .eq('id', id)
      .single();

    if (pesquisaError || !pesquisaExistente) {
      return res.status(404).json({ error: 'Pesquisa não encontrada' });
    }

    // Preparar dados para atualização
    const dadosAtualizacao = {};
    if (titulo !== undefined) dadosAtualizacao.titulo = titulo;
    if (descricao !== undefined) dadosAtualizacao.descricao = descricao;
    if (tipo !== undefined) dadosAtualizacao.tipo = tipo;
    if (publico_alvo !== undefined) dadosAtualizacao.publico_alvo = publico_alvo;
    if (is_active !== undefined) dadosAtualizacao.is_active = is_active;
    if (allow_comments !== undefined) dadosAtualizacao.allow_comments = allow_comments;
    
    // Processar opções se fornecidas
    if (opcoes !== undefined && Array.isArray(opcoes)) {
      if (opcoes.length < 2) {
        return res.status(400).json({ 
          error: 'Pelo menos 2 opções são obrigatórias' 
        });
      }
      if (opcoes.length > 10) {
        return res.status(400).json({ 
          error: 'Máximo de 10 opções permitidas' 
        });
      }
      
      const opcoesFormatadas = opcoes.map((opcao, index) => ({
        id: index + 1,
        texto: typeof opcao === 'string' ? opcao : opcao.texto
      }));
      
      dadosAtualizacao.opcoes = opcoesFormatadas;
    }
    
    if (data_expiracao !== undefined) {
      if (data_expiracao) {
        const dataExpiracao = new Date(data_expiracao);
        if (dataExpiracao <= new Date()) {
          return res.status(400).json({ 
            error: 'Data de expiração deve ser no futuro' 
          });
        }
        dadosAtualizacao.data_expiracao = dataExpiracao;
      } else {
        dadosAtualizacao.data_expiracao = null;
      }
    }

    // Atualizar pesquisa
    const { data: pesquisaAtualizada, error: updateError } = await supabase
      .from('pesquisas')
      .update(dadosAtualizacao)
      .eq('id', id)
      .select()
      .single();

    if (updateError) {
      console.error('Erro ao atualizar pesquisa:', updateError);
      return res.status(500).json({ error: 'Erro ao atualizar pesquisa' });
    }

    res.json({
      success: true,
      message: 'Pesquisa atualizada com sucesso',
      data: pesquisaAtualizada
    });
  } catch (error) {
    console.error('Erro ao atualizar pesquisa:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Deletar pesquisa (apenas admin)
router.delete('/:id', authenticateUser, async (req, res) => {
  try {
    // Verificar se é admin
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Acesso negado. Apenas administradores podem deletar pesquisas.' });
    }

    const { id } = req.params;

    // Verificar se a pesquisa existe
    const { data: pesquisa, error: pesquisaError } = await supabase
      .from('pesquisas')
      .select('*')
      .eq('id', id)
      .single();

    if (pesquisaError || !pesquisa) {
      return res.status(404).json({ error: 'Pesquisa não encontrada' });
    }

    // Deletar pesquisa (cascade irá deletar votos e comentários relacionados)
    const { error: deleteError } = await supabase
      .from('pesquisas')
      .delete()
      .eq('id', id);

    if (deleteError) {
      console.error('Erro ao deletar pesquisa:', deleteError);
      return res.status(500).json({ error: 'Erro ao deletar pesquisa' });
    }

    res.json({
      success: true,
      message: 'Pesquisa deletada com sucesso'
    });
  } catch (error) {
    console.error('Erro ao deletar pesquisa:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Obter comentários de uma pesquisa
router.get('/:id/comments', async (req, res) => {
  try {
    const { id } = req.params;
    const { limit = 20, offset = 0 } = req.query;

    // Verificar se a pesquisa existe e permite comentários
    const { data: pesquisa, error: pesquisaError } = await supabase
      .from('pesquisas')
      .select('allow_comments')
      .eq('id', id)
      .single();

    if (pesquisaError || !pesquisa) {
      return res.status(404).json({ error: 'Pesquisa não encontrada' });
    }

    if (!pesquisa.allow_comments) {
      return res.json({
        success: true,
        data: []
      });
    }

    // Buscar comentários
    const { data: comentarios, error: comentariosError } = await supabase
      .from('pesquisa_comentarios')
      .select(`
        id,
        comentario,
        likes_count,
        created_at,
        usuario_id
      `)
      .eq('pesquisa_id', id)
      .eq('is_approved', true)
      .is('parent_id', null) // Apenas comentários principais
      .order('created_at', { ascending: false })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

    if (comentariosError) {
      console.error('Erro ao buscar comentários:', comentariosError);
      return res.status(500).json({ error: 'Erro interno do servidor' });
    }

    res.json({
      success: true,
      data: comentarios
    });
  } catch (error) {
    console.error('Erro ao buscar comentários:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Adicionar comentário a uma pesquisa
router.post('/:id/comments', authenticateUser, async (req, res) => {
  try {
    const { id } = req.params;
    const { comentario, parent_id } = req.body;
    const userId = req.user.id;

    if (!comentario || comentario.trim().length === 0) {
      return res.status(400).json({ error: 'Comentário é obrigatório' });
    }

    if (comentario.length > 1000) {
      return res.status(400).json({ error: 'Comentário muito longo (máximo 1000 caracteres)' });
    }

    // Verificar se a pesquisa existe e permite comentários
    const { data: pesquisa, error: pesquisaError } = await supabase
      .from('pesquisas')
      .select('allow_comments, is_active')
      .eq('id', id)
      .single();

    if (pesquisaError || !pesquisa) {
      return res.status(404).json({ error: 'Pesquisa não encontrada' });
    }

    if (!pesquisa.allow_comments) {
      return res.status(403).json({ error: 'Comentários não permitidos nesta pesquisa' });
    }

    if (!pesquisa.is_active) {
      return res.status(403).json({ error: 'Não é possível comentar em pesquisa inativa' });
    }

    // Se é uma resposta, verificar se o comentário pai existe
    if (parent_id) {
      const { data: comentarioPai, error: comentarioPaiError } = await supabase
        .from('pesquisa_comentarios')
        .select('id')
        .eq('id', parent_id)
        .eq('pesquisa_id', id)
        .single();

      if (comentarioPaiError || !comentarioPai) {
        return res.status(404).json({ error: 'Comentário pai não encontrado' });
      }
    }

    // Criar comentário
    const { data: novoComentario, error: comentarioError } = await supabase
      .from('pesquisa_comentarios')
      .insert({
        pesquisa_id: id,
        usuario_id: userId,
        comentario: comentario.trim(),
        parent_id: parent_id || null
      })
      .select()
      .single();

    if (comentarioError) {
      console.error('Erro ao criar comentário:', comentarioError);
      return res.status(500).json({ error: 'Erro ao criar comentário' });
    }

    res.status(201).json({
      success: true,
      message: 'Comentário adicionado com sucesso',
      data: novoComentario
    });
  } catch (error) {
    console.error('Erro ao adicionar comentário:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Rota duplicada removida - já movida para antes de /:id

// Obter estatísticas gerais das pesquisas (rota antiga mantida para compatibilidade)
router.get('/stats/general', async (req, res) => {
  try {
    // Total de pesquisas ativas
    const { count: totalPesquisas, error: pesquisasError } = await supabase
      .from('pesquisas')
      .select('*', { count: 'exact', head: true })
      .eq('is_active', true);

    if (pesquisasError) {
      console.error('Erro ao contar pesquisas:', pesquisasError);
      return res.status(500).json({ error: 'Erro interno do servidor' });
    }

    // Total de votos
    const { count: totalVotos, error: votosError } = await supabase
      .from('votos')
      .select('*', { count: 'exact', head: true });

    if (votosError) {
      console.error('Erro ao contar votos:', votosError);
      return res.status(500).json({ error: 'Erro interno do servidor' });
    }

    // Pesquisas mais votadas (top 5)
    const { data: topPesquisas, error: topError } = await supabase
      .from('pesquisas')
      .select('id, titulo, total_votes')
      .eq('is_active', true)
      .order('total_votes', { ascending: false })
      .limit(5);

    if (topError) {
      console.error('Erro ao buscar top pesquisas:', topError);
      return res.status(500).json({ error: 'Erro interno do servidor' });
    }

    res.json({
      success: true,
      data: {
        total_pesquisas: totalPesquisas || 0,
        total_votos: totalVotos || 0,
        pesquisas_mais_votadas: topPesquisas || []
      }
    });
  } catch (error) {
    console.error('Erro ao buscar estatísticas:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Estatísticas de uma pesquisa específica
router.get('/:id/stats', async (req, res) => {
  try {
    const { id } = req.params;

    // Buscar informações da pesquisa
    const { data: pesquisa, error: pesquisaError } = await supabase
      .from('pesquisas')
      .select('id, titulo, total_votes, opcoes, created_at')
      .eq('id', id)
      .single();

    if (pesquisaError || !pesquisa) {
      return res.status(404).json({ error: 'Pesquisa não encontrada' });
    }

    // Buscar votos da pesquisa
    const { data: votos, error: votosError } = await supabase
      .from('votos')
      .select('opcao_id, created_at')
      .eq('pesquisa_id', id);

    if (votosError) {
      console.error('Erro ao buscar votos:', votosError);
      return res.status(500).json({ error: 'Erro ao buscar estatísticas' });
    }

    // Calcular estatísticas por opção
    const opcoes = pesquisa.opcoes || [];
    const estatisticasPorOpcao = opcoes.map(opcao => {
      const votosOpcao = votos?.filter(voto => voto.opcao_id === opcao.id) || [];
      return {
        opcao_id: opcao.id,
        opcao_texto: opcao.texto,
        total_votos: votosOpcao.length,
        percentual: pesquisa.total_votes > 0 ? ((votosOpcao.length / pesquisa.total_votes) * 100).toFixed(1) : '0.0'
      };
    });

    // Buscar participantes únicos
    const { data: participantesUnicos } = await supabase
      .from('votos')
      .select('usuario_id')
      .eq('pesquisa_id', id);

    const totalParticipantesUnicos = new Set(participantesUnicos?.map(p => p.usuario_id)).size;

    res.json({
      success: true,
      data: {
        pesquisa_id: pesquisa.id,
        titulo: pesquisa.titulo,
        total_votos: pesquisa.total_votes || 0,
        total_participantes_unicos: totalParticipantesUnicos,
        created_at: pesquisa.created_at,
        estatisticas_por_opcao: estatisticasPorOpcao
      }
    });
  } catch (error) {
    console.error('Erro ao buscar estatísticas da pesquisa:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

module.exports = router;