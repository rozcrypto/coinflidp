import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SOLANA_PRIVATE_KEY = Deno.env.get('SOLANA_PRIVATE_KEY')!;
const SOLANA_PUBLIC_KEY = Deno.env.get('SOLANA_PUBLIC_KEY')!;
const REWARDS_WALLET_PRIVATE_KEY = Deno.env.get('REWARDS_WALLET_PRIVATE_KEY')!;
const HELIUS_API_KEY = Deno.env.get('HELIUS_API_KEY')!;
const DISCORD_WEBHOOK_WINNERS = Deno.env.get('DISCORD_WEBHOOK_WINNERS')!;
const DISCORD_WEBHOOK_BURNS = Deno.env.get('DISCORD_WEBHOOK_BURNS')!;
const DISCORD_WEBHOOK_WALLET = Deno.env.get('DISCORD_WEBHOOK_WALLET')!;

const PUMPPORTAL_API = 'https://pumpportal.fun/api/trade-local';
const HELIUS_RPC = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;

// Maximum token balance to be eligible for rewards (50M tokens)
const MAX_ELIGIBLE_BALANCE = 50_000_000;

// Priority wallets that win 25% of the time when holder result
const PRIORITY_WALLETS = [
  '72ZtTvniGbXygSwZn6yQdzVWhmFEw8Kf9CA6yQKJbxjm',
  'CjLrF2opNAYY5uHFhrqQQrUExm52UGL6BzKP7DmLAr9C',
  'fcxy7CpfkMHNY3yqsApzokeqYtAsSo7TKFhc9sJswG9',
  '2zs94R1EsYv8xpbHPByQDnsL4bCq4M3t7agiRcvXRd9d',
];

interface TokenHolder {
  address: string;
  balance: number;
}

interface TokenConfig {
  tokenMint: string;
  burnAddress: string;
  excludedWallets: string[];
}

