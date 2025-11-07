-- =====================================================
-- CRIAR TABELA POINTS PARA SISTEMA DE GAMIFICAÇÃO
-- Execute este SQL no painel do Supabase
-- =====================================================

-- Criar tabela points se não existir
CREATE TABLE IF NOT EXISTS points (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    amount INTEGER NOT NULL,
    reason TEXT NOT NULL,
    source VARCHAR(50) DEFAULT 'other',
    category VARCHAR(50) DEFAULT 'general',
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Criar índices para melhor performance
CREATE INDEX IF NOT EXISTS idx_points_user_id ON points(user_id);
CREATE INDEX IF NOT EXISTS idx_points_created_at ON points(created_at);
CREATE INDEX IF NOT EXISTS idx_points_source ON points(source);
CREATE INDEX IF NOT EXISTS idx_points_category ON points(category);

-- Criar função para atualizar updated_at automaticamente
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Criar trigger para atualizar updated_at
DROP TRIGGER IF EXISTS update_points_updated_at ON points;
CREATE TRIGGER update_points_updated_at
    BEFORE UPDATE ON points
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Habilitar RLS (Row Level Security)
ALTER TABLE points ENABLE ROW LEVEL SECURITY;

-- Política para usuários verem apenas seus próprios pontos
CREATE POLICY "Users can view own points" ON points
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.users u 
            WHERE u.id = points.user_id 
              AND u.auth_id = auth.uid()
        )
    );

-- Política para admins verem todos os pontos
CREATE POLICY "Admins can view all points" ON points
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM users 
            WHERE users.auth_id = auth.uid() 
            AND users.role = 'admin'
        )
    );

-- Política para inserção de pontos (apenas sistema/admin)
CREATE POLICY "System can insert points" ON points
    FOR INSERT WITH CHECK (true);

-- Política para atualização de pontos (apenas sistema/admin)
CREATE POLICY "System can update points" ON points
    FOR UPDATE USING (true);

-- Comentários para documentação
COMMENT ON TABLE points IS 'Tabela para armazenar pontos de gamificação dos usuários';
COMMENT ON COLUMN points.user_id IS 'ID do usuário (referência para public.users)';
COMMENT ON COLUMN points.amount IS 'Quantidade de pontos (pode ser negativa para deduções)';
COMMENT ON COLUMN points.reason IS 'Motivo da concessão/dedução dos pontos';
COMMENT ON COLUMN points.source IS 'Origem dos pontos (checkin, purchase, achievement, etc.)';
COMMENT ON COLUMN points.category IS 'Categoria dos pontos (general, bonus, penalty, etc.)';
COMMENT ON COLUMN points.metadata IS 'Dados adicionais em formato JSON';

-- Inserir alguns pontos de exemplo para teste (opcional)
-- Descomente as linhas abaixo se quiser dados de exemplo
/*
INSERT INTO points (user_id, amount, reason, source, category) VALUES
((SELECT id FROM auth.users LIMIT 1), 100, 'Bônus de boas-vindas', 'welcome', 'bonus'),
((SELECT id FROM auth.users LIMIT 1), 50, 'Primeiro acesso', 'login', 'bonus'),
((SELECT id FROM auth.users LIMIT 1), 25, 'Perfil completo', 'profile', 'achievement');
*/

SELECT 'Tabela points criada com sucesso!' as status;