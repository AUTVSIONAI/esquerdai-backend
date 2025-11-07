-- Enable pgcrypto for UUID generation if needed
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Table: constitution_downloads
CREATE TABLE IF NOT EXISTS public.constitution_downloads (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id UUID NOT NULL,
  downloaded_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  points_awarded INTEGER NOT NULL DEFAULT 100,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Ensure only one download record per user
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'constitution_downloads_user_unique'
  ) THEN
    CREATE UNIQUE INDEX constitution_downloads_user_unique ON public.constitution_downloads(user_id);
  END IF;
END $$;

-- Table: points (point transactions)
CREATE TABLE IF NOT EXISTS public.points (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id UUID NOT NULL,
  type TEXT NOT NULL DEFAULT 'reward',
  amount INTEGER NOT NULL CHECK (amount >= 0),
  reason TEXT,
  source TEXT,
  reference_id BIGINT,
  reference_type TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Helpful indexes
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_points_user_id'
  ) THEN
    CREATE INDEX idx_points_user_id ON public.points(user_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_points_reason'
  ) THEN
    CREATE INDEX idx_points_reason ON public.points(reason);
  END IF;
END $$;

-- Optional: link constitution_downloads to points via foreign key (commented to avoid type mismatch)
-- ALTER TABLE public.points
--   ADD CONSTRAINT fk_points_constitution_download
--   FOREIGN KEY (reference_id) REFERENCES public.constitution_downloads(id) ON DELETE SET NULL;

-- Optional RLS policies (uncomment if you use RLS with anon/user keys)
-- ALTER TABLE public.constitution_downloads ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.points ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY select_own_constitution_downloads ON public.constitution_downloads
--   FOR SELECT USING (auth.uid() = user_id);
-- CREATE POLICY insert_constitution_downloads_backend ON public.constitution_downloads
--   FOR INSERT WITH CHECK (true);
-- CREATE POLICY select_own_points ON public.points
--   FOR SELECT USING (auth.uid() = user_id);
-- CREATE POLICY insert_points_backend ON public.points
--   FOR INSERT WITH CHECK (true);