require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não configurados no .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function backfillUsers({ onlyMissing = true, dryRun = false, limit = 10000 } = {}) {
  console.log('🚀 Iniciando backfill de perfis de usuários...');
  console.log(`⚙️ Opções: onlyMissing=${onlyMissing}, dryRun=${dryRun}, limit=${limit}`);

  const { data: users, error } = await supabase
    .from('users')
    .select('id, auth_id, email, full_name, updated_at, created_at')
    .limit(limit);

  if (error) {
    console.error('❌ Erro ao buscar usuários:', error.message);
    process.exit(1);
  }

  if (!users || users.length === 0) {
    console.log('ℹ️ Nenhum usuário encontrado para processar.');
    return { updatedCount: 0, skippedCount: 0, errorCount: 0, processed: 0 };
  }

  let updatedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;
  const errors = [];

  for (const user of users) {
    const needsFullName = !user.full_name || String(user.full_name).trim() === '';
    const needsEmail = !user.email || String(user.email).trim() === '';

    if (onlyMissing && !(needsFullName || needsEmail)) {
      skippedCount++;
      continue;
    }

    const authId = user.auth_id || user.id;
    if (!authId) {
      skippedCount++;
      continue;
    }

    try {
      const { data: userRes, error: authError } = await supabase.auth.admin.getUserById(authId);
      if (authError) {
        throw new Error(authError.message || 'Falha ao obter usuário do Auth');
      }
      const authUser = userRes?.user || userRes;
      const meta = authUser?.user_metadata || {};

      const email = authUser?.email || user.email || null;
      const fullName = !needsFullName ? user.full_name : (meta.full_name || meta.name || (email ? email.split('@')[0] : null));

      const updatePayload = {
        updated_at: new Date().toISOString(),
      };
      if (fullName && needsFullName) updatePayload.full_name = fullName;
      if (email && needsEmail) updatePayload.email = email;

      if (Object.keys(updatePayload).length === 1) { // apenas updated_at
        skippedCount++;
        continue;
      }

      if (!dryRun) {
        const { error: updateError } = await supabase
          .from('users')
          .update(updatePayload)
          .eq('id', user.id);

        if (updateError) {
          errorCount++;
          errors.push({ id: user.id, error: updateError.message });
          console.error(`❌ Erro ao atualizar usuário ${user.id}:`, updateError.message);
        } else {
          updatedCount++;
          console.log(`✅ Atualizado usuário ${user.id}:`, updatePayload);
        }
      } else {
        console.log(`🧪 Dry-run: atualizaria usuário ${user.id}:`, updatePayload);
      }
    } catch (e) {
      errorCount++;
      errors.push({ id: user.id, error: e.message });
      console.error(`❌ Erro ao enriquecer usuário ${user.id}:`, e.message);
    }
  }

  console.log('🏁 Backfill concluído.');
  console.log(`📊 Resultado: atualizados=${updatedCount}, pulados=${skippedCount}, erros=${errorCount}, processados=${users.length}`);
  return { updatedCount, skippedCount, errorCount, processed: users.length, errors };
}

// Suporte a flags via CLI
function parseArgs(argv) {
  const args = { onlyMissing: true, dryRun: false, limit: 10000 };
  argv.slice(2).forEach((arg) => {
    if (arg === '--include-all') args.onlyMissing = false;
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg.startsWith('--limit=')) args.limit = parseInt(arg.split('=')[1], 10) || args.limit;
  });
  return args;
}

(async () => {
  try {
    const opts = parseArgs(process.argv);
    const result = await backfillUsers(opts);
    if (result.errorCount > 0) {
      process.exitCode = 1;
    }
  } catch (err) {
    console.error('❌ Erro geral ao executar backfill:', err);
    process.exit(1);
  }
})();