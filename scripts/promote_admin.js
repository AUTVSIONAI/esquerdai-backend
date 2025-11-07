const { supabase } = require('../config/supabase');

(async () => {
  try {
    const email = process.env.TARGET_EMAIL || 'autvision@gmail.com';
    const fallbackAuthId = process.env.TARGET_AUTH_ID || '3f689ec4-39fe-44f5-acb8-0eceb796c510';

    console.log('Promovendo usuário para admin...', { email, fallbackAuthId });

    let updated = [];

    // Tentar atualizar por email
    const { data: byEmail, error: emailErr } = await supabase
      .from('users')
      .update({ role: 'admin' })
      .eq('email', email)
      .select('*');

    if (emailErr) {
      console.warn('Update por email falhou:', emailErr?.message || emailErr);
    } else if (Array.isArray(byEmail) && byEmail.length > 0) {
      console.log('Atualizado por email:', byEmail);
      updated = byEmail;
    }

    // Se não atualizou por email, tentar por auth_id conhecido
    if (!updated || updated.length === 0) {
      const { data: byAuth, error: authErr } = await supabase
        .from('users')
        .update({ role: 'admin' })
        .eq('auth_id', fallbackAuthId)
        .select('*');

      if (authErr) {
        console.warn('Update por auth_id falhou:', authErr?.message || authErr);
      } else if (Array.isArray(byAuth) && byAuth.length > 0) {
        console.log('Atualizado por auth_id:', byAuth);
        updated = byAuth;
      }
    }

    // Se ainda não há registro, buscar no auth e criar/upsert
    if (!updated || updated.length === 0) {
      console.log('Buscando usuário no auth para inserir no users...');
      const { data: authList, error: listErr } = await supabase.auth.admin.listUsers();
      if (listErr) {
        console.warn('Falha ao listar usuários de auth:', listErr?.message || listErr);
      } else {
        const match = (authList?.users || []).find(u => (u.email || '').toLowerCase() === email.toLowerCase());
        if (match) {
          console.log('Encontrado no auth:', { id: match.id, email: match.email });
          const upsertPayload = { auth_id: match.id, email: match.email, role: 'admin' };

          const { data: upserted, error: upsertErr } = await supabase
            .from('users')
            .upsert(upsertPayload, { onConflict: 'auth_id' })
            .select('*');
          if (upsertErr) {
            console.warn('Falha no upsert:', upsertErr?.message || upsertErr);
          } else {
            console.log('Upsert realizado:', upserted);
            updated = upserted || [];
          }
        } else {
          console.warn('Usuário não encontrado em auth para criar no users.');
        }
      }
    }

    // Buscar registro final para confirmar
    const { data: final } = await supabase
      .from('users')
      .select('*')
      .or(`email.eq.${email},auth_id.eq.${fallbackAuthId}`)
      .limit(1);

    console.log('Registro final:', final);
    if (final && final[0]) {
      console.log('✅ Promoção concluída:', { id: final[0].id, email: final[0].email, role: final[0].role });
      process.exit(0);
    } else {
      console.log('⚠️ Usuário não encontrado para confirmar.');
      process.exit(2);
    }
  } catch (e) {
    console.error('❌ Erro no script de promoção:', e);
    process.exit(1);
  }
})();