require('dotenv').config();
const axios = require('axios');

(async () => {
  try {
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceKey) {
      console.error('❌ SUPABASE_SERVICE_ROLE_KEY ausente no ambiente.');
      process.exit(1);
    }

    const apiBase = process.env.API_URL || process.env.VITE_API_URL || `http://localhost:${process.env.PORT || 4000}/api`;
    const url = `${apiBase}/admin/users?limit=200`;

    console.log('Consultando:', url);

    const res = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${serviceKey}`,
      },
    });

    const users = res?.data?.users || res?.data?.data || [];
    console.log('Status:', res.status);
    console.log('Total retornado:', users.length);
    console.log('Primeiros usuários:', users.slice(0, 5).map(u => ({ email: u.email, role: u.role })));
  } catch (err) {
    if (err.response) {
      console.error('❌ Erro de resposta:', err.response.status, err.response.data);
    } else {
      console.error('❌ Erro:', err.message || err);
    }
    process.exit(1);
  }
})();