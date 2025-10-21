-- =====================================================
-- SQL COMPLETO PARA CORRIGIR TODOS OS PROBLEMAS
-- Execute este SQL no painel do Supabase
-- =====================================================

-- 1. Adicionar colunas para sincronização com APIs
-- 0. Criar tabela de políticos caso não exista
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE IF NOT EXISTS politicians (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  full_name TEXT,
  email VARCHAR(255),
  party TEXT,
  position TEXT,
  city TEXT,
  state TEXT,
  country TEXT,
  photo_url TEXT,
  short_bio TEXT,
  social_links JSONB,
  government_plan TEXT,
  government_plan_pdf_url TEXT,
  main_ideologies JSONB,
  status VARCHAR(20) DEFAULT 'approved' CHECK (status IN ('pending','approved','rejected')),
  approval_status VARCHAR(20) DEFAULT 'approved' CHECK (approval_status IN ('pending','approved','rejected')),
  is_approved BOOLEAN DEFAULT true,
  is_active BOOLEAN DEFAULT true,
  external_id VARCHAR(50),
  source VARCHAR(20) DEFAULT 'manual' CHECK (source IN ('manual','camara','senado')),
  legislature_id INTEGER,
  approved_at TIMESTAMP WITH TIME ZONE,
  approved_by VARCHAR(255),
  admin_comment TEXT,
  average_rating NUMERIC(3,2) DEFAULT 0,
  total_votes INTEGER DEFAULT 0,
  popularity_score NUMERIC(10,2) DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Índices úteis para performance de busca/listagem
CREATE INDEX IF NOT EXISTS idx_politicians_active ON politicians(is_active);
CREATE INDEX IF NOT EXISTS idx_politicians_approved ON politicians(is_approved);
CREATE INDEX IF NOT EXISTS idx_politicians_status ON politicians(status);
CREATE INDEX IF NOT EXISTS idx_politicians_approval_status ON politicians(approval_status);
CREATE INDEX IF NOT EXISTS idx_politicians_state ON politicians(state);
CREATE INDEX IF NOT EXISTS idx_politicians_party ON politicians(party);
CREATE INDEX IF NOT EXISTS idx_politicians_position ON politicians(position);
CREATE INDEX IF NOT EXISTS idx_politicians_external_id_source ON politicians(external_id, source);

-- Continuação dos ajustes existentes
ALTER TABLE politicians ADD COLUMN IF NOT EXISTS external_id VARCHAR(50);
ALTER TABLE politicians ADD COLUMN IF NOT EXISTS source VARCHAR(20) DEFAULT 'manual' CHECK (source IN ('manual', 'camara', 'senado'));
ALTER TABLE politicians ADD COLUMN IF NOT EXISTS legislature_id INTEGER;
ALTER TABLE politicians ADD COLUMN IF NOT EXISTS full_name VARCHAR(500);
ALTER TABLE politicians ADD COLUMN IF NOT EXISTS email VARCHAR(255);

-- 2. Adicionar colunas para sistema de aprovação
ALTER TABLE politicians ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'approved' CHECK (status IN ('pending', 'approved', 'rejected'));
ALTER TABLE politicians ADD COLUMN IF NOT EXISTS approval_status VARCHAR(20) DEFAULT 'approved' CHECK (approval_status IN ('pending', 'approved', 'rejected'));
ALTER TABLE politicians ADD COLUMN IF NOT EXISTS is_approved BOOLEAN DEFAULT true;
ALTER TABLE politicians ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE politicians ADD COLUMN IF NOT EXISTS approved_by VARCHAR(255);
ALTER TABLE politicians ADD COLUMN IF NOT EXISTS admin_comment TEXT;

-- 3. Atualizar registros existentes
UPDATE politicians SET 
  source = 'manual',
  status = CASE 
    WHEN is_active = true THEN 'approved'
    ELSE 'pending'
  END,
  approval_status = CASE 
    WHEN is_active = true THEN 'approved'
    ELSE 'pending'
  END,
  is_approved = is_active,
  approved_at = CASE 
    WHEN is_active = true THEN created_at
    ELSE NULL
  END
WHERE source IS NULL OR source = '';

-- 4. Criar índices para performance
CREATE INDEX IF NOT EXISTS idx_politicians_external_id_source ON politicians(external_id, source);
CREATE INDEX IF NOT EXISTS idx_politicians_source ON politicians(source);
CREATE INDEX IF NOT EXISTS idx_politicians_status ON politicians(status);
CREATE INDEX IF NOT EXISTS idx_politicians_approval_status ON politicians(approval_status);
CREATE INDEX IF NOT EXISTS idx_politicians_legislature_id ON politicians(legislature_id);
CREATE INDEX IF NOT EXISTS idx_politicians_email ON politicians(email);

-- 5. Verificar se as colunas foram criadas
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns 
WHERE table_name = 'politicians' 
AND table_schema = 'public'
AND column_name IN ('email', 'external_id', 'source', 'full_name', 'legislature_id', 'status', 'approval_status', 'is_approved', 'approved_at', 'approved_by')
ORDER BY column_name;

-- 6. Mostrar alguns dados de exemplo para verificar
SELECT 
  id, 
  name, 
  email, 
  external_id, 
  source, 
  status, 
  approval_status, 
  is_approved, 
  is_active,
  created_at
FROM politicians 
LIMIT 3;

-- =====================================================
-- 7. Criar tabelas para Loja (products, cart_items, orders, order_items)
-- Estas tabelas suportam as rotas em routes/store.js
-- =====================================================

-- Habilitar funções para UUID
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Tabela de produtos
CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  price NUMERIC(10,2) NOT NULL CHECK (price >= 0),
  category TEXT,
  stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  stock_quantity INTEGER NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
  image_url TEXT,
  image TEXT,
  images JSONB,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Índices de produtos
CREATE INDEX IF NOT EXISTS idx_products_active ON products(active);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
CREATE INDEX IF NOT EXISTS idx_products_created_at ON products(created_at);

-- Tabela de itens do carrinho
CREATE TABLE IF NOT EXISTS cart_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  price NUMERIC(10,2) NOT NULL CHECK (price >= 0),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cart_items_user ON cart_items(user_id);
CREATE INDEX IF NOT EXISTS idx_cart_items_product ON cart_items(product_id);
CREATE INDEX IF NOT EXISTS idx_cart_items_created_at ON cart_items(created_at);

-- Tabela de pedidos
CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','shipped','delivered','canceled','refunded')),
  subtotal NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  shipping_cost NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (shipping_cost >= 0),
  total NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  shipping_address JSONB NOT NULL,
  payment_method TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);

-- Itens de pedido
CREATE TABLE IF NOT EXISTS order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  price NUMERIC(10,2) NOT NULL CHECK (price >= 0),
  product_name TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product ON order_items(product_id);

-- 8. Garantir coluna de pontos no perfil de usuários
ALTER TABLE users ADD COLUMN IF NOT EXISTS points INTEGER DEFAULT 0;