require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// Supabase configuration
const supabaseUrl = process.env.SUPABASE_URL || 'https://your-project.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'your-service-role-key';

// Initialize Supabase client
const supabase = createClient(supabaseUrl, supabaseKey);
console.log('✅ Cliente HTTP Supabase configurado com sucesso');

module.exports = { supabase };