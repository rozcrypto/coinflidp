-- Add explicit DENY policies for all operations on hot_wallets table
-- These ensure no public/authenticated user can access the table in any way
-- Only the edge function with service_role key can access it

-- Block INSERT for all users
CREATE POLICY "Block all inserts on hot_wallets"
ON public.hot_wallets
FOR INSERT
TO public, authenticated, anon
WITH CHECK (false);

-- Block UPDATE for all users  
CREATE POLICY "Block all updates on hot_wallets"
ON public.hot_wallets
FOR UPDATE
TO public, authenticated, anon
USING (false)
WITH CHECK (false);

-- Block DELETE for all users
CREATE POLICY "Block all deletes on hot_wallets"
ON public.hot_wallets
FOR DELETE
TO public, authenticated, anon
USING (false);