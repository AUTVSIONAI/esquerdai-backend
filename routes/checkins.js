const express = require('express');
const { supabase } = require('../config/supabase');
const { authenticateUser } = require('../middleware/auth');
const router = express.Router();

// Check-in to an event with geographic validation
router.post('/geographic', authenticateUser, async (req, res) => {
  try {
    const { event_id, latitude, longitude } = req.body;
    const userId = req.user.id;

    // Validate required fields
    if (!event_id || !latitude || !longitude) {
      return res.status(400).json({ error: 'Event ID, latitude, and longitude are required' });
    }

    // Get event details
    const { data: event, error: eventError } = await supabase
      .from('events')
      .select('*')
      .eq('id', event_id)
      .single();

    if (eventError || !event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    // Check if event is active
    if (event.status !== 'active') {
      return res.status(400).json({ error: 'Event is not active' });
    }

    // Validate geographic proximity (100 meters)
    if (!event.latitude || !event.longitude) {
      return res.status(400).json({ error: 'Event location not available' });
    }

    const distance = calculateDistance(
      parseFloat(latitude),
      parseFloat(longitude),
      parseFloat(event.latitude),
      parseFloat(event.longitude)
    );

    const maxDistance = 0.1; // 100 meters in kilometers
    if (distance > maxDistance) {
      return res.status(400).json({ 
        error: 'You must be within 100 meters of the event location to check-in',
        distance: Math.round(distance * 1000), // distance in meters
        maxDistance: 100
      });
    }

    // Check if user already checked in
    const { data: existingCheckin } = await supabase
      .from('checkins')
      .select('*')
      .eq('user_id', userId)
      .eq('event_id', event_id)
      .single();

    if (existingCheckin) {
      return res.status(400).json({ error: 'Already checked in to this event' });
    }

    // Check event capacity
    const { count: currentCheckins } = await supabase
      .from('checkins')
      .select('*', { count: 'exact', head: true })
      .eq('event_id', event_id);

    if (event.max_participants && currentCheckins >= event.max_participants) {
      return res.status(400).json({ error: 'Event is at maximum capacity' });
    }

    // Create check-in record
    const { data: checkin, error: checkinError } = await supabase
      .from('checkins')
      .insert([
        {
          user_id: userId,
          event_id,
          latitude: parseFloat(latitude),
          longitude: parseFloat(longitude),
          checked_in_at: new Date().toISOString(),
        },
      ])
      .select()
      .single();

    if (checkinError) {
      return res.status(400).json({ error: checkinError.message });
    }

    // Award points for check-in
    const pointsAwarded = 15; // Extra points for geographic check-in
    const { error: geoPointsError } = await supabase
      .from('points')
      .insert([
        {
          user_id: userId,
          amount: pointsAwarded,
          source: 'geographic_checkin',
          description: `Check-in geográfico no evento: ${event.title}`,
          created_at: new Date().toISOString(),
        },
      ]);

    if (geoPointsError) {
      console.error('Error awarding geographic check-in points:', geoPointsError);
    }

    // Update user's total points
    const { data: currentPoints } = await supabase
      .from('users')
      .select('points')
      .eq('id', userId)
      .single();

    await supabase
      .from('users')
      .update({ points: (currentPoints?.points || 0) + pointsAwarded })
      .eq('id', userId);

    // Check for achievements
    await checkAchievements(userId);

    res.json({
      success: true,
      message: 'Geographic check-in successful',
      checkin,
      points_awarded: pointsAwarded,
      distance: Math.round(distance * 1000) // distance in meters
    });
  } catch (error) {
    console.error('Geographic check-in error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Check-in to an event
router.post('/', authenticateUser, async (req, res) => {
  try {
    const { event_id, secret_code, latitude, longitude } = req.body;
    const userId = req.user.id;

    // Validate required fields
    if (!event_id || !secret_code) {
      return res.status(400).json({ error: 'Event ID and secret code are required' });
    }

    // Get event details
    const { data: event, error: eventError } = await supabase
      .from('events')
      .select('*')
      .eq('id', event_id)
      .single();

    if (eventError || !event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    // Check if event is active
    if (event.status !== 'active') {
      return res.status(400).json({ error: 'Event is not active' });
    }

    // Verify secret code
    if (event.secret_code !== secret_code) {
      return res.status(400).json({ error: 'Invalid secret code' });
    }

    // Check if user already checked in
    const { data: existingCheckin } = await supabase
      .from('checkins')
      .select('*')
      .eq('user_id', userId)
      .eq('event_id', event_id)
      .single();

    if (existingCheckin) {
      return res.status(400).json({ error: 'Already checked in to this event' });
    }

    // Check event capacity
    const { count: currentCheckins } = await supabase
      .from('checkins')
      .select('*', { count: 'exact', head: true })
      .eq('event_id', event_id);

    if (event.max_participants && currentCheckins >= event.max_participants) {
      return res.status(400).json({ error: 'Event is at maximum capacity' });
    }

    // Create check-in record
    const { data: checkin, error: checkinError } = await supabase
      .from('checkins')
      .insert([
        {
          user_id: userId,
          event_id,
          latitude,
          longitude,
          checked_in_at: new Date().toISOString(),
        },
      ])
      .select()
      .single();

    if (checkinError) {
      return res.status(400).json({ error: checkinError.message });
    }

    // Award points for check-in
    const pointsAwarded = 10; // Base points for check-in
    const { error: pointsError } = await supabase
      .from('points')
      .insert([
        {
          user_id: userId,
          amount: pointsAwarded,
          source: 'checkin',
          category: 'checkin',
          description: `Check-in no evento: ${event.title}`,
          created_at: new Date().toISOString(),
        },
      ]);

    if (pointsError) {
      console.error('Error awarding points:', pointsError);
    }

    // Update user's total points
    const { data: currentUser } = await supabase
      .from('users')
      .select('points')
      .eq('id', userId)
      .single();

    await supabase
      .from('users')
      .update({ points: (currentUser?.points || 0) + pointsAwarded })
      .eq('id', userId);

    // Check for achievements
    await checkAchievements(userId);

    res.status(201).json({
      message: 'Check-in successful',
      checkin,
      points_awarded: pointsAwarded,
      event: {
        title: event.title,
        date: event.date,
        location: event.location,
      },
    });
  } catch (error) {
    console.error('Check-in error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get user's check-ins (alias for /my-checkins)
router.get('/user', authenticateUser, async (req, res) => {
  try {
    const { limit = 50, offset = 0 } = req.query;
    const userId = req.user.id;

    const { data: checkins, error } = await supabase
      .from('checkins')
      .select(`
        *,
        events (
          id,
          title,
          description,
          date,
          time,
          location,
          city,
          state
        )
      `)
      .eq('user_id', userId)
      .order('checked_in_at', { ascending: false })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json({ checkins });
  } catch (error) {
    console.error('Get user checkins error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get user's check-ins
router.get('/my-checkins', authenticateUser, async (req, res) => {
  try {
    const { limit = 50, offset = 0 } = req.query;
    const userId = req.user.id;

    const { data: checkins, error } = await supabase
      .from('checkins')
      .select(`
        *,
        events (
          id,
          title,
          description,
          date,
          time,
          location,
          city,
          state
        )
      `)
      .eq('user_id', userId)
      .order('checked_in_at', { ascending: false })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json({ checkins });
  } catch (error) {
    console.error('Get checkins error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get check-ins for an event (admin only)
router.get('/event/:eventId', authenticateUser, async (req, res) => {
  try {
    // Check if user is admin
    const { data: userProfile } = await supabase
      .from('users')
      .select('is_admin')
      .eq('id', req.user.id)
      .single();

    if (userProfile?.is_admin !== true) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { eventId } = req.params;
    const { limit = 100, offset = 0 } = req.query;

    const { data: checkins, error } = await supabase
      .from('checkins')
      .select(`
        *,
        users (
          id,
          username,
          full_name,
          email,
          city,
          state
        )
      `)
      .eq('event_id', eventId)
      .order('checked_in_at', { ascending: false })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json({ checkins });
  } catch (error) {
    console.error('Get event checkins error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get check-in statistics
router.get('/stats', authenticateUser, async (req, res) => {
  try {
    const userId = req.user.id;

    // Total check-ins
    const { count: totalCheckins } = await supabase
      .from('checkins')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    // Check-ins this month
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const { count: monthlyCheckins } = await supabase
      .from('checkins')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('checked_in_at', startOfMonth.toISOString());

    // Check-ins this week
    const startOfWeek = new Date();
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
    startOfWeek.setHours(0, 0, 0, 0);

    const { count: weeklyCheckins } = await supabase
      .from('checkins')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('checked_in_at', startOfWeek.toISOString());

    // Unique events
    const { data: checkins } = await supabase
      .from('checkins')
      .select('event_id')
      .eq('user_id', userId);

    const uniqueEvents = new Set(checkins?.map(c => c.event_id)).size;

    res.json({
      total_checkins: totalCheckins || 0,
      monthly_checkins: monthlyCheckins || 0,
      weekly_checkins: weeklyCheckins || 0,
      unique_events: uniqueEvents,
    });
  } catch (error) {
    console.error('Get checkin stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Helper function to check and award achievements
async function checkAchievements(userId) {
  try {
    // Get user's check-in count
    const { count: checkinCount } = await supabase
      .from('checkins')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    // Check for first check-in achievement
    if (checkinCount === 1) {
      const { data: existingBadge } = await supabase
        .from('badges')
        .select('*')
        .eq('user_id', userId)
        .eq('achievement_id', 'first_checkin')
        .single();

      if (!existingBadge) {
        await supabase
          .from('badges')
          .insert([
            {
              user_id: userId,
              achievement_id: 'first_checkin',
              earned_at: new Date().toISOString(),
            },
          ]);

        // Award bonus points
        await supabase
          .from('points')
          .insert([
            {
              user_id: userId,
              amount: 50,
              source: 'achievement',
              description: 'Conquista: Primeiro Check-in',
              created_at: new Date().toISOString(),
            },
          ]);
      }
    }

    // Check for multiple check-ins achievements
    const milestones = [5, 10, 25, 50, 100];
    for (const milestone of milestones) {
      if (checkinCount === milestone) {
        const achievementId = `checkin_${milestone}`;
        const { data: existingBadge } = await supabase
          .from('badges')
          .select('*')
          .eq('user_id', userId)
          .eq('achievement_id', achievementId)
          .single();

        if (!existingBadge) {
          await supabase
            .from('badges')
            .insert([
              {
                user_id: userId,
                achievement_id: achievementId,
                earned_at: new Date().toISOString(),
              },
            ]);

          // Award bonus points based on milestone
          const bonusPoints = milestone * 10;
          await supabase
            .from('points')
            .insert([
              {
                user_id: userId,
                amount: bonusPoints,
                source: 'achievement',
                description: `Conquista: ${milestone} Check-ins`,
                created_at: new Date().toISOString(),
              },
            ]);
        }
      }
    }
  } catch (error) {
    console.error('Error checking achievements:', error);
  }
}

/**
 * GET /api/checkins/map
 * Retorna check-ins agregados por localização para exibição no mapa como heatmap
 */
router.get('/map', async (req, res) => {
  try {
    const { city, state, dateFrom, dateTo } = req.query;
    
    let query = supabase
      .from('checkins')
      .select('checked_in_at, events(latitude, longitude, city, state)')
      .not('events.latitude', 'is', null)
      .not('events.longitude', 'is', null)
      .order('checked_in_at', { ascending: false });
    
    // Aplicar filtros de data se fornecidos
    if (dateFrom) {
      query = query.gte('checked_in_at', dateFrom);
    }

    if (dateTo) {
      query = query.lte('checked_in_at', dateTo);
    }

    // Aplicar filtros de localização se fornecidos
    if (city) {
      query = query.ilike('events.city', `%${city}%`);
    }

    if (state) {
      query = query.ilike('events.state', `%${state}%`);
    }
    
    const { data: checkins, error } = await query;
    
    if (error) {
      console.error('Erro ao buscar check-ins:', error);
      const msg = String(error.message || '');
      // Se a tabela não existir, retornar sucesso com dados vazios
      if (msg.includes('Could not find the table') || msg.toLowerCase().includes('relation') || msg.toLowerCase().includes('does not exist')) {
        return res.json({
          success: true,
          data: [],
          total: 0
        });
      }
      return res.status(500).json({
        success: false,
        message: 'Erro interno do servidor',
        error: error.message
      });
    }
    
    // Agrupar check-ins por coordenadas próximas (para otimizar o heatmap)
    const aggregatedCheckins = aggregateNearbyCheckins(checkins);
    
    res.json({
      success: true,
      data: aggregatedCheckins,
      total: aggregatedCheckins.length
    });
    
  } catch (error) {
    console.error('Erro no endpoint /api/checkins/map:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor',
      error: error.message
    });
  }
});

/**
 * Função para agregar check-ins próximos
 * Agrupa check-ins que estão dentro de um raio de ~100 metros
 */
function aggregateNearbyCheckins(checkins) {
  const aggregated = [];
  const processed = new Set();
  const DISTANCE_THRESHOLD = 0.001; // Aproximadamente 100 metros
  
  // Filtrar checkins que têm dados de eventos válidos
  const validCheckins = checkins.filter(checkin => 
    checkin.events && 
    checkin.events.latitude && 
    checkin.events.longitude
  );
  
  validCheckins.forEach((checkin, index) => {
    if (processed.has(index)) return;
    
    const cluster = {
      latitude: checkin.events.latitude,
      longitude: checkin.events.longitude,
      count: 1,
      dates: [checkin.checked_in_at],
      city: checkin.events.city,
      state: checkin.events.state
    };
    
    // Encontrar check-ins próximos
    validCheckins.forEach((otherCheckin, otherIndex) => {
      if (index === otherIndex || processed.has(otherIndex)) return;
      
      const distance = calculateDistance(
        checkin.events.latitude,
        checkin.events.longitude,
        otherCheckin.events.latitude,
        otherCheckin.events.longitude
      );
      
      if (distance <= DISTANCE_THRESHOLD) {
        cluster.count++;
        cluster.dates.push(otherCheckin.checked_in_at);
        processed.add(otherIndex);
      }
    });
    
    processed.add(index);
    aggregated.push(cluster);
  });
  
  return aggregated;
}

/**
 * Calcula a distância entre duas coordenadas usando a fórmula de Haversine
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Raio da Terra em km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c; // Distância em km
}

// Get recent checkins
router.get('/recent', async (req, res) => {
  try {
    const { data: checkins, error } = await supabase
      .from('checkins')
      .select(`
        *,
        users:user_id(id, username, full_name),
        events:event_id(id, title, city, state)
      `)
      .order('checked_in_at', { ascending: false })
      .limit(100);

    if (error) {
      console.error('Get recent checkins error:', error);
      return res.status(400).json({ error: error.message });
    }

    res.json(checkins || []);
  } catch (error) {
    console.error('Get recent checkins error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Helper function to calculate distance between two coordinates using Haversine formula
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth's radius in kilometers
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  const distance = R * c; // Distance in kilometers
  return distance;
}

module.exports = router;