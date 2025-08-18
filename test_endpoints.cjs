const axios = require('axios');

// URL base da API em produção
const BASE_URL = 'https://direitai-backend.vercel.app';

async function testEndpoint(endpoint, description) {
  try {
    console.log(`📡 Testando ${endpoint}...`);
    const response = await axios.get(`${BASE_URL}${endpoint}`, {
      timeout: 10000
    });
    console.log(`✅ ${description}:`);
    console.log(`Status: ${response.status}`);
    console.log(`Data:`, response.data);
    console.log('');
  } catch (error) {
    console.log(`❌ Erro no ${endpoint}:`);
    console.log(`Status: ${error.response?.status || 'N/A'}`);
    console.log(`Data:`, error.response?.data || error.message);
    console.log('');
  }
}

async function runTests() {
  console.log('🚀 Iniciando testes dos endpoints...\n');
  
  await testEndpoint('/health', 'Health Check');
  await testEndpoint('/api/politicians', 'Lista de Políticos');
  await testEndpoint('/api/manifestations', 'Lista de Manifestações');
  
  console.log('🏁 Testes concluídos!');
}

runTests();