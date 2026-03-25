CREATE TABLE gold_price_settings (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  price_per_chi NUMERIC NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE gold_price_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own gold price"
  ON gold_price_settings FOR ALL USING (auth.uid() = user_id);
