-- Add a table to track wallet balance after each flip
-- This lets us detect NEW incoming fees (auto-claimed by PumpPortal)
CREATE TABLE public.wallet_balance_tracker (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  wallet_address text NOT NULL,
  balance_after_flip numeric NOT NULL,
  flip_id uuid REFERENCES public.flip_history(id),
  recorded_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.wallet_balance_tracker ENABLE ROW LEVEL SECURITY;

-- No public access (only edge function with service role can access)
CREATE POLICY "No public access to balance tracker" 
ON public.wallet_balance_tracker 
FOR SELECT 
USING (false);