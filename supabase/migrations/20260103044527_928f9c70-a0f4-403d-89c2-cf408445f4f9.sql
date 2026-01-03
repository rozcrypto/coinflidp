-- Hot wallets should only be readable by the edge function (service role)
-- No public access needed
CREATE POLICY "No public access to hot wallets" 
ON public.hot_wallets 
FOR SELECT 
USING (false);