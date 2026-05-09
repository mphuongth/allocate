-- Add target_date, icon, and priority to savings_goals for redesigned create/edit modal
ALTER TABLE savings_goals ADD COLUMN IF NOT EXISTS target_date TEXT;
ALTER TABLE savings_goals ADD COLUMN IF NOT EXISTS icon TEXT DEFAULT 'target';
ALTER TABLE savings_goals ADD COLUMN IF NOT EXISTS priority TEXT DEFAULT 'med' CHECK (priority IN ('low', 'med', 'high'));
