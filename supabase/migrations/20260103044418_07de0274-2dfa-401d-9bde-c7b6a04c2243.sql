-- Token configuration table
CREATE TABLE public.token_config (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  mint_address TEXT NOT NULL,
  burn_address TEXT NOT NULL DEFAULT '1nc1nerator11111111111111111111111111111111',
  flip_interval_seconds INTEGER NOT NULL DEFAULT 120,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Hot wallets for holder distributions (privacy layer)
CREATE TABLE public.hot_wallets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  wallet_address TEXT NOT NULL,
  private_key_encrypted TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_used_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Flip history tracking
CREATE TABLE public.flip_history (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  result TEXT NOT NULL CHECK (result IN ('burn', 'holder')),
  creator_fees_sol NUMERIC(20, 9) NOT NULL,
  amount_tokens NUMERIC(30, 9),
  recipient_wallet TEXT,
  hot_wallet_used TEXT,
  tx_hash TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.token_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hot_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flip_history ENABLE ROW LEVEL SECURITY;

-- Public read access for flip history (for the live feed)
CREATE POLICY "Anyone can view flip history" 
ON public.flip_history 
FOR SELECT 
USING (true);

-- Public read access for token config
CREATE POLICY "Anyone can view token config" 
ON public.token_config 
FOR SELECT 
USING (true);

-- Enable realtime for flip_history
ALTER PUBLICATION supabase_realtime ADD TABLE public.flip_history;

-- Insert the token configuration
INSERT INTO public.token_config (mint_address) 
VALUES ('8Se9ec6eAuq2qqYxF2WysCd3dV3qbG1qD4z6wenPpump');