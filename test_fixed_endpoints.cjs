const axios = require('axios');

const BASE_URL = 'https://direitai-backend.vercel.app';

// IDs de exemplo para testes
const TEST_USER_ID = '0155ccb7-e67f-41dc-a133-188f97996b73';
const TEST_USER_ID_2 = 'bcd0593a-ba47-4262-8f8f-cb32f97e58d6';

async function testEndpoint(method, url, description) {
  try {
    console.log(`\n🔍 Testando: ${description}`);
    console.log(`📡 ${method.toUpperCase()} ${url}`);
    
    const response = await axios({
      method,
      url,
      timeout: 10000,
      validateStatus: () => true // Aceita qualquer status code
    });
    
    console.log(`✅ Status: ${response.status}`);
    
    if (response.status === 200) {
      console.log(`📊 Dados retornados:`, JSON.stringify(response.data, null, 2));
    } else {
      console.log(`❌ Erro: ${response.status} - ${response.statusText}`);
      if (response.data) {
        console.log(`📄 Resposta:`, JSON.stringify(response.data, null, 2));
      }
    }
    
    return response;
  } catch (error) {
    console.log(`❌ Erro na requisição: ${error.message}`);
    return null;
  }
}

async function runTests() {
  console.log('🚀 Iniciando testes dos endpoints corrigidos...\n');
  
  // Teste 1: Políticos (deve mostrar apenas aprovados)
  await testEndpoint('GET', `${BASE_URL}/api/politicians`, 'Listar políticos (apenas aprovados)');
  
  // Teste 2: Constitution Downloads - Status
  await testEndpoint('GET', `${BASE_URL}/api/constitution-downloads/users/${TEST_USER_ID}/status`, 'Status de download da constituição');
  
  // Teste 3: Constitution Downloads - Register
  await testEndpoint('POST', `${BASE_URL}/api/constitution-downloads/users/${TEST_USER_ID}/register`, 'Registrar download da constituição');
  
  // Teste 4: User Stats
  await testEndpoint('GET', `${BASE_URL}/api/users/${TEST_USER_ID_2}/stats`, 'Estatísticas do usuário');
  
  // Teste 5: User Usage History
  await testEndpoint('GET', `${BASE_URL}/api/user/usage-history?days=7`, 'Histórico de uso do usuário');
  
  // Teste 6: User Plan Info
  await testEndpoint('GET', `${BASE_URL}/api/user/plan-info`, 'Informações do plano do usuário');
  
  // Teste 7: User Usage Stats
  await testEndpoint('GET', `${BASE_URL}/api/user/usage-stats`, 'Estatísticas de uso do usuário');
  
  // Teste 8: Health Check
  await testEndpoint('GET', `${BASE_URL}/health`, 'Health check');
  
  console.log('\n🏁 Testes concluídos!');
}

runTests().catch(console.error);