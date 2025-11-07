require('dotenv').config();
const axios = require('axios');

(async () => {
  try {
    const email = process.env.TARGET_EMAIL || 'autvision@gmail.com';
    const token = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!token) {
      throw new Error('SUPABASE_SERVICE_ROLE_KEY não definido no ambiente/.env');
    }
    const url = `http://localhost:5120/api/admin/users?search=${encodeURIComponent(email)}&limit=1`;
    console.log('Consultando:', url);
    const resp = await axios.get(url, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 10000,
    });
    console.log('Status:', resp.status);
    console.log('Dados:', JSON.stringify(resp.data, null, 2));
  } catch (e) {
    console.error('Erro na verificação:', e.response?.data || e.message);
    process.exit(1);
  }
})();