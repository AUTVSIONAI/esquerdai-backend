const express = require('express');
const cors = require('cors');
require('dotenv').config();

// Verificar se as variáveis de ambiente estão configuradas
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Variáveis de ambiente do Supabase não configuradas');
  console.error('SUPABASE_URL:', process.env.SUPABASE_URL ? 'Configurada' : 'Não configurada');
  console.error('SUPABASE_SERVICE_ROLE_KEY:', process.env.SUPABASE_SERVICE_ROLE_KEY ? 'Configurada' : 'Não configurada');
}

let supabase;
try {
  const supabaseConfig = require('./config/supabase');
  supabase = supabaseConfig.supabase;
  console.log('✅ Supabase configurado com sucesso');
} catch (error) {
  console.error('❌ Erro ao configurar Supabase:', error.message);
  // Criar um mock do supabase para evitar crashes
  supabase = {
    from: () => ({
      select: () => Promise.resolve({ data: [], error: null }),
      insert: () => Promise.resolve({ data: null, error: { message: 'Supabase não configurado' } }),
      update: () => Promise.resolve({ data: null, error: { message: 'Supabase não configurado' } }),
      delete: () => Promise.resolve({ data: null, error: { message: 'Supabase não configurado' } })
    })
  };
}

// Tornar supabase disponível globalmente
global.supabase = supabase;

// Logger removido para compatibilidade com Vercel
// const logger = require('./utils/logger');
// const { cleanOldLogs } = require('./utils/logCleaner');

// Logs antigos removidos para compatibilidade com Vercel
// cleanOldLogs();

const app = express();
const PORT = process.env.PORT || 5120;

// Middleware
const corsOptions = {
  origin: [
    'https://direitai.com',
    'https://www.direitai.com',
    'https://direitai.vercel.app',
    'https://direitai-backend.vercel.app',
    'http://localhost:5120',
    'http://localhost:5121',
    'http://localhost:5122',
    'http://localhost:5123',
    'http://localhost:5124'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));
// Logger middleware removido para compatibilidade com Vercel
// app.use(logger.middleware());

// Middleware para lidar com preflight OPTIONS requests
app.options('*', (req, res) => {
  res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Origin');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.status(200).send();
});

// Debug middleware para todas as requisições
app.use((req, res, next) => {
  console.log('🔍 REQUEST:', req.method, req.originalUrl);
  
  // Debug específico para rotas RSVP
  if (req.originalUrl.includes('/api/rsvp') && req.method === 'POST') {
    console.log('🔍 RSVP POST - Headers:', req.headers);
    console.log('🔍 RSVP POST - Body:', req.body);
    console.log('🔍 RSVP POST - Content-Type:', req.get('Content-Type'));
  }
  
  next();
});

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/events', require('./routes/events'));
app.use('/api/checkins', require('./routes/checkins'));
app.use('/api/ai', require('./routes/ai'));
app.use('/api/store', require('./routes/store'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/admin/content-moderation', require('./routes/contentModeration'));
app.use('/api/admin/financial', require('./routes/financialReports'));
app.use('/api/admin/store', require('./routes/storeManagement'));
app.use('/api/admin/politicians', require('./routes/adminPoliticians'));
app.use('/api/manifestations', require('./routes/manifestations'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/plans', require('./routes/plans'));
app.use('/api/gamification', require('./routes/gamification'));
app.use('/api/rsvp', require('./routes/rsvp'));

// Novas rotas para funcionalidades de políticos
app.use('/api/politicians', require('./routes/politicians'));
app.use('/api/agents', require('./routes/agents'));
app.use('/api/blog', require('./routes/blog'));
app.use('/api/ratings', require('./routes/ratings'));
app.use('/api/upload', require('./routes/upload'));
app.use('/api/surveys', require('./routes/surveys'));
app.use('/api/fake-news', require('./routes/fakeNews'));
app.use('/api/public', require('./routes/publicRegistration'));
app.use('/api/constitution', require('./routes/constitution'));
app.use('/api/constitution-downloads', require('./routes/constitutionDownloads'));
app.use('/api/user', require('./routes/user'));

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'DireitaAI Backend API',
    version: '1.0.0',
    status: 'running',
    endpoints: {
      health: '/health',
      auth: '/api/auth',
      users: '/api/users',
      events: '/api/events',
      ai: '/api/ai',
      store: '/api/store',
      admin: '/api/admin'
    }
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  const healthData = {
    status: 'OK', 
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    // logs: logger.getStats() // Removido para compatibilidade com Vercel
  };
  
  console.log('Health check accessed');
  res.json(healthData);
});

// Endpoint de debug para verificar variáveis de ambiente
app.get('/debug/env', (req, res) => {
  res.json({
    NODE_ENV: process.env.NODE_ENV || 'Não configurada',
    SUPABASE_URL: process.env.SUPABASE_URL || 'Não configurada',
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ? `${process.env.SUPABASE_SERVICE_ROLE_KEY.substring(0, 20)}...` : 'Não configurada',
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY ? `${process.env.SUPABASE_ANON_KEY.substring(0, 20)}...` : 'Não configurada',
    PORT: process.env.PORT || 'Não configurada',
    timestamp: new Date().toISOString(),
    // Verificar se as URLs são válidas
    supabase_url_is_placeholder: process.env.SUPABASE_URL === 'https://your-project.supabase.co',
    supabase_key_is_placeholder: process.env.SUPABASE_SERVICE_ROLE_KEY === 'your-service-role-key'
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Erro no servidor:', err.message, {
    url: req.originalUrl,
    method: req.method,
    ip: req.ip,
    userId: req.user?.id
  });
  
  res.status(500).json({ 
    error: 'Erro interno do servidor',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Algo deu errado'
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Para Vercel, não usamos app.listen
// Só executa app.listen em desenvolvimento local
if (!process.env.VERCEL && process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`🚀 Servidor DireitaAI iniciado!`);
    console.log(`📊 Porta: ${PORT}`);
    console.log(`🔗 Health: http://localhost:${PORT}/health`);
  });
}

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Recebido SIGTERM, encerrando servidor...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('Recebido SIGINT, encerrando servidor...');
  process.exit(0);
});

// Export para Vercel
module.exports = app;