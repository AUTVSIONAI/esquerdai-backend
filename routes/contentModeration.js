const express = require('express')
const { supabase } = require('../config/supabase')
const { authenticateUser } = require('../middleware/auth')
const router = express.Router()

// Middleware de autenticação para todas as rotas
router.use((req, res, next) => {
  console.log('📥 Content moderation route accessed:', req.method, req.path)
  next()
})
router.use(authenticateUser)

// Middleware para verificar se é admin
const requireAdmin = async (req, res, next) => {
  try {
    console.log('🔍 Checking admin status for user:', req.user.id)
    
    // Verificar se o usuário é admin usando o campo is_admin
    if (req.user.role !== 'admin') {
      console.log('❌ Access denied - user is_admin:', req.user.is_admin)
      return res.status(403).json({ error: 'Acesso negado' })
    }

    console.log('✅ Admin access granted')
    next()
  } catch (error) {
    console.error('Error checking admin role:', error)
    res.status(500).json({ error: 'Erro interno do servidor' })
  }
}

router.use(requireAdmin)

// GET /admin/content-moderation/pending - Buscar conteúdo pendente
router.get('/pending', async (req, res) => {
  try {
    const {
      type,
      contentType,
      category,
      priority,
      author,
      dateFrom,
      dateTo,
      page = 1,
      limit = 20
    } = req.query

    let query = supabase
      .from('content_moderation')
      .select(`
        id,
        title,
        created_at,
        author_id,
        status,
        content_type,
        priority,
        reports_count,
        users!content_moderation_author_id_fkey(username, subscription_plan)
      `)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })

    // Aplicar filtros
    if (contentType) {
      query = query.eq('content_type', contentType)
    }
    if (priority) {
      query = query.eq('priority', priority)
    }
    if (author) {
      query = query.ilike('users.username', `%${author}%`)
    }
    if (dateFrom) {
      query = query.gte('created_at', dateFrom)
    }
    if (dateTo) {
      query = query.lte('created_at', dateTo)
    }

    // Paginação
    const offset = (page - 1) * limit
    query = query.range(offset, offset + limit - 1)

    const { data: conversations, error, count } = await query

    if (error) {
      console.error('Error fetching pending content:', error)
      return res.status(500).json({ error: 'Erro ao buscar conteúdo pendente' })
    }

    // Buscar mensagens para cada conversa
    const contentWithMessages = await Promise.all(
      conversations.map(async (conv) => {
        const { data: messages } = await supabase
          .from('ai_messages')
          .select('content, role')
          .eq('conversation_id', conv.id)
          .order('created_at', { ascending: true })

        const lastUserMessage = messages?.find(m => m.role === 'user')?.content || ''
        const lastAiMessage = messages?.find(m => m.role === 'assistant')?.content || ''

        // Buscar reports
        const { data: reports, count: reportCount } = await supabase
          .from('content_reports')
          .select('*', { count: 'exact' })
          .eq('content_id', conv.id)
          .eq('content_type', 'conversation')

        return {
          id: conv.id,
          type: conv.content_type || 'ai_generated',
          contentType: conv.content_type || 'text',
          title: conv.title,
          content: lastAiMessage || lastUserMessage,
          author: conv.users?.username || 'Usuário',
          authorPlan: conv.users?.subscription_plan || 'gratuito',
          createdAt: conv.created_at,
          reportCount: reportCount || 0,
          priority: conv.priority || 'medium',
          category: 'general',
          aiTemplate: conv.ai_template,
          status: conv.status
        }
      })
    )

    res.json({
      content: contentWithMessages,
      total: count,
      page: parseInt(page),
      limit: parseInt(limit)
    })
  } catch (error) {
    console.error('Error in pending content route:', error)
    res.status(500).json({ error: 'Erro interno do servidor' })
  }
})

