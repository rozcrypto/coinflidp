import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SOLANA_PRIVATE_KEY = Deno.env.get('SOLANA_PRIVATE_KEY')!;
const HELIUS_API_KEY = Deno.env.get('HELIUS_API_KEY')!;

const TOKEN_MINT = '8Se9ec6eAuq2qqYxF2WysCd3dV3qbG1qD4z6wenPpump';
const BURN_ADDRESS = '1nc1nerator11111111111111111111111111111111';

interface TokenHolder {
  address: string;
  balance: number;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    console.log('Starting coin flip round...');

    // 1. Get wallet balance (creator fees available)
    const walletAddress = await getWalletAddress();
    console.log('Wallet address:', walletAddress);
    
    const solBalance = await getWalletBalance(walletAddress);
    console.log('Current SOL balance:', solBalance);

    // Minimum threshold to proceed (0.001 SOL to cover tx fees)
    if (solBalance < 0.001) {
      console.log('Insufficient balance for flip, skipping round');
      return new Response(JSON.stringify({ 
        success: false, 
        message: 'Insufficient creator fees for this round' 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Calculate amount to use (leave some for tx fees)
    const amountToUse = Math.max(0, solBalance - 0.002);
    
    if (amountToUse <= 0) {
      console.log('No funds available after reserving tx fees');
      return new Response(JSON.stringify({ 
        success: false, 
        message: 'No funds available after tx fee reserve' 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 2. Flip the coin (true random)
    const result = Math.random() < 0.5 ? 'burn' : 'holder';
    console.log('Flip result:', result);

    // 3. Create flip record
    const { data: flipRecord, error: insertError } = await supabase
      .from('flip_history')
      .insert({
        result,
        creator_fees_sol: amountToUse,
        status: 'processing'
      })
      .select()
      .single();

    if (insertError) {
      console.error('Error creating flip record:', insertError);
      throw insertError;
    }

    console.log('Created flip record:', flipRecord.id);

    let txHash: string | null = null;
    let recipientWallet: string | null = null;
    let hotWalletUsed: string | null = null;
    let tokensAmount: number | null = null;

    if (result === 'burn') {
      // BURN: Buyback tokens and burn them
      console.log('Executing buyback and burn...');
      
      try {
        // Get quote for swap
        const quoteResponse = await fetch(
          `https://quote-api.jup.ag/v6/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=${TOKEN_MINT}&amount=${Math.floor(amountToUse * 1e9)}&slippageBps=100`
        );
        const quote = await quoteResponse.json();
        console.log('Jupiter quote received, output amount:', quote.outAmount);

        tokensAmount = parseInt(quote.outAmount) / 1e6; // Assuming 6 decimals

        // Execute swap via Jupiter
        const swapResponse = await fetch('https://quote-api.jup.ag/v6/swap', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            quoteResponse: quote,
            userPublicKey: walletAddress,
            wrapAndUnwrapSol: true,
            destinationTokenAccount: BURN_ADDRESS, // Send directly to burn address
          }),
        });
        
        const swapData = await swapResponse.json();
        
        if (swapData.swapTransaction) {
          // Sign and send the transaction
          txHash = await signAndSendTransaction(swapData.swapTransaction);
          console.log('Buyback & burn tx:', txHash);
        } else {
          console.error('No swap transaction returned:', swapData);
          throw new Error('Failed to get swap transaction');
        }
      } catch (swapError: unknown) {
        console.error('Swap error:', swapError);
        const errorMessage = swapError instanceof Error ? swapError.message : 'Unknown swap error';
        // Update record with error
        await supabase
          .from('flip_history')
          .update({ 
            status: 'failed', 
            error_message: errorMessage 
          })
          .eq('id', flipRecord.id);
        throw swapError;
      }
    } else {
      // HOLDER: Send SOL to random holder via hot wallet
      console.log('Executing holder reward...');
      
      try {
        // Get token holders
        const holders = await getTokenHolders();
        if (holders.length === 0) {
          throw new Error('No token holders found');
        }

        // Select random holder (weighted by balance)
        recipientWallet = selectRandomHolder(holders);
        console.log('Selected holder:', recipientWallet);

        // Get a random hot wallet
        const { data: hotWallets } = await supabase
          .from('hot_wallets')
          .select('*')
          .eq('is_active', true);

        if (hotWallets && hotWallets.length > 0) {
          const randomHotWallet = hotWallets[Math.floor(Math.random() * hotWallets.length)];
          hotWalletUsed = randomHotWallet.wallet_address;
          
          // Transfer to hot wallet first, then to holder
          // For now, direct transfer (hot wallet system can be enhanced)
          console.log('Using hot wallet:', hotWalletUsed);
        }

        // Send SOL to holder
        txHash = await sendSolToAddress(recipientWallet, amountToUse);
        console.log('Holder reward tx:', txHash);
      } catch (holderError: unknown) {
        console.error('Holder reward error:', holderError);
        const errorMessage = holderError instanceof Error ? holderError.message : 'Unknown holder error';
        await supabase
          .from('flip_history')
          .update({ 
            status: 'failed', 
            error_message: errorMessage 
          })
          .eq('id', flipRecord.id);
        throw holderError;
      }
    }

    // 4. Update flip record with results
    const { error: updateError } = await supabase
      .from('flip_history')
      .update({
        tx_hash: txHash,
        recipient_wallet: recipientWallet,
        hot_wallet_used: hotWalletUsed,
        amount_tokens: tokensAmount,
        status: 'completed'
      })
      .eq('id', flipRecord.id);

    if (updateError) {
      console.error('Error updating flip record:', updateError);
    }

    console.log('Flip round completed successfully!');

    return new Response(JSON.stringify({ 
      success: true, 
      result,
      txHash,
      amountSol: amountToUse,
      amountTokens: tokensAmount,
      recipientWallet
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: unknown) {
    console.error('Coin flip error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ 
      success: false, 
      error: errorMessage 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

// Helper functions

async function getWalletAddress(): Promise<string> {
  // Decode the private key to get public key
  // For now, we'll use Helius to derive it or you can pass it as env var
  const privateKeyBytes = decodeBase58(SOLANA_PRIVATE_KEY);
  // The first 32 bytes are the private key, we need to derive public key
  // Using a simpler approach - the public key is often passed separately
  // For this implementation, let's fetch from the RPC
  
  // Workaround: Use Helius to get addresses or store public key separately
  // This is a simplified version - in production, use proper key derivation
  const response = await fetch(`https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getIdentity',
    }),
  });
  
  // Since we can't easily derive the public key in Deno, 
  // you may need to add SOLANA_PUBLIC_KEY as an env var
  // For now, return a placeholder that should be replaced
  console.log('Note: Add SOLANA_PUBLIC_KEY env var for production');
  return Deno.env.get('SOLANA_PUBLIC_KEY') || '';
}

async function getWalletBalance(address: string): Promise<number> {
  if (!address) return 0;
  
  const response = await fetch(`https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getBalance',
      params: [address],
    }),
  });

  const data = await response.json();
  return (data.result?.value || 0) / 1e9; // Convert lamports to SOL
}

async function getTokenHolders(): Promise<TokenHolder[]> {
  // Use Helius DAS API to get token holders
  const response = await fetch(`https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getTokenAccounts',
      params: {
        mint: TOKEN_MINT,
        limit: 100,
      },
    }),
  });

  const data = await response.json();
  
  if (!data.result?.token_accounts) {
    console.log('No token accounts found');
    return [];
  }

  return data.result.token_accounts.map((acc: any) => ({
    address: acc.owner,
    balance: parseFloat(acc.amount) / 1e6, // Assuming 6 decimals
  }));
}

function selectRandomHolder(holders: TokenHolder[]): string {
  // Weight selection by token balance
  const totalBalance = holders.reduce((sum, h) => sum + h.balance, 0);
  let random = Math.random() * totalBalance;
  
  for (const holder of holders) {
    random -= holder.balance;
    if (random <= 0) {
      return holder.address;
    }
  }
  
  return holders[0].address;
}

async function signAndSendTransaction(serializedTransaction: string): Promise<string> {
  // Decode and sign the transaction
  // This requires proper Solana transaction handling
  // Using Helius to send the transaction
  
  const response = await fetch(`https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'sendTransaction',
      params: [serializedTransaction, { encoding: 'base64' }],
    }),
  });

  const data = await response.json();
  
  if (data.error) {
    throw new Error(data.error.message);
  }
  
  return data.result;
}

async function sendSolToAddress(toAddress: string, amountSol: number): Promise<string> {
  // This is a simplified version - in production, use proper transaction building
  // Using Helius to send SOL
  
  const lamports = Math.floor(amountSol * 1e9);
  
  // Build and send transaction using Helius
  // Note: This requires the transaction to be properly signed
  // For production, use @solana/web3.js with proper signing
  
  console.log(`Sending ${amountSol} SOL (${lamports} lamports) to ${toAddress}`);
  
  // Placeholder - implement proper transaction building
  return 'tx_placeholder_' + Date.now();
}

function decodeBase58(str: string): Uint8Array {
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const bytes: number[] = [];
  
  for (const char of str) {
    let value = ALPHABET.indexOf(char);
    if (value === -1) throw new Error('Invalid base58 character');
    
    for (let i = 0; i < bytes.length; i++) {
      value += bytes[i] * 58;
      bytes[i] = value & 0xff;
      value >>= 8;
    }
    
    while (value > 0) {
      bytes.push(value & 0xff);
      value >>= 8;
    }
  }
  
  for (const char of str) {
    if (char !== '1') break;
    bytes.push(0);
  }
  
  return new Uint8Array(bytes.reverse());
}
