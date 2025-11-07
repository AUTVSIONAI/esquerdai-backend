-- Admin roles/permissions schema
BEGIN;

-- Ensure pgcrypto for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Permissions catalog
CREATE TABLE IF NOT EXISTS admin_permissions (
  id TEXT PRIMARY KEY,
  resource TEXT NOT NULL,
  action TEXT NOT NULL,
  description TEXT,
  UNIQUE (resource, action)
);

-- Roles
CREATE TABLE IF NOT EXISTS admin_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  description TEXT,
  level INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Role -> Permission mapping
CREATE TABLE IF NOT EXISTS admin_role_permissions (
  role_id UUID NOT NULL REFERENCES admin_roles (id) ON DELETE CASCADE,
  permission_id TEXT NOT NULL REFERENCES admin_permissions (id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

-- Admin users (user -> role + overrides)
CREATE TABLE IF NOT EXISTS admin_users (
  user_id UUID PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  role_id UUID REFERENCES admin_roles (id) ON DELETE SET NULL,
  department TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  permissions JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed default permissions
INSERT INTO admin_permissions (id, resource, action, description) VALUES
  ('users.read', 'users', 'read', 'Ler usuários'),
  ('users.update', 'users', 'update', 'Atualizar usuários'),
  ('users.delete', 'users', 'delete', 'Excluir usuários'),
  ('events.create', 'events', 'create', 'Criar eventos'),
  ('events.manage', 'events', 'manage', 'Gerenciar eventos'),
  ('content.moderate', 'content', 'moderate', 'Moderar conteúdo'),
  ('analytics.read', 'analytics', 'read', 'Ler análises'),
  ('ai.manage', 'ai', 'manage', 'Gerenciar IA')
ON CONFLICT (id) DO NOTHING;

-- Seed default roles
INSERT INTO admin_roles (name, description, level) VALUES
  ('support', 'Função de suporte com acesso limitado', 1),
  ('moderator', 'Moderação de conteúdo e acesso a análises', 2),
  ('admin', 'Acesso administrativo completo', 3)
ON CONFLICT (name) DO NOTHING;

-- Map permissions to roles (idempotent)
-- support: users.read, analytics.read
INSERT INTO admin_role_permissions (role_id, permission_id)
SELECT r.id, 'users.read' FROM admin_roles r WHERE r.name = 'support'
ON CONFLICT DO NOTHING;
INSERT INTO admin_role_permissions (role_id, permission_id)
SELECT r.id, 'analytics.read' FROM admin_roles r WHERE r.name = 'support'
ON CONFLICT DO NOTHING;

-- moderator: content.moderate, analytics.read, users.read
INSERT INTO admin_role_permissions (role_id, permission_id)
SELECT r.id, 'content.moderate' FROM admin_roles r WHERE r.name = 'moderator'
ON CONFLICT DO NOTHING;
INSERT INTO admin_role_permissions (role_id, permission_id)
SELECT r.id, 'analytics.read' FROM admin_roles r WHERE r.name = 'moderator'
ON CONFLICT DO NOTHING;
INSERT INTO admin_role_permissions (role_id, permission_id)
SELECT r.id, 'users.read' FROM admin_roles r WHERE r.name = 'moderator'
ON CONFLICT DO NOTHING;

-- admin: all
INSERT INTO admin_role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM admin_roles r CROSS JOIN admin_permissions p WHERE r.name = 'admin'
ON CONFLICT DO NOTHING;

COMMIT;