const express = require('express');
const { supabase } = require('../config/supabase');
const { authenticateUser, authenticateAdmin } = require('../middleware/auth');
const router = express.Router();

// Get all events
router.get('/', async (req, res) => {
  try {
    const { city, state, status, page = 1, limit = 20 } = req.query;

    const limitNum = parseInt(limit);
    const pageNum = parseInt(page);
    const fromIndex = (pageNum - 1) * limitNum;
    const toIndex = fromIndex + limitNum - 1;

    // Contagem total com filtros (head=true para não retornar dados)
    let countQuery = supabase
      .from('events')
      .select('*', { count: 'exact', head: true });

    if (city) countQuery = countQuery.eq('city', city);
    if (state) countQuery = countQuery.eq('state', state);
    if (status) countQuery = countQuery.eq('status', status);

    const { count, error: countError } = await countQuery;
    if (countError) {
      console.error('Count events error:', countError);
    }

    // Consulta paginada com ordenação segura
    let query = supabase
      .from('events')
      .select('*')
      .order('id', { ascending: false })
      .range(fromIndex, toIndex);

    if (city) query = query.eq('city', city);
    if (state) query = query.eq('state', state);
    if (status) query = query.eq('status', status);

    const { data: events, error } = await query;

    if (error) {
      console.error('Get events error:', error);
      return res.status(400).json({ error: error.message });
    }

    res.json({
      events: events || [],
      total: typeof count === 'number' ? count : (events?.length || 0),
      totalPages: typeof count === 'number' ? Math.ceil(count / limitNum) : 1,
      currentPage: pageNum
    });
  } catch (error) {
    console.error('Get events error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get nearby events
router.get('/nearby', authenticateUser, async (req, res) => {
  try {
    const { latitude, longitude, radius = 10 } = req.query;

    if (!latitude || !longitude) {
      return res.status(400).json({ error: 'Latitude and longitude are required' });
    }

    // For now, we'll use a simple city-based filter
    // In production, you'd use PostGIS or similar for geospatial queries
    const { data: userProfile } = await supabase
      .from('users')
      .select('city, state')
      .eq('id', req.user.id)
      .single();

    const { data: events, error } = await supabase
      .from('events')
      .select('*')
      .eq('city', userProfile?.city)
      .eq('status', 'active')
      .gte('date', new Date().toISOString())
      .order('date', { ascending: true })
      .limit(20);

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json({ events });
  } catch (error) {
    console.error('Get nearby events error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/events/map
 * Retorna eventos para exibição no mapa
 */
router.get('/map', async (req, res) => {
  try {
    const { city, state, dateFrom, dateTo } = req.query;
    
    let query = supabase
      .from('events')
      .select('id, title, description, latitude, longitude, city, state, current_participants, date, created_at')
      .order('date', { ascending: true });
    
    // Aplicar filtros se fornecidos
    if (city) {
      query = query.ilike('city', `%${city}%`);
    }
    
    if (state) {
      query = query.ilike('state', `%${state}%`);
    }
    
    if (dateFrom) {
      query = query.gte('date', dateFrom);
    }
    
    if (dateTo) {
      query = query.lte('date', dateTo);
    }
    
    const { data: events, error } = await query;
    
    if (error) {
      console.error('Erro ao buscar eventos:', error);
      return res.status(500).json({
        success: false,
        message: 'Erro interno do servidor',
        error: error.message
      });
    }
    
    // Transformar dados para o formato esperado pelo frontend
    const formattedEvents = events.map(event => ({
      id: event.id,
      title: event.title,
      description: event.description,
      latitude: event.latitude,
      longitude: event.longitude,
      city: event.city,
      state: event.state,
      confirmedCount: event.current_participants,
      date: event.date,
      createdAt: event.created_at
    }));
    
    res.json({
      success: true,
      data: formattedEvents,
      total: formattedEvents.length
    });
    
  } catch (error) {
    console.error('Erro no endpoint /api/events/map:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor',
      error: error.message
    });
  }
});

// Get active events (must be before /:id route)
router.get('/active', async (req, res) => {
  try {
    const { data: events, error } = await supabase
      .from('events')
      .select('*')
      .eq('status', 'ativo')
      .gte('start_date', new Date().toISOString())
      .order('start_date', { ascending: true })
      .limit(50);

    if (error) {
      console.error('Get active events error:', error);
      return res.status(400).json({ error: error.message });
    }

    res.json(events || []);
  } catch (error) {
    console.error('Get active events error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get event by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const { data: event, error } = await supabase
      .from('events')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      return res.status(404).json({ error: 'Event not found' });
    }

    // Get check-ins count
    const { count: checkinsCount } = await supabase
      .from('checkins')
      .select('*', { count: 'exact', head: true })
      .eq('event_id', id);

    res.json({ 
      event: {
        ...event,
        checkins_count: checkinsCount || 0
      }
    });
  } catch (error) {
    console.error('Get event error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create new event (admin only)
router.post('/', authenticateUser, authenticateAdmin, async (req, res) => {
  try {
    console.log('📝 Creating new event...');
    console.log('🔍 Request body:', JSON.stringify(req.body, null, 2));
    console.log('👤 User:', req.user.email, 'is_admin:', req.user.is_admin);
    
    // User is already verified as admin by authenticateAdmin middleware

    // Extrair dados do corpo da requisição
    const {
      title,
      description,
      event_type,
      category,
      start_date,
      end_date,
      location,
      address,
      city,
      state,
      country,
      max_participants,
      price,
      is_free,
      requires_approval,
      tags,
      secret_code,
      // Manter compatibilidade com estrutura antiga
      date,
      time
    } = req.body;

    // Converter start_date e end_date para date e time se necessário
    let eventDate = date;
    let eventTime = time;
    
    if (start_date && !date) {
      const startDateTime = new Date(start_date);
      eventDate = startDateTime.toISOString().split('T')[0];
      eventTime = startDateTime.toTimeString().split(' ')[0];
    }

    // Mapeamento de categorias do frontend para o banco de dados
    const categoryMapping = {
      'politica': 'outro',
      'economia': 'outro', 
      'cultura': 'outro',
      'educacao': 'workshop',
      'religiao': 'outro',
      'familia': 'reuniao',
      'palestra': 'palestra',
      'debate': 'debate',
      'manifestacao': 'manifestacao',
      'reuniao': 'reuniao',
      'workshop': 'workshop',
      'outro': 'outro'
    };
    
    // Mapear categoria do frontend para categoria do banco
    const mappedCategory = categoryMapping[category] || 'outro';
    console.log(`🏷️  Category mapping: '${category}' -> '${mappedCategory}'`);

    // Preparar dados para inserção (compatível com ambas estruturas)
    const eventData = {
      title,
      description,
      category: mappedCategory,
      location,
      city,
      state,
      max_participants: max_participants || null,
      secret_code: secret_code || Math.random().toString(36).substring(2, 8).toUpperCase(),
      status: 'ativo', // Corrigido para usar valor válido do enum
      created_by: req.user.id,
      // Campos obrigatórios da estrutura atual
      date: eventDate,
      time: eventTime
    };

    // Adicionar campos novos se existirem na tabela
    if (event_type) eventData.event_type = event_type;
    if (start_date) eventData.start_date = start_date;
    if (end_date) eventData.end_date = end_date;
    if (address) eventData.address = address;
    if (country) eventData.country = country;
    if (price !== undefined) eventData.price = price;
    if (is_free !== undefined) eventData.is_free = is_free;
    if (requires_approval !== undefined) eventData.requires_approval = requires_approval;
    if (tags) eventData.tags = tags;

    // Inserir evento no banco de dados
    console.log('💾 Inserting event data:', JSON.stringify(eventData, null, 2));
    
    const { data: event, error } = await supabase
      .from('events')
      .insert(eventData)
      .select()
      .single();

    if (error) {
      console.error('❌ Database error:', error);
      console.error('❌ Error details:', JSON.stringify(error, null, 2));
      return res.status(400).json({ error: error.message });
    }

    console.log('✅ Event created successfully:', event.id);
    res.status(201).json({ message: 'Event created successfully', event });
  } catch (error) {
    console.error('Create event error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update event (admin only)
router.put('/:id', authenticateUser, async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Acesso negado' });
    }

    const { id } = req.params;
    const updateData = { ...req.body, updated_at: new Date().toISOString() };

    const { data: event, error } = await supabase
      .from('events')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json({ message: 'Event updated successfully', event });
  } catch (error) {
    console.error('Update event error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete event (admin only)
router.delete('/:id', authenticateUser, async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Acesso negado' });
    }

    const { id } = req.params;

    const { error } = await supabase
      .from('events')
      .delete()
      .eq('id', id);

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json({ message: 'Event deleted successfully' });
  } catch (error) {
    console.error('Delete event error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get event statistics
router.get('/:id/stats', async (req, res) => {
  try {
    const { id } = req.params;

    // Get check-ins count
    const { count: checkinsCount } = await supabase
      .from('checkins')
      .select('*', { count: 'exact', head: true })
      .eq('event_id', id);

    // Get unique participants
    const { data: checkins } = await supabase
      .from('checkins')
      .select('user_id')
      .eq('event_id', id);

    const uniqueParticipants = new Set(checkins?.map(c => c.user_id)).size;

    res.json({
      total_checkins: checkinsCount || 0,
      unique_participants: uniqueParticipants,
    });
  } catch (error) {
    console.error('Get event stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;