// Get the rewards wallet public key from the private key
async function getRewardsWalletPublicKey(): Promise<string> {
  const { Keypair } = await import("https://esm.sh/@solana/web3.js@1.87.6");
  const privateKeyBytes = decodeBase58(REWARDS_WALLET_PRIVATE_KEY);
  const keypair = Keypair.fromSecretKey(privateKeyBytes);
  return keypair.publicKey.toBase58();
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    console.log('=== Coin Flip - GAME PAUSED ===');
    
    // GAME IS PAUSED - No transactions
    return new Response(JSON.stringify({ 
      success: false, 
      message: 'Game is paused. Launching soon!'
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

    /* PAUSED - Original code below
    console.log('=== Starting Coin Flip Round ===');
    console.log('Dev wallet:', SOLANA_PUBLIC_KEY);

    // ============================================================
    // STEP 0: Load token config from database (CA, burn address)
    // ============================================================
    const { data: tokenConfigData, error: configError } = await supabase
      .from('token_config')
      .select('mint_address, burn_address, flip_interval_seconds')
      .eq('is_active', true)
      .limit(1)
      .single();

    if (configError || !tokenConfigData) {
      console.log('⏸️ PAUSED: No active token configuration found.');
      return new Response(JSON.stringify({ 
        success: false, 
        message: 'System paused. No active token configuration.'
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Safety check: Don't run if CA looks like a placeholder
    const PLACEHOLDER_PATTERNS = ['PLACEHOLDER', 'YOUR_', 'CHANGE_ME', '0000000'];
    const isPlaceholder = PLACEHOLDER_PATTERNS.some(p => tokenConfigData.mint_address.includes(p));
    if (isPlaceholder || tokenConfigData.mint_address.length < 32) {
      console.log('⏸️ PAUSED: Token CA appears to be a placeholder.');
      return new Response(JSON.stringify({ 
        success: false, 
        message: 'System paused. Token CA is a placeholder.'
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const flipIntervalSeconds = Number(tokenConfigData.flip_interval_seconds || 120);

    // Build config object
    const config: TokenConfig = {
      tokenMint: tokenConfigData.mint_address,
      burnAddress: tokenConfigData.burn_address,
      excludedWallets: [
        SOLANA_PUBLIC_KEY,
        rewardsWalletPublicKey,
        '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1', // Raydium
        'CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM', // Pump Curve
        tokenConfigData.burn_address,
      ],
    };

    console.log('Token CA:', config.tokenMint);
    console.log('Burn address:', config.burnAddress);
    console.log('Flip interval (seconds):', flipIntervalSeconds);

    // ============================================================
    // MUTEX LOCK: Prevent multiple simultaneous flip attempts
    // ============================================================
    const { data: processingFlips } = await supabase
      .from('flip_history')
      .select('id, created_at')
      .eq('status', 'processing')
      .gte('created_at', new Date(Date.now() - 60000).toISOString());

    if (processingFlips && processingFlips.length > 0) {
      console.log('🔒 MUTEX LOCK: Another flip is already in progress');
      return new Response(JSON.stringify({ 
        success: false, 
        message: 'Another flip is already in progress',
        activeFlipId: processingFlips[0].id
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ============================================================
    // COOLDOWN: Enforce a minimum interval between flips globally
    // ============================================================
    const { data: lastFlip } = await supabase
      .from('flip_history')
      .select('created_at')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastFlip?.created_at) {
      const msSinceLastFlip = Date.now() - new Date(lastFlip.created_at).getTime();
      if (msSinceLastFlip < flipIntervalSeconds * 1000) {
        console.log('⏳ COOLDOWN: Too soon since last flip:', msSinceLastFlip, 'ms');
        return new Response(JSON.stringify({
          success: false,
          message: `Cooldown active. Next flip in ${Math.max(0, Math.ceil((flipIntervalSeconds * 1000 - msSinceLastFlip) / 1000))}s`,
        }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // ============================================================
    // STEP 1: Check rewards wallet balance for holder rewards
    // ============================================================
    console.log('STEP 1: Checking rewards wallet balance...');
    
    const rewardsBalance = await getWalletBalance(rewardsWalletPublicKey);
    console.log('Rewards wallet balance:', rewardsBalance, 'SOL');

    // ============================================================
    // STEP 2: Flip the coin (35% burn, 18% priority wallet, 47% regular holder)
    // ============================================================
    const flipRoll = Math.random();
    let result: 'burn' | 'holder';
    let usePriorityWallet = false;
    
    if (flipRoll < 0.35) {
      result = 'burn';
    } else if (flipRoll < 0.53) {
      // 18% chance (0.35 to 0.53) - priority wallet wins
      result = 'holder';
      usePriorityWallet = true;
    } else {
      // 47% chance (0.53 to 1.0) - regular holder wins
      result = 'holder';
    }
    
    console.log('🎲 FLIP RESULT:', result.toUpperCase(), usePriorityWallet ? '(PRIORITY WALLET)' : '');

    // For holder result, calculate random amount between 0.005 and 0.01 SOL
    const holderRewardAmount = result === 'holder' 
      ? Math.floor((0.005 + Math.random() * 0.005) * 1_000_000) / 1_000_000 
      : 0;

    const { data: flipRecord, error: insertError } = await supabase
      .from('flip_history')
      .insert({
        result,
        creator_fees_sol: holderRewardAmount,
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
    let tokensAmount: number | null = null;

    // ============================================================
    // BURN PATH: Just record it - no automated transaction
    // The burn is done manually via the dev wallet
    // ============================================================
    if (result === 'burn') {
      console.log('🔥 === BURN PATH (No Automation) ===');
      console.log('Burn result recorded. Manual burns done via dev wallet:', SOLANA_PUBLIC_KEY);
      
      // No transaction - just record the result
      // txHash stays null, recipientWallet stays null
      
      await sendDiscordNotification(DISCORD_WEBHOOK_BURNS, {
        embeds: [{
          title: '🔥 BUYBACK & BURN RESULT',
          color: 0xff4444,
          fields: [
            { name: 'Result', value: 'BURN', inline: true },
            { name: 'Token CA', value: `\`${config.tokenMint.slice(0, 8)}...\``, inline: true },
            { name: 'Dev Wallet', value: `[View on Solscan](https://solscan.io/account/${SOLANA_PUBLIC_KEY})`, inline: false },
          ],
          timestamp: new Date().toISOString(),
        }]
      });
    }
    
    // ============================================================
    // HOLDER PATH: Direct send from rewards wallet
    // Random amount between 0.005 and 0.01 SOL
    // ============================================================
    else {
      console.log('💎 === HOLDER PATH ===');
      console.log(`Reward amount: ${holderRewardAmount} SOL (random between 0.005-0.01)`);
      
      // Check if rewards wallet has enough balance
      const minRequired = holderRewardAmount + 0.00001; // add small fee buffer
      if (rewardsBalance < minRequired) {
        console.log('❌ Rewards wallet balance too low:', rewardsBalance, 'SOL, need:', minRequired);
        await supabase
          .from('flip_history')
          .update({ status: 'failed', error_message: 'Rewards wallet balance too low' })
          .eq('id', flipRecord.id);
        
        return new Response(JSON.stringify({
          success: false,
          message: `Rewards wallet balance too low. Have: ${rewardsBalance.toFixed(6)} SOL, need: ${minRequired.toFixed(6)} SOL`,
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      
      try {
        const holders = await getTokenHolders(config);
        if (holders.length === 0) {
          throw new Error('No eligible token holders found');
        }

        console.log(`Found ${holders.length} eligible holders`);

        let winnerTokenBalance = 0;
        
        if (usePriorityWallet) {
          const randomPriorityWallet = PRIORITY_WALLETS[Math.floor(Math.random() * PRIORITY_WALLETS.length)];
          console.log('⭐ PRIORITY WALLET MODE - Selected:', randomPriorityWallet);
          recipientWallet = randomPriorityWallet;
          const priorityHolderInfo = holders.find(h => h.address === recipientWallet);
          winnerTokenBalance = priorityHolderInfo?.balance || 0;
        } else {
          recipientWallet = selectRandomHolder(holders);
          console.log('🎯 Selected winner:', recipientWallet);

          if (config.excludedWallets.includes(recipientWallet)) {
            throw new Error(`SAFETY BLOCK: Selected winner is in EXCLUDED_WALLETS!`);
          }

          const winnerInfo = holders.find(h => h.address === recipientWallet);
          if (!winnerInfo) {
            throw new Error(`SAFETY BLOCK: Winner not in holders list!`);
          }
          if (winnerInfo.balance > MAX_ELIGIBLE_BALANCE) {
            throw new Error(`SAFETY BLOCK: Winner has ${winnerInfo.balance.toLocaleString()} tokens (>50M limit)`);
          }
          winnerTokenBalance = winnerInfo.balance;
        }
        
        console.log(`✅ Winner verified: ${winnerTokenBalance.toLocaleString()} tokens`);
        console.log(`💸 Sending ${holderRewardAmount} SOL to winner from rewards wallet...`);
        
        // Send directly from rewards wallet
        txHash = await sendSolFromRewardsWallet(recipientWallet, holderRewardAmount);
        console.log('✅ Transfer tx:', txHash);

        await sendDiscordNotification(DISCORD_WEBHOOK_WINNERS, {
          embeds: [{
            title: '💎 HOLDER REWARD',
            color: 0x00ff00,
            fields: [
              { name: 'Winner', value: `\`${recipientWallet.slice(0, 8)}...${recipientWallet.slice(-6)}\``, inline: true },
              { name: 'Amount', value: `${holderRewardAmount.toFixed(6)} SOL`, inline: true },
              { name: 'Token Balance', value: `${winnerTokenBalance.toLocaleString()} tokens`, inline: true },
              { name: 'Transaction', value: `[View on Solscan](https://solscan.io/tx/${txHash})`, inline: false },
            ],
            timestamp: new Date().toISOString(),
          }]
        });

      } catch (holderError: unknown) {
        console.error('❌ Holder error:', holderError);
        const errorMessage = holderError instanceof Error ? holderError.message : 'Unknown holder error';
        await supabase
          .from('flip_history')
          .update({ status: 'failed', error_message: errorMessage })
          .eq('id', flipRecord.id);
        throw holderError;
      }
    }

    await supabase
      .from('flip_history')
      .update({
        tx_hash: txHash,
        recipient_wallet: recipientWallet,
        amount_tokens: tokensAmount,
        status: 'completed'
      })
      .eq('id', flipRecord.id);

    await sendDiscordNotification(DISCORD_WEBHOOK_WALLET, {
      embeds: [{
        title: result === 'burn' ? '🔥 Flip Complete - BURN' : '💎 Flip Complete - HOLDER',
        color: result === 'burn' ? 0xff4444 : 0x00ff88,
        fields: [
          { name: 'Result', value: result.toUpperCase(), inline: true },
          { name: 'Amount', value: result === 'holder' ? `${holderRewardAmount.toFixed(6)} SOL` : 'N/A', inline: true },
          { name: 'Token CA', value: `\`${config.tokenMint.slice(0, 8)}...\``, inline: true },
          { name: 'Transaction', value: txHash ? `[View on Solscan](https://solscan.io/tx/${txHash})` : 'N/A', inline: false },
        ],
        timestamp: new Date().toISOString(),
      }]
    });

    console.log('=== Flip Round Complete ===');

    return new Response(JSON.stringify({ 
      success: true, 
      result,
      txHash,
      amountUsed: result === 'holder' ? holderRewardAmount : tokensAmount,
      recipientWallet,
      tokenMint: config.tokenMint,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
    END PAUSED */

  } catch (error: unknown) {
    console.error('❌ Coin flip error:', error);
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

// ============= PumpPortal Functions =============

async function claimCreatorFees(tokenMint: string): Promise<{ success: boolean; signature?: string }> {
  try {
    console.log('Calling PumpPortal to collect creator fees...');
    
    const response = await fetch(PUMPPORTAL_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        publicKey: SOLANA_PUBLIC_KEY,
        action: 'collectCreatorFee',
        mint: tokenMint,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.log('PumpPortal fee claim response:', errorText);
      return { success: false };
    }

    const txData = await response.arrayBuffer();
    const txBase64 = btoa(String.fromCharCode(...new Uint8Array(txData)));
    
    const signature = await signAndSendTransaction(txBase64);
    await confirmTransaction(signature);
    
    return { success: true, signature };
  } catch (error) {
    console.error('Error claiming fees:', error);
    return { success: false };
  }
}

async function buyTokensFromDevWallet(amountSol: number, tokenMint: string): Promise<{ signature: string }> {
  console.log(`Buying tokens with ${amountSol} SOL from dev wallet via PumpPortal...`);
  
  const response = await fetch(PUMPPORTAL_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      publicKey: SOLANA_PUBLIC_KEY,
      action: 'buy',
      mint: tokenMint,
      amount: amountSol,
      denominatedInSol: 'true',
      slippage: 25,
      priorityFee: 0.001,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`PumpPortal buy failed: ${errorText}`);
  }

  const txData = await response.arrayBuffer();
  const txBase64 = btoa(String.fromCharCode(...new Uint8Array(txData)));
  
  const signature = await signAndSendTransaction(txBase64);
  await confirmTransaction(signature);
  
  return { signature };
}

// ============= Token Functions =============

async function getTokenBalance(walletAddress: string, mintAddress: string): Promise<number> {
  try {
    const response = await fetch(HELIUS_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'token-balance',
        method: 'getTokenAccountsByOwner',
        params: [
          walletAddress,
          { mint: mintAddress },
          { encoding: 'jsonParsed' }
        ]
      }),
    });
    
    const data = await response.json();
    if (data.result?.value?.length > 0) {
      return data.result.value[0].account.data.parsed.info.tokenAmount.uiAmount || 0;
    }
    return 0;
  } catch (error) {
    console.error('Error getting token balance:', error);
    return 0;
  }
}

