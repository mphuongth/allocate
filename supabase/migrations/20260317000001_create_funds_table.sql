-- Create funds table
CREATE TABLE IF NOT EXISTS funds (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (char_length(name) <= 255),
  code        text NOT NULL CHECK (char_length(code) <= 50),
  fund_type   text NOT NULL CHECK (fund_type IN ('equity', 'debt', 'hybrid', 'gold', 'other')),
  nav         numeric(12, 4) NOT NULL CHECK (nav >= 0.01),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  -- Code must be unique per user (case-insensitive via LOWER())
  CONSTRAINT funds_user_code_unique UNIQUE (user_id, code)
);

-- Auto-update updated_at on row change
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER funds_updated_at
  BEFORE UPDATE ON funds
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Enable Row Level Security
ALTER TABLE funds ENABLE ROW LEVEL SECURITY;

-- Users can only see their own funds
CREATE POLICY "funds_select_own" ON funds
  FOR SELECT USING (auth.uid() = user_id);

-- Users can only insert funds for themselves
CREATE POLICY "funds_insert_own" ON funds
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Users can only update their own funds
CREATE POLICY "funds_update_own" ON funds
  FOR UPDATE USING (auth.uid() = user_id);

-- Users can only delete their own funds
CREATE POLICY "funds_delete_own" ON funds
  FOR DELETE USING (auth.uid() = user_id);