// GET /admin/content-moderation/approved - Buscar conteúdo aprovado
router.get('/approved', async (req, res) => {
  try {
    const {
      type,
      contentType,
      category,
      author,
      dateFrom,
      dateTo,
      page = 1,
      limit = 20
    } = req.query

    let query = supabase
      .from('content_moderation')
      .select(`
        id,
        title,
        created_at,
        author_id,
        status,
        content_type,
        priority,
        moderated_at,
        moderator_id,
        users!content_moderation_author_id_fkey(username, subscription_plan)
      `)
      .eq('status', 'approved')
      .order('moderated_at', { ascending: false })

    // Aplicar filtros similares ao pending
    if (contentType) query = query.eq('content_type', contentType)
    if (author) query = query.ilike('users.username', `%${author}%`)
    if (dateFrom) query = query.gte('created_at', dateFrom)
    if (dateTo) query = query.lte('created_at', dateTo)

    const offset = (page - 1) * limit
    query = query.range(offset, offset + limit - 1)

    const { data: conversations, error, count } = await query

    if (error) {
      console.error('Error fetching approved content:', error)
      return res.status(500).json({ error: 'Erro ao buscar conteúdo aprovado' })
    }

    const contentWithMessages = await Promise.all(
      conversations.map(async (conv) => {
        const { data: messages } = await supabase
          .from('ai_messages')
          .select('content, role')
          .eq('conversation_id', conv.id)
          .order('created_at', { ascending: true })

        const lastUserMessage = messages?.find(m => m.role === 'user')?.content || ''
        const lastAiMessage = messages?.find(m => m.role === 'assistant')?.content || ''

        return {
          id: conv.id,
          type: 'ai_generated',
          contentType: conv.content_type || 'text',
          title: conv.title || 'Conversa sem título',
          content: lastAiMessage || lastUserMessage || conv.content,
          author: conv.users?.username || 'Usuário',
          authorPlan: conv.users?.subscription_plan || 'gratuito',
          createdAt: conv.created_at,
          approvedAt: conv.moderated_at,
          approvedBy: conv.moderator_id,
          category: 'general',
          status: conv.status
        }
      })
    )

    res.json({
      content: contentWithMessages,
      total: count,
      page: parseInt(page),
      limit: parseInt(limit)
    })
  } catch (error) {
    console.error('Error in approved content route:', error)
    res.status(500).json({ error: 'Erro interno do servidor' })
  }
})

// GET /admin/content-moderation/rejected - Buscar conteúdo rejeitado
router.get('/rejected', async (req, res) => {
  try {
    const {
      type,
      contentType,
      category,
      author,
      dateFrom,
      dateTo,
      page = 1,
      limit = 20
    } = req.query

    let query = supabase
      .from('content_moderation')
      .select(`
        id,
        title,
        created_at,
        author_id,
        status,
        content_type,
        priority,
        moderated_at,
        moderator_id,
        reason,
        users!content_moderation_author_id_fkey(username, subscription_plan)
      `)
      .eq('status', 'rejected')
      .order('moderated_at', { ascending: false })

    // Aplicar filtros
    if (contentType) query = query.eq('content_type', contentType)
    if (author) query = query.ilike('users.username', `%${author}%`)
    if (dateFrom) query = query.gte('created_at', dateFrom)
    if (dateTo) query = query.lte('created_at', dateTo)

    const offset = (page - 1) * limit
    query = query.range(offset, offset + limit - 1)

    const { data: conversations, error, count } = await query

    if (error) {
      console.error('Error fetching rejected content:', error)
      return res.status(500).json({ error: 'Erro ao buscar conteúdo rejeitado' })
    }

    const contentWithMessages = await Promise.all(
      conversations.map(async (conv) => {
        const { data: messages } = await supabase
          .from('ai_messages')
          .select('content, role')
          .eq('conversation_id', conv.id)
          .order('created_at', { ascending: true })

        const lastUserMessage = messages?.find(m => m.role === 'user')?.content || ''
        const lastAiMessage = messages?.find(m => m.role === 'assistant')?.content || ''

        return {
          id: conv.id,
          type: conv.content_type || 'ai_generated',
          contentType: conv.content_type || 'text',
          title: conv.title,
          content: lastAiMessage || lastUserMessage,
          author: conv.users?.username || 'Usuário',
          authorPlan: conv.users?.subscription_plan || 'gratuito',
          createdAt: conv.created_at,
          rejectedAt: conv.moderated_at,
          rejectedBy: conv.moderator_id,
          rejectionReason: conv.reason,
          category: 'general',
          status: conv.status
        }
      })
    )

    res.json({
      content: contentWithMessages,
      total: count,
      page: parseInt(page),
      limit: parseInt(limit)
    })
  } catch (error) {
    console.error('Error in rejected content route:', error)
    res.status(500).json({ error: 'Erro interno do servidor' })
  }
})