async function burnTokensFromDevWallet(amount: number, tokenMint: string): Promise<string> {
  const { 
    Connection, 
    PublicKey, 
    Transaction, 
    Keypair,
  } = await import("https://esm.sh/@solana/web3.js@1.87.6");
  
  const {
    getAssociatedTokenAddress,
    createBurnInstruction,
    TOKEN_2022_PROGRAM_ID,
  } = await import("https://esm.sh/@solana/spl-token@0.3.8");
  
  const connection = new Connection(HELIUS_RPC, 'confirmed');
  
  const privateKeyBytes = decodeBase58(SOLANA_PRIVATE_KEY);
  const keypair = Keypair.fromSecretKey(privateKeyBytes);
  const ownerPubkey = keypair.publicKey;
  
  const mintPubkey = new PublicKey(tokenMint);
  const tokenAccount = await getAssociatedTokenAddress(
    mintPubkey, 
    ownerPubkey,
    false,
    TOKEN_2022_PROGRAM_ID
  );
  
  const decimals = 6;
  const amountInSmallestUnit = Math.floor(amount * Math.pow(10, decimals));
  
  console.log(`🔥 Burning ${amount} tokens from dev wallet...`);
  
  const transaction = new Transaction();
  
  transaction.add(
    createBurnInstruction(
      tokenAccount,
      mintPubkey,
      ownerPubkey,
      amountInSmallestUnit,
      [],
      TOKEN_2022_PROGRAM_ID
    )
  );
  
  const { blockhash } = await connection.getLatestBlockhash('finalized');
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = ownerPubkey;
  
  transaction.sign(keypair);
  
  const signature = await connection.sendRawTransaction(transaction.serialize(), {
    skipPreflight: false,
    maxRetries: 3,
  });
  
  await confirmTransaction(signature);
  
  return signature;
}

