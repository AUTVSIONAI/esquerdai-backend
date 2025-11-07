const express = require('express');
const { authenticateUser, authenticateAdmin } = require('../middleware/auth');
const { supabase } = require('../config/supabase');
const router = express.Router();

// Usar supabase global
const getSupabase = () => global.supabase || {
  from: () => ({
    select: () => Promise.resolve({ data: [], error: null }),
    insert: () => Promise.resolve({ data: null, error: { message: 'Supabase não disponível' } }),
    update: () => Promise.resolve({ data: null, error: { message: 'Supabase não disponível' } }),
    delete: () => Promise.resolve({ data: null, error: { message: 'Supabase não disponível' } })
  })
};

// Dashboard overview statistics
router.get('/overview', authenticateUser, authenticateAdmin, async (req, res) => {
  try {
    // Get user statistics
    const supabase = getSupabase();
    const { data: userStats } = await supabase
      .from('users')
      .select('plan, created_at')
      .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());
    
    const _legacyActiveUsers = userStats?.length || 0;
    const _legacyNewUsersThisMonth = userStats?.filter(u => 
    new Date(u.created_at) > new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    ).length || 0;
    const { data: usersData } = await supabase
      .from('users')
      .select('id, created_at, last_login');

    const now = Date.now();
    const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
    const startOfMonthDate = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const startOfMonthTs = startOfMonthDate.getTime();

    let activeUsers = 0;
    let newUsersThisMonth = 0;

    (usersData || []).forEach(u => {
      const createdTs = u.created_at ? new Date(u.created_at).getTime() : 0;
      const lastLoginTs = u.last_login ? new Date(u.last_login).getTime() : 0;

      if (lastLoginTs && (now - lastLoginTs) <= THIRTY_DAYS) activeUsers++;
      if (createdTs && createdTs >= startOfMonthTs) newUsersThisMonth++;
    });

    // Get check-in statistics
    const { data: checkinStats } = await supabase
      .from('checkins')
      .select('created_at')
      .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

    const checkinsToday = checkinStats?.length || 0;

    // Get event statistics
    const { data: eventStats } = await supabase
      .from('events')
      .select('status, created_at')
      .eq('status', 'active');

    const activeEvents = eventStats?.length || 0;

    // Get revenue statistics (mock data for now)
    const revenueLegacy = {
      today: 1250.00,
      thisMonth: 15750.00,
      growth: 12.5
    };
    // Get revenue statistics (real data)
    let revenue = { today: 0, thisMonth: 0, growth: 0 };
    try {
      const startOfMonthIso = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
      const { data: orders } = await supabase
        .from('orders')
        .select('total_amount, status, created_at')
        .gte('created_at', startOfMonthIso);
      const nowRevenue = Date.now();
      const DAY_MS = 24 * 60 * 60 * 1000;
      let monthSum = 0;
      let todaySum = 0;
      (orders || []).forEach(o => {
        const amt = Number(o.total_amount) || 0;
        monthSum += amt;
        const ts = o.created_at ? new Date(o.created_at).getTime() : 0;
        if (ts && nowRevenue - ts <= DAY_MS) todaySum += amt;
      });
      revenue.thisMonth = Number(monthSum.toFixed(2));
      revenue.today = Number(todaySum.toFixed(2));
    } catch (_) {}

    // Get AI conversation statistics
    const { data: aiStats } = await supabase
      .from('ai_conversations')
      .select('created_at')
      .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

    const aiConversationsToday = aiStats?.length || 0;

    // Get moderation statistics
    const { data: moderationStats } = await supabase
      .from('content_moderation')
      .select('status')
      .eq('status', 'pending');

    const pendingModeration = moderationStats?.length || 0;

    // Get recent events
    const { data: recentEvents } = await supabase
      .from('events')
      .select('id, title, location, city, state, current_participants, status, created_at')
      .order('id', { ascending: false })
      .limit(5);

    // Get top cities by user count
    const { data: topCities } = await supabase
      .from('users')
      .select('city, state')
      .not('city', 'is', null)
      .neq('city', '')
      .limit(1000);

    // Count users by city
    const cityStats = {};
    topCities?.forEach(user => {
      const key = `${user.city}, ${user.state}`;
      cityStats[key] = (cityStats[key] || 0) + 1;
    });

    const topCitiesFormatted = Object.entries(cityStats)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 5)
      .map(([cityState, count]) => {
        const [city, state] = cityState.split(', ');
        return { city, state, users: count, growth: '+0%' };
      });

    // Get recent activities (simplified)
    const recentActivities = [
      {
        id: 1,
        type: 'user_join',
        message: `${newUsersThisMonth} novos usuários se registraram este mês`,
        time: 'hoje'
      },
      {
        id: 2,
        type: 'event_checkin',
        message: `${checkinsToday} check-ins realizados hoje`,
        time: 'hoje'
      },
      {
        id: 3,
        type: 'ai_conversation',
        message: `${aiConversationsToday} conversas com IA iniciadas hoje`,
        time: 'hoje'
      }
    ];

    res.json({
      statistics: {
        activeUsers,
        newUsersThisMonth,
        checkinsToday,
        activeEvents,
        revenue,
        aiConversationsToday,
        pendingModeration
      },
      recentEvents: recentEvents || [],
      topCities: topCitiesFormatted,
      recentActivities,
      systemHealth: {
        database: 'healthy',
        api: 'healthy',
        storage: 'healthy',
        uptime: '99.9%'
      }
    });
  } catch (error) {
    console.error('Admin overview error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// User management
router.get('/users', authenticateUser, authenticateAdmin, async (req, res) => {
  try {
    const { plan, status, search, limit = 200, offset = 0 } = req.query;

    let query = supabase
      .from('users')
      .select('*')
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

    if (plan && plan !== 'all') {
      query = query.eq('plan', plan);
    }

    if (status && status !== 'all') {
      query = query.eq('status', status);
    }

    if (search) {
      query = query.or(`email.ilike.%${search}%,username.ilike.%${search}%,full_name.ilike.%${search}%`);
    }

    const { data: users, error } = await query;

    // Fallback para listar usuários do auth quando tabela users não existe ou está vazia
    const fallbackListAuthUsers = async () => {
      try {
        const perPage = 200;
        let page = 1;
        let all = [];
        let keepGoing = true;
        while (keepGoing) {
          const { data: adminList, error: adminError } = await supabase.auth.admin.listUsers({ page, perPage });
          if (adminError) {
            console.error('Auth admin listUsers error:', adminError.message || adminError);
            break;
          }
          const usersPage = (adminList?.users || []);
          const mappedPage = usersPage.map(u => {
            const role = (u.app_metadata?.role) || (u.user_metadata?.role) || 'user';
            return {
              id: u.id,
              email: u.email,
              username: u.user_metadata?.username || (u.email ? u.email.split('@')[0] : null),
              full_name: u.user_metadata?.full_name || (u.email ? u.email.split('@')[0] : null),
              plan: 'gratuito',
              role,
              is_admin: role === 'admin',
              created_at: u.created_at,
              last_login: u.last_sign_in_at,
              points: 0,
              city: u.user_metadata?.city || null,
              state: u.user_metadata?.state || null,
              status: 'active',
              stats: { checkins: 0, conversations: 0 }
            };
          });
          all = all.concat(mappedPage);
          if (usersPage.length < perPage) {
            keepGoing = false;
          } else {
            page += 1;
          }
        }
        // Aplicar filtros
        let filtered = all;
        if (search) {
          const s = String(search).toLowerCase();
          filtered = filtered.filter(x =>
            (x.email || '').toLowerCase().includes(s) ||
            (x.username || '').toLowerCase().includes(s) ||
            (x.full_name || '').toLowerCase().includes(s)
          );
        }
        if (plan && plan !== 'all') {
          filtered = filtered.filter(x => String(x.plan).toLowerCase() === String(plan).toLowerCase());
        }
        if (status && status !== 'all') {
          filtered = filtered.filter(x => String(x.status).toLowerCase() === String(status).toLowerCase());
        }
        const start = parseInt(offset) || 0;
        const lim = parseInt(limit) || 200;
        const sliced = filtered.slice(start, start + lim);
        return sliced;
      } catch (adminErr) {
        console.error('Auth admin fallback error:', adminErr?.message || adminErr);
        return [];
      }
    };

    // Preferir listagem via Auth users
    const authUsers = await fallbackListAuthUsers();
    return res.json({ users: authUsers });

    if (error) {
      const msg = String(error.message || '').toLowerCase();
      // Se a tabela não existir, usar fallback do auth
      if (msg.includes('could not find the table') || msg.includes('relation') || msg.includes('does not exist')) {
        const authUsers = await fallbackListAuthUsers();
        return res.json({ users: authUsers });
      }
      return res.status(400).json({ error: error.message });
    }

    // Se não há usuários, tentar buscar do auth como fallback
    if (!users || users.length === 0) {
      const authUsers = await fallbackListAuthUsers();
      return res.json({ users: authUsers });
    }

    // Get additional statistics for each user (com fallback quando tabelas não existem)
    const usersWithStats = await Promise.all(
      (users || []).map(async (user) => {
        let checkinsCount = 0;
        let conversationsCount = 0;
        try {
          const { data: checkinsData } = await supabase
            .from('checkins')
            .select('id')
            .eq('user_id', user.id);
          checkinsCount = checkinsData?.length || 0;
        } catch (_) {}
        try {
          const { data: convData } = await supabase
            .from('ai_conversations')
            .select('id')
            .eq('user_id', user.id);
          conversationsCount = convData?.length || 0;
        } catch (_) {}

        return {
          ...user,
          stats: {
            checkins: checkinsCount,
            conversations: conversationsCount
          }
        };
      })
    );

    res.json({ users: usersWithStats });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Sync auth.users into public.users (bulk)
router.post('/users/sync-auth', authenticateUser, authenticateAdmin, async (req, res) => {
  try {
    const perPage = parseInt((req.body && req.body.perPage) || 200);
    let page = 1;
    let totalSynced = 0;
    let finished = false;

    while (!finished) {
      const { data: adminList, error: adminErr } = await supabase.auth.admin.listUsers({ page, perPage });
      if (adminErr) {
        return res.status(400).json({ error: adminErr.message || String(adminErr) });
      }
      const users = (adminList && adminList.users) || [];
      if (users.length === 0) {
        finished = true;
        break;
      }

      for (const u of users) {
        const email = u.email;
        const payload = {
          email,
          full_name: (u.user_metadata && u.user_metadata.full_name) || (email ? email.split('@')[0] : null),
          username: (u.user_metadata && u.user_metadata.username) || (email ? email.split('@')[0] : null),
          city: (u.user_metadata && u.user_metadata.city) || null,
          state: (u.user_metadata && u.user_metadata.state) || null,
          plan: 'gratuito',
          role: (u.app_metadata && u.app_metadata.role) || (u.user_metadata && u.user_metadata.role) || 'user',
          points: 0,
          status: 'active',
          auth_id: u.id,
          last_login: u.last_sign_in_at,
          created_at: u.created_at,
          updated_at: new Date().toISOString()
        };

        let synced = false;

        // Try upsert by auth_id
        const { data: up1, error: up1Err } = await supabase
          .from('users')
          .upsert(payload, { onConflict: 'auth_id' })
          .select()
          .single();
        if (!up1Err && up1) {
          synced = true;
        } else {
          // Try upsert by email
          const { data: up2, error: up2Err } = await supabase
            .from('users')
            .upsert(payload, { onConflict: 'email' })
            .select()
            .single();
          if (!up2Err && up2) {
            synced = true;
          } else {
            // Try insert
            const { data: ins, error: insErr } = await supabase
              .from('users')
              .insert([payload])
              .select()
              .single();
            if (!insErr && ins) {
              synced = true;
            } else {
              // Try fetch existing
              const { data: byAuth } = await supabase
                .from('users')
                .select('*')
                .eq('auth_id', u.id)
                .single();
              if (byAuth) synced = true;
              else {
                const { data: byEmail } = await supabase
                  .from('users')
                  .select('*')
                  .eq('email', email)
                  .single();
                if (byEmail) synced = true;
              }
            }
          }
        }

        if (synced) totalSynced += 1;
      }

      if (users.length < perPage) {
        finished = true;
      } else {
        page += 1;
      }
    }

    res.json({ message: 'Sync complete', synced: totalSynced });
  } catch (err) {
    console.error('Sync auth->public error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Sync a single user by email from auth.users into public.users
router.post('/users/sync-auth-one', authenticateUser, authenticateAdmin, async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ error: 'email is required' });

    // Iterate admin list to find the user by email
    const perPage = 200;
    let page = 1;
    let found = null;
    let finished = false;

    while (!finished && !found) {
      const { data: adminList, error: adminErr } = await supabase.auth.admin.listUsers({ page, perPage });
      if (adminErr) return res.status(400).json({ error: adminErr.message || String(adminErr) });
      const users = (adminList && adminList.users) || [];
      for (const u of users) {
        if (String(u.email || '').toLowerCase() === String(email).toLowerCase()) {
          found = u;
          break;
        }
      }
      if (found) break;
      if (users.length < perPage) finished = true;
      else page += 1;
    }

    if (!found) {
      return res.status(404).json({ error: 'Auth user not found for provided email' });
    }

    const payload = {
      email: found.email,
      full_name: (found.user_metadata && found.user_metadata.full_name) || (found.email ? found.email.split('@')[0] : null),
      username: (found.user_metadata && found.user_metadata.username) || (found.email ? found.email.split('@')[0] : null),
      city: (found.user_metadata && found.user_metadata.city) || null,
      state: (found.user_metadata && found.user_metadata.state) || null,
      plan: 'gratuito',
      role: (found.app_metadata && found.app_metadata.role) || (found.user_metadata && found.user_metadata.role) || 'user',
      points: 0,
      status: 'active',
      auth_id: found.id,
      last_login: found.last_sign_in_at,
      created_at: found.created_at,
      updated_at: new Date().toISOString()
    };

    let dbUser = null;

    const { data: up1, error: up1Err } = await supabase
      .from('users')
      .upsert(payload, { onConflict: 'auth_id' })
      .select()
      .single();
    if (!up1Err && up1) {
      dbUser = up1;
    } else {
      const { data: up2, error: up2Err } = await supabase
        .from('users')
        .upsert(payload, { onConflict: 'email' })
        .select()
        .single();
      if (!up2Err && up2) {
        dbUser = up2;
      } else {
        const { data: ins, error: insErr } = await supabase
          .from('users')
          .insert([payload])
          .select()
          .single();
        if (!insErr && ins) dbUser = ins;
        else {
          const { data: byAuth } = await supabase
            .from('users')
            .select('*')
            .eq('auth_id', found.id)
            .single();
          dbUser = byAuth || null;
          if (!dbUser) {
            const { data: byEmail } = await supabase
              .from('users')
              .select('*')
              .eq('email', found.email)
              .single();
            dbUser = byEmail || null;
          }
        }
      }
    }

    if (!dbUser) return res.status(400).json({ error: 'Failed to sync user into public.users' });
    res.json({ message: 'User synced', user: dbUser });
  } catch (err) {
    console.error('Sync single auth->public error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get user details
router.get('/users/:userId', authenticateUser, authenticateAdmin, async (req, res) => {
  try {
    const { userId } = req.params;

    // Resolve local user by id or auth_id (Supabase Auth UUID)
    let user = null;
    let localUserId = null;

    const { data: byId, error: byIdErr } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();

    if (!byIdErr && byId) {
      user = byId;
      localUserId = byId.id;
    } else {
      const { data: byAuth } = await supabase
        .from('users')
        .select('*')
        .eq('auth_id', userId)
        .single();
      if (byAuth) {
        user = byAuth;
        localUserId = byAuth.id;
      }
    }

    // If no local user, try hydrate from Supabase Auth
    if (!user) {
      try {
        const { data: authRes } = await supabase.auth.admin.getUserById(userId);
        const authUser = authRes?.user || null;
        if (authUser) {
          user = {
            id: authUser.id,
            auth_id: authUser.id,
            email: authUser.email,
            full_name: authUser.user_metadata?.full_name || (authUser.email ? authUser.email.split('@')[0] : null),
            username: authUser.user_metadata?.username || (authUser.email ? authUser.email.split('@')[0] : null),
            city: authUser.user_metadata?.city || null,
            state: authUser.user_metadata?.state || null,
            plan: authUser.user_metadata?.plan || 'gratuito',
            is_admin: Boolean(authUser.user_metadata?.is_admin),
            points: Number(authUser.user_metadata?.points || 0),
            created_at: authUser.created_at,
            last_login: authUser.last_sign_in_at,
            status: 'active',
            stats: { checkins: 0, conversations: 0 }
          };
          localUserId = null;
        }
      } catch (_) {}
    }

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // If no local id, return empty related lists
    let checkins = [];
    let conversations = [];
    let orders = [];
    let adminMeta = null;
    let roleName = null;

    if (localUserId) {
      const { data: userCheckins } = await supabase
        .from('checkins')
        .select(`
          *,
          events (
            title,
            location
          )
        `)
        .eq('user_id', localUserId)
        .order('created_at', { ascending: false })
        .limit(10);
      checkins = userCheckins || [];

      const { data: userConversations } = await supabase
        .from('ai_conversations')
        .select('*')
        .eq('user_id', localUserId)
        .order('created_at', { ascending: false })
        .limit(10);
      conversations = userConversations || [];

      const { data: userOrders } = await supabase
        .from('orders')
        .select('*')
        .eq('user_id', localUserId)
        .order('created_at', { ascending: false })
        .limit(10);
      orders = userOrders || [];

      try {
        const { data: meta } = await supabase
          .from('admin_users')
          .select('*')
          .eq('user_id', localUserId)
          .single();
        adminMeta = meta || null;
        if (adminMeta?.role_id) {
          const { data: roleRow } = await supabase
            .from('admin_roles')
            .select('name')
            .eq('id', adminMeta.role_id)
            .single();
          roleName = roleRow?.name || null;
        }
      } catch (_) {}
    }

    res.json({
      user,
      activity: {
        checkins,
        conversations,
        orders
      },
      role_id: adminMeta?.role_id || null,
      role: roleName,
      department: adminMeta?.department || null,
      permissions: adminMeta?.permissions || [],
      is_active: adminMeta?.is_active ?? false
    });
  } catch (error) {
    console.error('Get user details error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update user
router.put('/users/:userId', authenticateUser, authenticateAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const { 
      full_name, 
      username, 
      email, 
      city, 
      state, 
      plan, 
      is_admin, 
      points 
    } = req.body;

    const updateData = {
      updated_at: new Date().toISOString()
    };
    
    if (full_name !== undefined) updateData.full_name = full_name;
    if (username !== undefined) updateData.username = username;
    if (email !== undefined) updateData.email = email;
    if (city !== undefined) updateData.city = city;
    if (state !== undefined) updateData.state = state;
    if (plan !== undefined) updateData.plan = plan;
    if (is_admin !== undefined) updateData.is_admin = is_admin;
    if (points !== undefined) updateData.points = points;

    // Resolve column to update (local id or auth_id)
    let whereCol = 'id';
    let whereVal = userId;

    const { data: existsById } = await supabase
      .from('users')
      .select('id')
      .eq('id', userId)
      .single();

    if (!existsById) {
      const { data: existsByAuth } = await supabase
        .from('users')
        .select('id, auth_id')
        .eq('auth_id', userId)
        .single();
      if (existsByAuth) {
        whereCol = 'auth_id';
        whereVal = userId;
      } else {
        // No local record: try creating from Supabase Auth
        try {
          const { data: authRes } = await supabase.auth.admin.getUserById(userId);
          const authUser = authRes?.user || null;
          if (authUser) {
            const insertPayload = {
              auth_id: authUser.id,
              email: authUser.email,
              full_name: authUser.user_metadata?.full_name || (authUser.email ? authUser.email.split('@')[0] : null),
              username: authUser.user_metadata?.username || (authUser.email ? authUser.email.split('@')[0] : null),
              city: authUser.user_metadata?.city || null,
              state: authUser.user_metadata?.state || null,
              plan: authUser.user_metadata?.plan || 'gratuito',
              is_admin: Boolean(authUser.user_metadata?.is_admin),
              points: Number(authUser.user_metadata?.points || 0),
              created_at: authUser.created_at,
              last_login: authUser.last_sign_in_at,
              status: 'active',
              stats: { checkins: 0, conversations: 0 }
            };
            await supabase.from('users').upsert(insertPayload, { onConflict: 'auth_id' });
            whereCol = 'auth_id';
            whereVal = userId;
          }
        } catch (_) {}
      }
    }

    const { data: user, error } = await supabase
      .from('users')
      .update(updateData)
      .eq(whereCol, whereVal)
      .select()
      .single();

    if (error) {
      return res.status(400).json({ 
        error: error.message, 
        details: error.details || null, 
        code: error.code || null, 
        hint: error.hint || null 
      });
    }

    res.json({ user, message: 'User updated successfully' });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Ban/unban user
router.patch('/users/:userId/ban', authenticateUser, authenticateAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const { reason } = req.body;

    console.log(`🚫 Tentando banir usuário: ${userId}`);

    // Primeiro verificar se o usuário existe
    const { data: existingUser, error: checkError } = await supabase
      .from('users')
      .select('id, email, full_name')
      .eq('id', userId)
      .single();

    if (checkError || !existingUser) {
      console.log(`❌ Usuário não encontrado: ${userId}`);
      return res.status(404).json({ error: 'User not found' });
    }

    console.log(`✅ Usuário encontrado: ${existingUser.email}`);

    const { data: user, error } = await supabase
      .from('users')
      .update({ 
        banned: true,
        ban_reason: reason || 'Banido pelo administrador',
        banned_at: new Date().toISOString()
      })
      .eq('id', userId)
      .select()
      .single();

    if (error) {
      console.log(`❌ Erro ao banir usuário: ${error.message}`);
      return res.status(400).json({ error: error.message });
    }

    console.log(`✅ Usuário banido com sucesso: ${user.email}`);

    res.json({ 
      user, 
      message: 'User banned successfully'
    });
  } catch (error) {
    console.error('Ban user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete user
router.delete('/users/:userId', authenticateUser, authenticateAdmin, async (req, res) => {
  try {
    const { userId } = req.params;

    console.log(`🗑️ Tentando excluir usuário: ${userId}`);

    // Primeiro, verificar se o usuário existe
    const { data: existingUser, error: checkError } = await supabase
      .from('users')
      .select('id, email, full_name')
      .eq('id', userId)
      .single();

    if (checkError || !existingUser) {
      console.log(`❌ Usuário não encontrado para exclusão: ${userId}`);
      return res.status(404).json({ error: 'User not found' });
    }

    console.log(`✅ Usuário encontrado para exclusão: ${existingUser.email}`);

    // Deletar o usuário
    const { error } = await supabase
      .from('users')
      .delete()
      .eq('id', userId);

    if (error) {
      console.log(`❌ Erro ao excluir usuário: ${error.message}`);
      return res.status(400).json({ error: error.message });
    }

    console.log(`✅ Usuário excluído com sucesso: ${existingUser.email}`);

    res.json({ 
      message: 'User deleted successfully'
    });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Content moderation
router.get('/moderation', authenticateUser, authenticateAdmin, async (req, res) => {
  try {
    const { status = 'pending', category, limit = 50, offset = 0 } = req.query;

    let query = supabase
      .from('content_moderation')
      .select(`
        *,
        users (
          username,
          email,
          plan
        )
      `)
      .order('created_at', { ascending: false })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

    if (status) {
      query = query.eq('status', status);
    }

    if (category) {
      query = query.eq('category', category);
    }

    const { data: content, error } = await query;

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json({ content });
  } catch (error) {
    console.error('Get moderation content error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Moderate content
router.put('/moderation/:contentId', authenticateUser, authenticateAdmin, async (req, res) => {
  try {
    const { contentId } = req.params;
    const { action, reason } = req.body; // action: 'approve' or 'reject'

    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ error: 'Invalid action' });
    }

    const { data: content, error } = await supabase
      .from('content_moderation')
      .update({
        status: action === 'approve' ? 'approved' : 'rejected',
        moderated_by: req.user.id,
        moderated_at: new Date().toISOString(),
        moderation_reason: reason
      })
      .eq('id', contentId)
      .select()
      .single();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json({ 
      content, 
      message: `Content ${action}d successfully` 
    });
  } catch (error) {
    console.error('Moderate content error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Store management - Get all products
router.get('/store/products', authenticateUser, authenticateAdmin, async (req, res) => {
  try {
    const { category, status, search, limit = 50, offset = 0 } = req.query;

    let query = supabase
      .from('products')
      .select('*')
      .order('created_at', { ascending: false })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

    if (category) {
      query = query.eq('category', category);
    }

    if (status === 'active') {
      query = query.eq('active', true);
    } else if (status === 'inactive') {
      query = query.eq('active', false);
    }

    if (search) {
      query = query.or(`name.ilike.%${search}%,description.ilike.%${search}%`);
    }

    const { data: products, error } = await query;

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json({ products });
  } catch (error) {
    console.error('Get admin products error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create product
router.post('/store/products', authenticateUser, authenticateAdmin, async (req, res) => {
  try {
    const { name, description, price, category, stock, stock_quantity, image, status, active } = req.body;

    const rawName = typeof name === 'string' ? name.trim() : '';
    const rawCategory = typeof category === 'string' ? category.trim() : '';

    const normalizedPrice = typeof price === 'number'
      ? price
      : Number((price ?? '').toString().replace(/[^\d.,-]/g, '').replace(',', '.'));
    const parsedPrice = Number.isNaN(normalizedPrice) ? NaN : normalizedPrice;

    if (!rawName || Number.isNaN(parsedPrice) || !rawCategory) {
      return res.status(400).json({ error: 'Name, price, and category are required' });
    }

    const parsedStockInput = stock !== undefined ? stock : stock_quantity;
    const parsedStock = parsedStockInput !== undefined ? parseInt(parsedStockInput) : 0;

    const isActive = typeof active === 'boolean' ? active : (status ? status === 'active' : true);
    const computedStatus = status || ((parsedStock || 0) > 0 ? 'active' : 'out_of_stock');

    const { data: product, error } = await supabase
      .from('products')
      .insert([
        {
          name: rawName,
          description,
          price: parsedPrice,
          category: rawCategory,
          stock: Number.isNaN(parsedStock) ? 0 : parsedStock,
          status: computedStatus,
          active: isActive,
          image,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }
      ])
      .select()
      .single();

    if (error) {
      return res.status(400).json({ error: error.message, details: error.details || null, code: error.code || null, hint: error.hint || null });
    }

    res.status(201).json({ product, message: 'Product created successfully' });
  } catch (error) {
    console.error('Create product error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update product
router.put('/store/products/:productId', authenticateUser, authenticateAdmin, async (req, res) => {
  try {
    const { productId } = req.params;
    const { name, description, price, category, stock, stock_quantity, image, active, status } = req.body;

    const updateData = {};
    if (name !== undefined) updateData.name = typeof name === 'string' ? name.trim() : name;
    if (description !== undefined) updateData.description = description;
    if (price !== undefined) {
      const normalized = typeof price === 'number' ? price : Number((price ?? '').toString().replace(/[^\d.,-]/g, '').replace(',', '.'));
      if (!Number.isNaN(normalized)) updateData.price = normalized;
    }
    if (category !== undefined) updateData.category = category;

    if (stock !== undefined || stock_quantity !== undefined) {
      const s = stock !== undefined ? stock : stock_quantity;
      const parsed = parseInt(s);
      if (!Number.isNaN(parsed)) updateData.stock = parsed;
      updateData.status = parsed > 0 ? 'active' : 'out_of_stock';
    }

    if (image !== undefined) updateData.image = image;

    if (active !== undefined) {
      updateData.active = active;
    } else if (status !== undefined) {
      updateData.active = status === 'active';
      updateData.status = status;
    }

    updateData.updated_at = new Date().toISOString();

    const { data: product, error } = await supabase
      .from('products')
      .update(updateData)
      .eq('id', productId)
      .select()
      .single();

    if (error) {
      return res.status(400).json({ error: error.message, details: error.details || null, code: error.code || null, hint: error.hint || null });
    }

    res.json({ product, message: 'Product updated successfully' });
  } catch (error) {
    console.error('Update product error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete product
router.delete('/store/products/:productId', authenticateUser, authenticateAdmin, async (req, res) => {
  try {
    const { productId } = req.params;

    const { error } = await supabase
      .from('products')
      .delete()
      .eq('id', productId);

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json({ message: 'Product deleted successfully' });
  } catch (error) {
    console.error('Delete product error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all orders
router.get('/store/orders', authenticateUser, authenticateAdmin, async (req, res) => {
  try {
    const { status, search, limit = 50, offset = 0 } = req.query;

    let query = supabase
      .from('orders')
      .select(`
        *,
        users (
          username,
          email
        ),
        order_items (
          *
        )
      `)
      .order('created_at', { ascending: false })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

    if (status) {
      query = query.eq('status', status);
    }

    if (search) {
      query = query.or(`id.ilike.%${search}%`);
    }

    const { data: orders, error } = await query;

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json({ orders });
  } catch (error) {
    console.error('Get admin orders error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update order status
router.put('/store/orders/:orderId', authenticateUser, authenticateAdmin, async (req, res) => {
  try {
    const { orderId } = req.params;
    const { status, tracking_code } = req.body;

    const updateData = {};
    if (status) updateData.status = status;
    if (tracking_code) updateData.tracking_code = tracking_code;

    const { data: order, error } = await supabase
      .from('orders')
      .update(updateData)
      .eq('id', orderId)
      .select()
      .single();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json({ order, message: 'Order updated successfully' });
  } catch (error) {
    console.error('Update order error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Financial reports
router.get('/reports/financial', authenticateUser, authenticateAdmin, async (req, res) => {
  try {
    const { period = '30d' } = req.query;
    
    let startDate;
    switch (period) {
      case '7d':
        startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30d':
        startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        break;
      case '90d':
        startDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    }

    // Get orders for the period
    const { data: orders } = await supabase
      .from('orders')
      .select('total, created_at, status')
      .gte('created_at', startDate.toISOString())
      .eq('status', 'completed');

    const totalRevenue = orders?.reduce((sum, order) => sum + order.total, 0) || 0;
    const orderCount = orders?.length || 0;
    const averageOrderValue = orderCount > 0 ? totalRevenue / orderCount : 0;

    // Get subscription revenue (mock data)
    const subscriptionRevenue = {
      engajado: 15750.00,
      premium: 8900.00
    };

    // Get top products
    const { data: topProducts } = await supabase
      .from('order_items')
      .select(`
        product_name,
        quantity,
        price
      `)
      .gte('created_at', startDate.toISOString());

    const productSales = {};
    topProducts?.forEach(item => {
      if (!productSales[item.product_name]) {
        productSales[item.product_name] = {
          name: item.product_name,
          quantity: 0,
          revenue: 0
        };
      }
      productSales[item.product_name].quantity += item.quantity;
      productSales[item.product_name].revenue += item.price * item.quantity;
    });

    const topProductsList = Object.values(productSales)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);

    res.json({
      summary: {
        totalRevenue,
        orderCount,
        averageOrderValue,
        subscriptionRevenue
      },
      topProducts: topProductsList,
      period
    });
  } catch (error) {
    console.error('Financial reports error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// System settings
router.get('/settings', authenticateUser, authenticateAdmin, async (req, res) => {
  try {
    // Mock system settings
    const settings = {
      general: {
        siteName: 'DireitaAI',
        maintenanceMode: false,
        registrationEnabled: true,
        maxUsersPerEvent: 500
      },
      ai: {
        dailyLimitGratuito: 10,
        dailyLimitEngajado: 50,
        dailyLimitPremium: -1, // unlimited
        creativeAIEnabled: true
      },
      points: {
        checkinPoints: 10,
        purchasePointsRatio: 0.1, // 1 point per R$ 10
        referralPoints: 50
      },
      store: {
        freeShippingThreshold: 100,
        shippingCost: 15,
        taxRate: 0.08
      }
    };

    res.json({ settings });
  } catch (error) {
    console.error('Get settings error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update system settings
router.put('/settings', authenticateUser, authenticateAdmin, async (req, res) => {
  try {
    const { settings } = req.body;

    // In a real implementation, you would save these to a settings table
    // For now, we'll just return success
    res.json({ 
      settings, 
      message: 'Settings updated successfully' 
    });
  } catch (error) {
    console.error('Update settings error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// API logs
router.get('/logs', authenticateUser, authenticateAdmin, async (req, res) => {
  try {
    const { level, limit = 100, offset = 0 } = req.query;

    // Mock API logs data
    const logs = [
      {
        id: 1,
        timestamp: new Date().toISOString(),
        level: 'info',
        method: 'POST',
        endpoint: '/api/auth/login',
        status: 200,
        response_time: 145,
        user_id: 'user123',
        ip: '192.168.1.1'
      },
      {
        id: 2,
        timestamp: new Date(Date.now() - 60000).toISOString(),
        level: 'error',
        method: 'GET',
        endpoint: '/api/events/123',
        status: 404,
        response_time: 23,
        user_id: 'user456',
        ip: '192.168.1.2',
        error: 'Event not found'
      }
    ];

    const filteredLogs = level ? logs.filter(log => log.level === level) : logs;
    const paginatedLogs = filteredLogs.slice(offset, offset + limit);

    res.json({ logs: paginatedLogs });
  } catch (error) {
    console.error('Get logs error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create announcement
router.post('/announcements', authenticateUser, authenticateAdmin, async (req, res) => {
  try {
    const { title, content, type, target_audience } = req.body;

    if (!title || !content) {
      return res.status(400).json({ error: 'Title and content are required' });
    }

    const { data: announcement, error } = await supabase
      .from('announcements')
      .insert([
        {
          title,
          content,
          type: type || 'info',
          target_audience: target_audience || 'all',
          created_by: req.user.id,
          active: true,
          created_at: new Date().toISOString()
        }
      ])
      .select()
      .single();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.status(201).json({ announcement, message: 'Announcement created successfully' });
  } catch (error) {
    console.error('Create announcement error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get announcements
router.get('/announcements', authenticateUser, authenticateAdmin, async (req, res) => {
  try {
    const { active, limit = 50, offset = 0 } = req.query;

    let query = supabase
      .from('announcements')
      .select(`
        *,
        users (
          username
        )
      `)
      .order('created_at', { ascending: false })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

    if (active !== undefined) {
      query = query.eq('active', active === 'true');
    }

    const { data: announcements, error } = await query;

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json({ announcements });
  } catch (error) {
    console.error('Get announcements error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Live Map endpoints
router.get('/live-map/users', authenticateUser, authenticateAdmin, async (req, res) => {
  try {
    // Get users with location data using latitude/longitude columns if available
    const { data: users, error } = await supabase
      .from('users')
      .select(`
        id,
        username,
        email,
        plan,
        city,
        state,
        latitude,
        longitude,
        last_login
      `)
      .order('last_login', { ascending: false })
      .limit(100);

    if (error) {
      console.warn('Live map users query error:', error.message);
      return res.json({ users: [] });
    }

    const formattedUsers = (users || []).map((user) => {
      return {
        id: user.id,
        username: user.username || (user.email ? user.email.split('@')[0] : ''),
        location: {
          city: user.city,
          state: user.state,
          lat: user.latitude ?? null,
          lng: user.longitude ?? null
        },
        status: 'online',
        lastActivity: user.last_login,
        plan: user.plan || 'gratuito'
      };
    }).filter(u => u.location.lat != null && u.location.lng != null);

    res.json({ users: formattedUsers });
  } catch (error) {
    console.error('Live map users error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/live-map/events', authenticateUser, authenticateAdmin, async (req, res) => {
  try {
    // Get active events with location (latitude/longitude) and date
    const { data: activeEvents, error } = await supabase
      .from('events')
      .select(`
        id,
        title,
        description,
        city,
        state,
        latitude,
        longitude,
        date,
        status,
        current_participants
      `)
      .in('status', ['active', 'ativo'])
      .order('date', { ascending: true });

    if (error) {
      console.warn('Live map events query error:', error.message);
      return res.json({ events: [] });
    }

    const formattedEvents = (activeEvents || []).map((event) => ({
      id: event.id,
      title: event.title,
      location: {
        city: event.city,
        state: event.state,
        lat: event.latitude ?? null,
        lng: event.longitude ?? null
      },
      participants: event.current_participants || 0,
      status: event.status,
      startTime: event.date,
      endTime: null
    })).filter(e => e.location.lat != null && e.location.lng != null);

    res.json({ events: formattedEvents });
  } catch (error) {
    console.error('Live map events error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/live-map/stats', authenticateUser, authenticateAdmin, async (req, res) => {
  try {
    // Get statistics by city
    const { data: cityStats, error } = await supabase
      .rpc('get_city_statistics');

    if (error) {
      // If the RPC function doesn't exist, create basic stats
      const { data: users } = await supabase
        .from('users')
        .select('city, state')
        .not('city', 'is', null);

      const { data: events } = await supabase
        .from('events')
        .select('city, state')
        .not('city', 'is', null);

      const { data: checkins } = await supabase
        .from('checkins')
        .select('event_id, events(city, state)')
        .not('events.city', 'is', null);

      // Group by city
      const cityMap = new Map();
      
      users?.forEach(user => {
        const key = `${user.city}, ${user.state}`;
        if (!cityMap.has(key)) {
          cityMap.set(key, { city: user.city, state: user.state, users: 0, events: 0, checkins: 0 });
        }
        cityMap.get(key).users++;
      });

      events?.forEach(event => {
        const key = `${event.city}, ${event.state}`;
        if (!cityMap.has(key)) {
          cityMap.set(key, { city: event.city, state: event.state, users: 0, events: 0, checkins: 0 });
        }
        cityMap.get(key).events++;
      });

      checkins?.forEach(checkin => {
        if (checkin.events) {
          const key = `${checkin.events.city}, ${checkin.events.state}`;
          if (cityMap.has(key)) {
            cityMap.get(key).checkins++;
          }
        }
      });

      const formattedStats = Array.from(cityMap.values())
        .sort((a, b) => b.users - a.users)
        .slice(0, 10);

      return res.json({ stats: formattedStats });
    }

    res.json({ stats: cityStats });
  } catch (error) {
    console.error('Live map stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/live-map/realtime', authenticateUser, authenticateAdmin, async (req, res) => {
  try {
    // Get real-time statistics
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const today = new Date().toISOString().split('T')[0];

    // Online users count
    const { data: onlineUsersCount } = await supabase
      .from('users')
      .select('id', { count: 'exact' })
      .gte('last_login', thirtyMinutesAgo);

    // Active events count
    const { data: activeEventsCount } = await supabase
      .from('events')
      .select('id', { count: 'exact' })
      .eq('status', 'active');

    // Today's checkins count
    const { data: todayCheckinsCount } = await supabase
      .from('checkins')
      .select('id', { count: 'exact' })
      .gte('checked_in_at', today);

    res.json({
      onlineUsers: onlineUsersCount?.length || 0,
      activeEvents: activeEventsCount?.length || 0,
      totalCheckins: todayCheckinsCount?.length || 0,
      lastUpdate: new Date().toISOString()
    });
  } catch (error) {
    console.error('Live map realtime error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get city statistics
router.get('/city-stats', authenticateUser, authenticateAdmin, async (req, res) => {
  try {
    // Get user distribution by city
    const { data: usersByCity, error: usersError } = await supabase
      .from('users')
      .select('city, state')
      .not('city', 'is', null)
      .not('state', 'is', null);

    if (usersError) {
      console.error('Get users by city error:', usersError);
      return res.status(400).json({ error: usersError.message });
    }

    // Get events distribution by city
    const { data: eventsByCity, error: eventsError } = await supabase
      .from('events')
      .select('city, state')
      .not('city', 'is', null)
      .not('state', 'is', null);

    if (eventsError) {
      console.error('Get events by city error:', eventsError);
      return res.status(400).json({ error: eventsError.message });
    }

    // Aggregate statistics by city
    const cityStats = {};
    
    // Count users by city
    usersByCity?.forEach(user => {
      const key = `${user.city}, ${user.state}`;
      if (!cityStats[key]) {
        cityStats[key] = { city: user.city, state: user.state, users: 0, events: 0 };
      }
      cityStats[key].users++;
    });

    // Count events by city
    eventsByCity?.forEach(event => {
      const key = `${event.city}, ${event.state}`;
      if (!cityStats[key]) {
        cityStats[key] = { city: event.city, state: event.state, users: 0, events: 0 };
      }
      cityStats[key].events++;
    });

    // Convert to array and sort by total activity
    const statsArray = Object.values(cityStats)
      .map(stat => ({
        ...stat,
        total: stat.users + stat.events
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 20); // Top 20 cities

    res.json(statsArray);
  } catch (error) {
    console.error('Get city stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;

// Dashboard stats summary (resiliente)
router.get('/dashboard/stats', authenticateUser, authenticateAdmin, async (req, res) => {
  try {
    const safeLen = async (table) => {
      try {
        const { data } = await supabase.from(table).select('id');
        return data?.length || 0;
      } catch (_) {
        return 0;
      }
    };

    const [users, events, checkins, manifestations] = await Promise.all([
      safeLen('users'),
      safeLen('events'),
      safeLen('checkins'),
      safeLen('manifestations')
    ]);

    res.json({
      stats: {
        users,
        events,
        checkins,
        manifestations,
        lastUpdate: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Dashboard stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Permissions (temporary static list to support frontend)
router.get('/permissions', authenticateUser, authenticateAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('admin_permissions')
      .select('*')
      .order('resource', { ascending: true });

    if (!error && Array.isArray(data) && data.length) {
      return res.json(data);
    }

    const fallback = [
      { id: 'users.read', resource: 'users', action: 'read', description: 'Ler usuários' },
      { id: 'users.update', resource: 'users', action: 'update', description: 'Atualizar usuários' },
      { id: 'users.delete', resource: 'users', action: 'delete', description: 'Excluir usuários' },
      { id: 'events.create', resource: 'events', action: 'create', description: 'Criar eventos' },
      { id: 'events.manage', resource: 'events', action: 'manage', description: 'Gerenciar eventos' },
      { id: 'content.moderate', resource: 'content', action: 'moderate', description: 'Moderar conteúdo' },
      { id: 'analytics.read', resource: 'analytics', action: 'read', description: 'Ler análises' },
      { id: 'ai.manage', resource: 'ai', action: 'manage', description: 'Gerenciar IA' }
    ];
    res.json(fallback);
  } catch (error) {
    console.error('Get permissions error:', error);
    const fallback = [
      { id: 'users.read', resource: 'users', action: 'read', description: 'Ler usuários' },
      { id: 'users.update', resource: 'users', action: 'update', description: 'Atualizar usuários' },
      { id: 'users.delete', resource: 'users', action: 'delete', description: 'Excluir usuários' },
      { id: 'events.create', resource: 'events', action: 'create', description: 'Criar eventos' },
      { id: 'events.manage', resource: 'events', action: 'manage', description: 'Gerenciar eventos' },
      { id: 'content.moderate', resource: 'content', action: 'moderate', description: 'Moderar conteúdo' },
      { id: 'analytics.read', resource: 'analytics', action: 'read', description: 'Ler análises' },
      { id: 'ai.manage', resource: 'ai', action: 'manage', description: 'Gerenciar IA' }
    ];
    res.json(fallback);
  }
});
// Roles CRUD
router.get('/roles', authenticateUser, authenticateAdmin, async (req, res) => {
  try {
    const supabase = getSupabase();
    const { data: roles, error: rolesError } = await supabase
      .from('admin_roles')
      .select('*')
      .order('level', { ascending: true });
    if (rolesError) return res.status(400).json({ error: rolesError.message });

    const { data: mappings } = await supabase
      .from('admin_role_permissions')
      .select('*');
    const { data: perms } = await supabase
      .from('admin_permissions')
      .select('*');

    const permById = {};
    (perms || []).forEach(p => { permById[p.id] = p; });

    const result = (roles || []).map(r => ({
      ...r,
      permissions: (mappings || [])
        .filter(m => m.role_id === r.id)
        .map(m => permById[m.permission_id] || { id: m.permission_id })
    }));

    res.json(result);
  } catch (error) {
    console.error('Get roles error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/roles', authenticateUser, authenticateAdmin, async (req, res) => {
  try {
    const supabase = getSupabase();
    const { name, description, level = 1, permissions = [] } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name is required' });

    const { data: newRole, error } = await supabase
      .from('admin_roles')
      .insert({ name, description, level })
      .select()
      .single();
    if (error) return res.status(400).json({ error: error.message });

    if (Array.isArray(permissions) && permissions.length) {
      for (const pid of permissions) {
        await supabase
          .from('admin_role_permissions')
          .insert({ role_id: newRole.id, permission_id: pid });
      }
    }

    res.json(newRole);
  } catch (error) {
    console.error('Create role error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.patch('/roles/:roleId', authenticateUser, authenticateAdmin, async (req, res) => {
  try {
    const supabase = getSupabase();
    const { roleId } = req.params;
    const { name, description, level, permissions } = req.body || {};

    const update = {};
    if (name !== undefined) update.name = name;
    if (description !== undefined) update.description = description;
    if (level !== undefined) update.level = level;

    let updatedRole = null;
    if (Object.keys(update).length) {
      const { data, error } = await supabase
        .from('admin_roles')
        .update(update)
        .eq('id', roleId)
        .select()
        .single();
      if (error) return res.status(400).json({ error: error.message });
      updatedRole = data;
    }

    if (Array.isArray(permissions)) {
      await supabase.from('admin_role_permissions').delete().eq('role_id', roleId);
      for (const pid of permissions) {
        await supabase.from('admin_role_permissions').insert({ role_id: roleId, permission_id: pid });
      }
    }

    res.json(updatedRole || { id: roleId, ...update });
  } catch (error) {
    console.error('Update role error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/roles/:roleId', authenticateUser, authenticateAdmin, async (req, res) => {
  try {
    const supabase = getSupabase();
    const { roleId } = req.params;

    await supabase.from('admin_role_permissions').delete().eq('role_id', roleId);
    const { error } = await supabase.from('admin_roles').delete().eq('id', roleId);
    if (error) return res.status(400).json({ error: error.message });

    res.json({ message: 'Role deleted' });
  } catch (error) {
    console.error('Delete role error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Assign/Remove role to user
router.post('/users/:userId/roles/:roleId', authenticateUser, authenticateAdmin, async (req, res) => {
  try {
    const supabase = getSupabase();
    const { userId, roleId } = req.params;
    const { department, is_active = true, permissions = [] } = req.body || {};

    const payload = { user_id: userId, role_id: roleId, department, is_active, permissions };

    const { data, error } = await supabase
      .from('admin_users')
      .upsert(payload, { onConflict: 'user_id' })
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });

    res.json(data);
  } catch (error) {
    console.error('Assign role to user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/users/:userId/roles/:roleId', authenticateUser, authenticateAdmin, async (req, res) => {
  try {
    const supabase = getSupabase();
    const { userId, roleId } = req.params;

    const { error } = await supabase
      .from('admin_users')
      .delete()
      .eq('user_id', userId)
      .eq('role_id', roleId);
    if (error) return res.status(400).json({ error: error.message });

    res.json({ message: 'Role removed from user' });
  } catch (error) {
    console.error('Remove role from user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update admin metadata for user
router.patch('/users/:userId', authenticateUser, authenticateAdmin, async (req, res) => {
  try {
    const supabase = getSupabase();
    const { userId } = req.params;
    const { role, department, permissions, is_active } = req.body || {};

    const update = {};
    // Accept role as id (uuid) or name; resolve to id
    let resolvedRoleId = undefined;
    if (role !== undefined) {
      const roleStr = String(role || '').trim();
      const uuidLike = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(roleStr);
      if (uuidLike) {
        resolvedRoleId = roleStr;
      } else if (roleStr) {
        const { data: roleByName } = await supabase
          .from('admin_roles')
          .select('id')
          .eq('name', roleStr)
          .single();
        resolvedRoleId = roleByName?.id;
        if (!resolvedRoleId) {
          // Tentar mapear nomes do frontend para papéis canônicos
          const CANONICAL_MAP = { politico: 'support', partido: 'admin', jornalista: 'moderator' };
          const mappedName = CANONICAL_MAP[roleStr] || null;
          if (mappedName) {
            const { data: roleByCanonical } = await supabase
              .from('admin_roles')
              .select('id')
              .eq('name', mappedName)
              .single();
            resolvedRoleId = roleByCanonical?.id || undefined;
          }
          // Evitar criar para nomes canônicos; criar apenas se for um nome não mapeado
          if (!resolvedRoleId && !mappedName) {
            const { data: createdRole, error: createErr } = await supabase
              .from('admin_roles')
              .insert({ name: roleStr, description: null, permissions: [], level: 1 })
              .select('id')
              .single();
            if (createErr || !createdRole?.id) {
              return res.status(400).json({ error: 'Invalid role: not found and could not be created' });
            }
            resolvedRoleId = createdRole.id;
          }
        }
      }
      if (resolvedRoleId) {
        update.role_id = resolvedRoleId;
      }
    }
    if (department !== undefined) update.department = department;
    if (permissions !== undefined) update.permissions = Array.isArray(permissions) ? permissions : [];
    if (is_active !== undefined) update.is_active = is_active === true;

    if (!Object.keys(update).length) return res.json({ message: 'No changes' });

    // Resolve local users.id for admin_users reference
    let targetId = null;
    const { data: byLocal } = await supabase
      .from('users')
      .select('id')
      .eq('id', userId)
      .single();
    if (byLocal?.id) {
      targetId = byLocal.id;
    } else {
      const { data: byAuth } = await supabase
        .from('users')
        .select('id')
        .eq('auth_id', userId)
        .single();
      if (byAuth?.id) targetId = byAuth.id;
    }

    if (!targetId) return res.status(404).json({ error: 'User not found' });

    // Try update admin_users; if missing, upsert
    let data = null;
    let error = null;
    const upd = await supabase
      .from('admin_users')
      .update(update)
      .eq('user_id', targetId)
      .select()
      .single();
    data = upd.data; error = upd.error;

    if (error || !data) {
      const upsert = await supabase
        .from('admin_users')
        .upsert({ user_id: targetId, ...update }, { onConflict: 'user_id' })
        .select()
        .single();
      data = upsert.data; error = upsert.error;
    }

    if (error) return res.status(400).json({ error: error.message, details: error.details || null, code: error.code || null, hint: error.hint || null });

    res.json({ admin: data });
  } catch (error) {
    console.error('Patch admin user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
// Create user (admin)
router.post('/users', authenticateUser, authenticateAdmin, async (req, res) => {
  try {
    // Support two payload types:
    // 1) Create normal user: { email, password?, full_name?, ... }
    // 2) Create admin metadata: { user_id, role?, department?, permissions?, is_active? }
    const { user_id, role, roleId, department, permissions = [], is_active = true } = req.body || {};
    const { email, password, full_name, username, city, state, plan = 'gratuito', is_admin = false, points = 0 } = req.body || {};

    // Branch: admin metadata creation when no email and a user identifier is provided
    if (!email && user_id) {
      const supabase = getSupabase();

      // Resolve target users.id from local id or auth_id
      let targetId = null;
      const { data: byLocal } = await supabase.from('users').select('id').eq('id', user_id).single();
      if (byLocal?.id) {
        targetId = byLocal.id;
      } else {
        const { data: byAuth } = await supabase.from('users').select('id').eq('auth_id', user_id).single();
        if (byAuth?.id) targetId = byAuth.id;
      }
      if (!targetId) return res.status(404).json({ error: 'User not found' });

      // Resolve role id by uuid or name
      let resolvedRoleId = roleId || null;
      if (!resolvedRoleId && role) {
        const roleStr = String(role || '').trim();
        const uuidLike = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(roleStr);
        if (uuidLike) {
          resolvedRoleId = roleStr;
        } else {
          const { data: roleByName } = await supabase.from('admin_roles').select('id').eq('name', roleStr).single();
          resolvedRoleId = roleByName?.id || null;
          if (!resolvedRoleId) {
            // Mapear nomes do frontend para papéis canônicos
            const CANONICAL_MAP = { politico: 'support', partido: 'admin', jornalista: 'moderator' };
            const mappedName = CANONICAL_MAP[roleStr] || null;
            if (mappedName) {
              const { data: roleByCanonical } = await supabase
                .from('admin_roles')
                .select('id')
                .eq('name', mappedName)
                .single();
              resolvedRoleId = roleByCanonical?.id || null;
            }
            // Evitar criação para nomes canônicos; criar apenas se for não mapeado
            if (!resolvedRoleId && !mappedName) {
              const { data: createdRole, error: createErr } = await supabase
                .from('admin_roles')
                .insert({ name: roleStr, description: null, permissions: [], level: 1 })
                .select('id')
                .single();
              if (createErr || !createdRole?.id) {
                return res.status(400).json({ error: 'Invalid role: not found and could not be created' });
              }
              resolvedRoleId = createdRole.id;
            }
          }
        }
      }

      // Upsert into admin_users
      const payload = {
        user_id: targetId,
        ...(resolvedRoleId ? { role_id: resolvedRoleId } : {}),
        ...(department !== undefined ? { department } : {}),
        ...(Array.isArray(permissions) ? { permissions } : {}),
        is_active: is_active !== false
      };
      const { data, error } = await supabase
        .from('admin_users')
        .upsert(payload, { onConflict: 'user_id' })
        .select()
        .single();
      if (error) return res.status(400).json({ error: error.message });
      return res.status(201).json({ admin: data });
    }

    if (!email) return res.status(400).json({ error: 'email is required' });

    // Create in Supabase Auth (support creation without password)
    let authUser = null;
    try {
      if (password && String(password).length >= 6) {
        const { data: created, error: authError } = await supabase.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { full_name, username, city, state, plan, is_admin, points }
        });
        if (authError) return res.status(400).json({ error: authError.message, code: authError.status || 400 });
        authUser = created?.user || null;
      } else {
        // Create user without password; no email sent, can set password later
        const { data: createdNoPass, error: createNoPassError } = await supabase.auth.admin.createUser({
          email,
          email_confirm: false,
          user_metadata: { full_name, username, city, state, plan, is_admin, points }
        });
        if (createNoPassError) {
          // If user already exists, try to fetch existing by email
          const msg = String(createNoPassError.message || '').toLowerCase();
          if (msg.includes('already') && msg.includes('registered')) {
            try {
              const perPage = 200;
              const { data: list } = await supabase.auth.admin.listUsers({ page: 1, perPage });
              const existing = (list?.users || []).find(u => String(u.email || '').toLowerCase() === String(email).toLowerCase());
              if (existing) {
                authUser = existing;
              } else {
                return res.status(409).json({ error: 'User already exists but could not be retrieved', code: 409 });
              }
            } catch (listErr) {
              return res.status(409).json({ error: 'User already exists', details: listErr?.message || null, code: 409 });
            }
          } else {
            return res.status(400).json({ error: createNoPassError.message, code: createNoPassError.status || 400 });
          }
        } else {
          authUser = createdNoPass?.user || null;
        }
      }
    } catch (authEx) {
      console.warn('⚠️ Supabase Auth createUser falhou, prosseguindo com criação apenas em public.users:', authEx?.message);
      authUser = null;
    }

    if (!authUser) {
      // Fallback: continuar criação somente na tabela public.users sem auth
      console.warn('⚠️ Auth admin.createUser falhou; prosseguindo com criação em public.users sem auth_id');
    }

    // Try persisting in public users table (upsert by auth_id)
    let dbUser = null;
    try {
      const insertPayloadBase = {
        email,
        full_name: full_name ?? (email ? email.split('@')[0] : null),
        username: username ?? (email ? email.split('@')[0] : null),
        city: city ?? null,
        state: state ?? null,
        plan,
        is_admin,
        points,
        status: 'active',
        stats: { checkins: 0, conversations: 0 }
      };
      const insertPayload = {
        ...insertPayloadBase,
        auth_id: authUser?.id ?? null,
        created_at: authUser?.created_at ?? new Date().toISOString(),
        last_login: authUser?.last_sign_in_at ?? null
      };

      if (authUser?.id) {
        // Upsert por auth_id quando temos usuário de auth
        let upsertError = null;
        const { data, error } = await supabase
          .from('users')
          .upsert(insertPayload, { onConflict: 'auth_id' })
          .select()
          .single();
        if (!error && data) {
          dbUser = data;
        } else {
          upsertError = error;
          // Tentar upsert por email se não houver restrição única em auth_id
          const { data: byEmailUpsert, error: emailUpsertErr } = await supabase
            .from('users')
            .upsert(insertPayload, { onConflict: 'email' })
            .select()
            .single();
          if (!emailUpsertErr && byEmailUpsert) {
            dbUser = byEmailUpsert;
          } else {
            // Fallback: tentar insert direto
            const { data: inserted, error: insertErr } = await supabase
              .from('users')
              .insert([insertPayload])
              .select()
              .single();
            if (insertErr) {
              // Fallback final: buscar por auth_id ou email
              const { data: fetchedByAuth } = await supabase
                .from('users')
                .select('*')
                .eq('auth_id', authUser.id)
                .single();
              if (fetchedByAuth) dbUser = fetchedByAuth;
              else {
                const { data: fetchedByEmail } = await supabase
                  .from('users')
                  .select('*')
                  .eq('email', email)
                  .single();
                if (fetchedByEmail) dbUser = fetchedByEmail;
              }
            } else {
              dbUser = inserted || null;
            }
          }
        }
      } else {
        // Sem auth_id válido: inserir diretamente
        const { data: inserted, error: insertErr } = await supabase
          .from('users')
          .insert([insertPayload])
          .select()
          .single();
        if (insertErr) {
          // Se falhar, tentar localizar por email para evitar duplicidade
          const { data: byEmail } = await supabase
            .from('users')
            .select('*')
            .eq('email', email)
            .single();
          dbUser = byEmail || null;
        } else {
          dbUser = inserted || null;
        }
      }
    } catch (_) {}

    // Optionally assign role to user
    let resolvedRoleId = roleId || null;
    let resolvedRoleName = null;
    try {
      const roleName = role;
      const adminPerms = Array.isArray(permissions) ? permissions : [];
      if (!resolvedRoleId && roleName) {
        // Try resolve by id first, then by name
        const { data: byId } = await supabase
          .from('admin_roles')
          .select('id, name')
          .eq('id', roleName)
          .single();
        if (byId?.id) {
          resolvedRoleId = byId.id;
          resolvedRoleName = byId.name;
        } else {
          const { data: byName } = await supabase
            .from('admin_roles')
            .select('id, name')
            .eq('name', roleName)
            .single();
          if (byName?.id) {
            resolvedRoleId = byName.id;
            resolvedRoleName = byName.name;
          }
        }
      }
      if (resolvedRoleId && dbUser?.id) {
        const { data: adminRow } = await supabase
          .from('admin_users')
          .upsert({ user_id: dbUser.id, role_id: resolvedRoleId, department, is_active, permissions: adminPerms }, { onConflict: 'user_id' })
          .select()
          .single();
        resolvedRoleName = resolvedRoleName || (adminRow ? null : null);
      }
    } catch (_) {}

    const responseUser = dbUser || {
      id: authUser.id,
      email: authUser.email,
      full_name: full_name ?? (email ? email.split('@')[0] : null),
      username: username ?? (email ? email.split('@')[0] : null),
      city: city ?? null,
      state: state ?? null,
      plan,
      is_admin,
      points,
      created_at: authUser.created_at,
      last_login: authUser.last_sign_in_at,
      status: 'active',
      stats: { checkins: 0, conversations: 0 }
    };

    res.status(201).json({ user: responseUser, role_id: resolvedRoleId, role: resolvedRoleName || roleName || null, message: 'User created successfully' });
  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});