// GET /admin/content-moderation/stats - Estatísticas de moderação
router.get('/stats', async (req, res) => {
  try {
    // Contar conteúdo por status
    const { data: pending, count: pendingCount } = await supabase
      .from('content_moderation')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending')

    const { data: approved, count: approvedCount } = await supabase
      .from('content_moderation')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'approved')

    const { data: rejected, count: rejectedCount } = await supabase
      .from('content_moderation')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'rejected')

    // Contar reports totais
    const { data: reports, count: totalReports } = await supabase
      .from('content_reports')
      .select('*', { count: 'exact', head: true })

    // Conteúdo moderado hoje
    const today = new Date().toISOString().split('T')[0]
    const { data: todayModerated, count: todayModeratedCount } = await supabase
      .from('content_moderation')
      .select('*', { count: 'exact', head: true })
      .gte('moderated_at', today)
      .in('status', ['approved', 'rejected'])

    // Calcular tempo médio de resposta (em horas)
    const { data: moderatedContent } = await supabase
      .from('content_moderation')
      .select('created_at, moderated_at')
      .not('moderated_at', 'is', null)
      .limit(100)
      .order('moderated_at', { ascending: false })

    let avgResponseTime = 0
    if (moderatedContent && moderatedContent.length > 0) {
      const totalTime = moderatedContent.reduce((sum, item) => {
        const created = new Date(item.created_at)
        const moderated = new Date(item.moderated_at)
        return sum + (moderated - created)
      }, 0)
      avgResponseTime = Math.round(totalTime / moderatedContent.length / (1000 * 60 * 60)) // em horas
    }

    res.json({
      pending: pendingCount || 0,
      approved: approvedCount || 0,
      rejected: rejectedCount || 0,
      totalReports: totalReports || 0,
      avgResponseTime,
      todayModerated: todayModeratedCount || 0
    })
  } catch (error) {
    console.error('Error fetching moderation stats:', error)
    res.status(500).json({ error: 'Erro ao buscar estatísticas de moderação' })
  }
})

// PATCH /admin/content-moderation/:id/approve - Aprovar conteúdo
router.patch('/:id/approve', async (req, res) => {
  try {
    const { id } = req.params
    const { reason } = req.body

    const { error } = await supabase
      .from('content_moderation')
      .update({
        status: 'approved',
        moderated_at: new Date().toISOString(),
        moderator_id: req.user.id,
        reason: reason
      })
      .eq('id', id)

    if (error) {
      console.error('Error approving content:', error)
      return res.status(500).json({ error: 'Erro ao aprovar conteúdo' })
    }

    res.json({ message: 'Conteúdo aprovado com sucesso' })
  } catch (error) {
    console.error('Error in approve content route:', error)
    res.status(500).json({ error: 'Erro interno do servidor' })
  }
})

// PATCH /admin/content-moderation/:id/reject - Rejeitar conteúdo
router.patch('/:id/reject', async (req, res) => {
  try {
    const { id } = req.params
    const { reason } = req.body

    if (!reason) {
      return res.status(400).json({ error: 'Motivo da rejeição é obrigatório' })
    }

    const { error } = await supabase
      .from('content_moderation')
      .update({
        status: 'rejected',
        moderated_at: new Date().toISOString(),
        moderator_id: req.user.id,
        reason: reason
      })
      .eq('id', id)

    if (error) {
      console.error('Error rejecting content:', error)
      return res.status(500).json({ error: 'Erro ao rejeitar conteúdo' })
    }

    res.json({ message: 'Conteúdo rejeitado com sucesso' })
  } catch (error) {
    console.error('Error in reject content route:', error)
    res.status(500).json({ error: 'Erro interno do servidor' })
  }
})

// DELETE /admin/content-moderation/:id - Deletar conteúdo
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params

    // Deletar mensagens primeiro
    await supabase
      .from('ai_messages')
      .delete()
      .eq('conversation_id', id)

    // Deletar reports
    await supabase
      .from('content_reports')
      .delete()
      .eq('content_id', id)
      .eq('content_type', 'conversation')

    // Deletar conteúdo
    const { error } = await supabase
      .from('content_moderation')
      .delete()
      .eq('id', id)

    if (error) {
      console.error('Error deleting content:', error)
      return res.status(500).json({ error: 'Erro ao deletar conteúdo' })
    }

    res.json({ message: 'Conteúdo deletado com sucesso' })
  } catch (error) {
    console.error('Error in delete content route:', error)
    res.status(500).json({ error: 'Erro interno do servidor' })
  }
})

// POST /admin/content-moderation/:id/report - Reportar conteúdo
router.post('/:id/report', async (req, res) => {
  try {
    const { id } = req.params
    const { reason } = req.body

    if (!reason) {
      return res.status(400).json({ error: 'Motivo do report é obrigatório' })
    }

    const { error } = await supabase
      .from('content_reports')
      .insert({
        content_id: id,
        content_type: 'conversation',
        reported_by: req.user.id,
        reason,
        created_at: new Date().toISOString()
      })

    if (error) {
      console.error('Error reporting content:', error)
      return res.status(500).json({ error: 'Erro ao reportar conteúdo' })
    }

    res.json({ message: 'Conteúdo reportado com sucesso' })
  } catch (error) {
    console.error('Error in report content route:', error)
    res.status(500).json({ error: 'Erro interno do servidor' })
  }
})

module.exports = router