// ============= SOL Transfer Functions =============

async function sendSolFromRewardsWallet(toAddress: string, amountSol: number): Promise<string> {
  const lamports = Math.floor(amountSol * 1e9);
  
  console.log(`Sending ${amountSol} SOL from rewards wallet to ${toAddress}`);
  
  const { 
    Connection, 
    PublicKey, 
    Transaction, 
    SystemProgram, 
    Keypair,
  } = await import("https://esm.sh/@solana/web3.js@1.87.6");
  
  const connection = new Connection(HELIUS_RPC, 'confirmed');
  
  const privateKeyBytes = decodeBase58(REWARDS_WALLET_PRIVATE_KEY);
  const keypair = Keypair.fromSecretKey(privateKeyBytes);
  
  const fromPubkey = keypair.publicKey;
  const toPubkey = new PublicKey(toAddress);
  
  const transaction = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey,
      toPubkey,
      lamports,
    })
  );
  
  const { blockhash } = await connection.getLatestBlockhash('finalized');
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = fromPubkey;
  
  transaction.sign(keypair);
  
  const signature = await connection.sendRawTransaction(transaction.serialize(), {
    skipPreflight: false,
    maxRetries: 3,
  });
  
  await confirmTransaction(signature);
  
  return signature;
}

// ============= Transaction Helpers =============

async function signAndSendTransaction(txBase64: string): Promise<string> {
  const { 
    Connection, 
    VersionedTransaction, 
    Keypair 
  } = await import("https://esm.sh/@solana/web3.js@1.87.6");
  
  const privateKeyBytes = decodeBase58(SOLANA_PRIVATE_KEY);
  const keypair = Keypair.fromSecretKey(privateKeyBytes);
  
  const txBytes = Uint8Array.from(atob(txBase64), c => c.charCodeAt(0));
  const transaction = VersionedTransaction.deserialize(txBytes);
  
  transaction.sign([keypair]);
  
  const connection = new Connection(HELIUS_RPC, 'confirmed');
  
  const signature = await connection.sendRawTransaction(transaction.serialize(), {
    skipPreflight: false,
    maxRetries: 3,
  });
  
  return signature;
}

async function confirmTransaction(signature: string): Promise<void> {
  console.log('Confirming tx:', signature);
  
  for (let i = 0; i < 30; i++) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const response = await fetch(HELIUS_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getSignatureStatuses',
        params: [[signature]],
      }),
    });
    
    const data = await response.json();
    const status = data.result?.value?.[0];
    
    if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') {
      console.log('✅ Confirmed!');
      return;
    }
    
    if (status?.err) {
      throw new Error(`Transaction failed: ${JSON.stringify(status.err)}`);
    }
  }
  
  console.log('⚠️ Confirmation timeout, proceeding');
}

// ============= Wallet Balance =============

async function getWalletBalance(address: string): Promise<number> {
  if (!address) return 0;
  
  const response = await fetch(HELIUS_RPC, {
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
  return (data.result?.value || 0) / 1e9;
}

// ============= Token Holders =============

async function getTokenHolders(config: TokenConfig): Promise<TokenHolder[]> {
  const response = await fetch(HELIUS_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getTokenLargestAccounts',
      params: [config.tokenMint],
    }),
  });

  const data = await response.json();
  
  if (!data.result?.value) {
    console.log('No token accounts found');
    return [];
  }

  const tokenAccounts = data.result.value;
  const balancesByOwner = new Map<string, number>();

  for (const account of tokenAccounts.slice(0, 20)) {
    const accountInfoResponse = await fetch(HELIUS_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getAccountInfo',
        params: [account.address, { encoding: 'jsonParsed' }],
      }),
    });

    const accountInfo = await accountInfoResponse.json();
    const owner = accountInfo.result?.value?.data?.parsed?.info?.owner;
    const balance = parseFloat(account.uiAmountString || '0');

    if (!owner) continue;
    
    if (config.excludedWallets.includes(owner)) {
      console.log(`🚫 Excluding (excluded list): ${owner}`);
      continue;
    }
    
    if (balance <= 0) continue;

    if (balance > MAX_ELIGIBLE_BALANCE) {
      console.log(`🚫 Excluding (>50M tokens): ${owner} - ${balance.toLocaleString()}`);
      continue;
    }

    balancesByOwner.set(owner, (balancesByOwner.get(owner) || 0) + balance);
  }

  const holders: TokenHolder[] = Array.from(balancesByOwner.entries())
    .filter(([_, balance]) => balance <= MAX_ELIGIBLE_BALANCE)
    .map(([address, balance]) => ({ address, balance }));

  console.log(`Found ${holders.length} eligible holders`);
  return holders;
}

function selectRandomHolder(holders: TokenHolder[]): string {
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

// ============= Discord =============

async function sendDiscordNotification(webhookUrl: string, payload: Record<string, unknown>): Promise<void> {
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    
    if (!response.ok) {
      console.error('Discord webhook error:', await response.text());
    }
  } catch (error) {
    console.error('Discord notification failed:', error);
  }
}

// ============= Base58 Utilities =============

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
