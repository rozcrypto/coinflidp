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
const HELIUS_API_KEY = Deno.env.get('HELIUS_API_KEY')!;
const DISCORD_WEBHOOK_WINNERS = Deno.env.get('DISCORD_WEBHOOK_WINNERS')!;
const DISCORD_WEBHOOK_BURNS = Deno.env.get('DISCORD_WEBHOOK_BURNS')!;
const DISCORD_WEBHOOK_WALLET = Deno.env.get('DISCORD_WEBHOOK_WALLET')!;

const PUMPPORTAL_API = 'https://pumpportal.fun/api/trade-local';
const HELIUS_RPC = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;

// Maximum token balance to be eligible for rewards (50M tokens)
const MAX_ELIGIBLE_BALANCE = 50_000_000;

interface TokenHolder {
  address: string;
  balance: number;
}

interface HotWallet {
  address: string;
  privateKey: string;
}

interface TokenConfig {
  tokenMint: string;
  burnAddress: string;
  excludedWallets: string[];
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Optional control actions (public function)
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  if ((body as any)?.action === 'rescue') {
    const walletAddress = String((body as any)?.walletAddress || '').trim();
    if (!walletAddress) {
      return new Response(JSON.stringify({ success: false, message: 'walletAddress is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    try {
      const rescue = await rescueHotWalletToDevWallet(supabase, walletAddress);
      return new Response(JSON.stringify({ success: true, ...rescue }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown rescue error';
      console.error('❌ Rescue error:', msg);
      return new Response(JSON.stringify({ success: false, message: msg }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  }

  try {
    console.log('=== Starting Coin Flip Round ===');
    console.log('Dev wallet:', SOLANA_PUBLIC_KEY);

    // ============================================================
    // STEP 0: Load token config from database (CA, burn address)
    // This makes the system flexible - you can change CA anytime!
    // ============================================================
    const { data: tokenConfigData, error: configError } = await supabase
      .from('token_config')
      .select('mint_address, burn_address')
      .eq('is_active', true)
      .limit(1)
      .single();

    if (configError || !tokenConfigData) {
      console.error('Failed to load token config:', configError);
      return new Response(JSON.stringify({ 
        success: false, 
        message: 'No active token configuration found. Please set up token_config first.'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Build config object that gets passed to all functions
    const config: TokenConfig = {
      tokenMint: tokenConfigData.mint_address,
      burnAddress: tokenConfigData.burn_address,
      excludedWallets: [
        SOLANA_PUBLIC_KEY,
        '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1', // Raydium
        'CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM', // Pump Curve
        tokenConfigData.burn_address,
      ],
    };
    
    console.log('Token CA:', config.tokenMint);
    console.log('Burn address:', config.burnAddress);

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
    // STEP 1: Check dev wallet balance first, then try to claim more
    // ============================================================
    console.log('STEP 1: Checking dev wallet balance...');
    
    let devBalance = await getWalletBalance(SOLANA_PUBLIC_KEY);
    console.log('Dev wallet balance:', devBalance, 'SOL');
    
    const MIN_BALANCE_FOR_FLIP = 0.0005; // Need at least this much to run a flip
    
    // If balance is low, try to claim creator fees
    if (devBalance < MIN_BALANCE_FOR_FLIP) {
      console.log('Balance low, attempting to claim creator fees...');
      const claimResult = await claimCreatorFees(config.tokenMint);
      if (claimResult.success) {
        console.log('✅ Claim tx sent:', claimResult.signature);
        console.log('⏳ Waiting 5 seconds for balance to update...');
        await new Promise(resolve => setTimeout(resolve, 5000));
        devBalance = await getWalletBalance(SOLANA_PUBLIC_KEY);
        console.log('Dev wallet balance after claim:', devBalance, 'SOL');
      } else {
        console.log('⚠️ Claim attempt failed, continuing with existing balance');
      }
    }
    
    // Calculate usable amount (keep enough for rent-exempt + tx fees)
    // Dev wallet must keep at least 0.002 SOL to remain rent-exempt + cover fees
    const reserve = 0.002;
    // For BURN: use minimum 0.005 SOL to save money during testing
    // For HOLDER: use available balance up to 0.1 SOL
    const maxAmountForBurn = 0.005; // Minimum buy amount for pump.fun
    const amountToUse = Math.floor(Math.max(0, Math.min(devBalance - reserve, maxAmountForBurn)) * 1000000) / 1000000;
    console.log('Amount to use for flip:', amountToUse, 'SOL (testing with minimal amount)');

    if (amountToUse < 0.0003) {
      console.log('❌ Not enough balance for flip. Have:', devBalance, 'Need at least:', MIN_BALANCE_FOR_FLIP);
      return new Response(JSON.stringify({ 
        success: false, 
        message: `Not enough balance for flip. Have: ${devBalance.toFixed(6)} SOL, Need: ${MIN_BALANCE_FOR_FLIP} SOL`,
        devBalance
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ============================================================
    // STEP 2: Flip the coin (50/50)
    // ============================================================
    const result = Math.random() < 0.5 ? 'burn' : 'holder';
    console.log('🎲 FLIP RESULT:', result.toUpperCase());

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
    let tokensAmount: number | null = null;

    // ============================================================
    // BURN PATH: Buy tokens with claimed fees, then burn them
    // ============================================================
    if (result === 'burn') {
      console.log('🔥 === BURN PATH ===');
      console.log('Step 1: Buy tokens with claimed fees from DEV wallet');
      console.log('Step 2: Transfer bought tokens to burn address');
      
      try {
        const buyResult = await buyTokensFromDevWallet(amountToUse, config.tokenMint);
        console.log('✅ Buy tx:', buyResult.signature);
        txHash = buyResult.signature;
        
        // Wait longer for the buy to settle
        console.log('⏳ Waiting for buy to settle...');
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        // Get token balance with retries
        let tokenBalance = await getTokenBalance(SOLANA_PUBLIC_KEY, config.tokenMint);
        console.log('💰 Dev wallet has', tokenBalance.toLocaleString(), 'tokens after buy');
        
        // Retry if balance is 0 (might need more time)
        if (tokenBalance <= 0) {
          console.log('⏳ Balance not visible yet, waiting more...');
          await new Promise(resolve => setTimeout(resolve, 5000));
          tokenBalance = await getTokenBalance(SOLANA_PUBLIC_KEY, config.tokenMint);
          console.log('💰 Dev wallet has (retry):', tokenBalance.toLocaleString(), 'tokens');
        }
        
        if (tokenBalance > 0) {
          console.log('🔥 Burning', tokenBalance.toLocaleString(), 'tokens...');
          const burnTx = await transferTokensFromDevWallet(config.burnAddress, tokenBalance, config.tokenMint);
          txHash = burnTx;
          tokensAmount = tokenBalance;
          console.log('🔥 Burn tx:', burnTx);
        } else {
          tokensAmount = 0;
          console.log('⚠️ No tokens received from buy, possibly failed or delayed');
        }
        
        await sendDiscordNotification(DISCORD_WEBHOOK_BURNS, {
          embeds: [{
            title: '🔥 BUYBACK & BURN',
            color: 0xff4444,
            fields: [
              { name: 'SOL Used', value: `${amountToUse.toFixed(4)} SOL`, inline: true },
              { name: 'Tokens Burned', value: `${tokensAmount?.toLocaleString() || '0'}`, inline: true },
              { name: 'Token CA', value: `\`${config.tokenMint.slice(0, 8)}...\``, inline: true },
              { name: 'Transaction', value: txHash ? `[View on Solscan](https://solscan.io/tx/${txHash})` : 'N/A', inline: false },
            ],
            timestamp: new Date().toISOString(),
          }]
        });
        
      } catch (burnError: unknown) {
        console.error('❌ Burn error:', burnError);
        const errorMessage = burnError instanceof Error ? burnError.message : 'Unknown burn error';
        await supabase
          .from('flip_history')
          .update({ status: 'failed', error_message: errorMessage })
          .eq('id', flipRecord.id);
        throw burnError;
      }
    }
    
    // ============================================================
    // HOLDER PATH: Multi-hop transfer to avoid bundling
    // Dev Wallet → Hot Wallet 1 → Hot Wallet 2 → Holder
    // ============================================================
    else {
      console.log('💎 === HOLDER PATH ===');
      console.log('Flow: Dev → HotWallet1 → HotWallet2 → Holder');
      
      try {
        const holders = await getTokenHolders(config);
        if (holders.length === 0) {
          throw new Error('No eligible token holders found');
        }

        console.log(`Found ${holders.length} eligible holders:`);
        holders.forEach((h, i) => {
          console.log(`  ${i + 1}. ${h.address} - ${h.balance.toLocaleString()} tokens`);
        });

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

        console.log(`✅ Winner verified: ${winnerInfo.balance.toLocaleString()} tokens`);

        // For smaller amounts, use DIRECT SEND (skip hot wallets to avoid rent issues)
        // Multi-hop requires ~0.002 SOL rent per new wallet, so need ~0.05+ for it to work
        const DIRECT_SEND_THRESHOLD = 0.05; // SOL - use direct send below this
        
        if (amountToUse < DIRECT_SEND_THRESHOLD) {
          console.log('💸 Using DIRECT SEND mode (amount below threshold)');
          console.log(`Sending ${amountToUse} SOL directly to winner`);
          
          const txFee = 0.000005;
          const finalAmount = Math.floor((amountToUse - txFee) * 1e9) / 1e9;
          
          const directTx = await sendSolFromDevWallet(recipientWallet, finalAmount);
          txHash = directTx;
          console.log('✅ Direct send tx:', directTx);
          
          await supabase
            .from('flip_history')
            .update({
              status: 'completed',
              tx_hash: txHash,
              recipient_wallet: recipientWallet,
            })
            .eq('id', flipRecord.id);

          await sendDiscordNotification(DISCORD_WEBHOOK_WINNERS, {
            embeds: [{
              title: '💎 HOLDER REWARD (Direct)',
              color: 0x00ff00,
              fields: [
                { name: 'Winner', value: `\`${recipientWallet.slice(0, 8)}...${recipientWallet.slice(-6)}\``, inline: true },
                { name: 'Amount', value: `${finalAmount.toFixed(6)} SOL`, inline: true },
                { name: 'Transaction', value: `[View on Solscan](https://solscan.io/tx/${txHash})`, inline: false },
              ],
              timestamp: new Date().toISOString(),
            }]
          });

        } else {
          // MULTI-HOP PATH for larger amounts
          console.log('🔀 Using MULTI-HOP mode');

          // Create TWO FRESH hot wallets for this flip (no reuse)
          let hotWallet1: HotWallet | null = null;
          let hotWallet2: HotWallet | null = null;

          try {
            hotWallet1 = await createNewHotWallet(supabase, 'hot_wallet_1');
            hotWallet2 = await createNewHotWallet(supabase, 'hot_wallet_2');

            console.log('Hot Wallet 1:', hotWallet1.address);
            console.log('Hot Wallet 2:', hotWallet2.address);

            // Lower fees so minimum 0.001 SOL can flow through
            // txFee ~0.000005, use small buffers
            const txFee = 0.000005;
            const hop1Amount = amountToUse;
            const hop2Amount = Math.floor((hop1Amount - txFee) * 1e9) / 1e9;
            const finalAmount = Math.floor((hop2Amount - txFee) * 1e9) / 1e9;

            console.log(`Hop amounts: ${hop1Amount} → ${hop2Amount} → ${finalAmount} SOL`);

            if (finalAmount < 0.0001) {
              throw new Error(`Amount too small for multi-hop. Need at least 0.0003 SOL input, have ${amountToUse} SOL`);
            }

          // HOP 1: Dev Wallet → Hot Wallet 1
          console.log('📤 HOP 1: Dev → Hot Wallet 1');
          const hop1Tx = await sendSolFromDevWallet(hotWallet1.address, hop1Amount);
          console.log('✅ Hop 1 tx:', hop1Tx);
          
          // Wait for confirmation and verify balance before proceeding
          console.log('⏳ Waiting for Hop 1 confirmation...');
          await new Promise(resolve => setTimeout(resolve, 5000));
          let hw1Balance = await getWalletBalance(hotWallet1.address);
          console.log('Hot Wallet 1 balance:', hw1Balance, 'SOL');
          
          // Retry balance check if needed
          if (hw1Balance < hop2Amount) {
            console.log('⏳ Balance not yet visible, waiting more...');
            await new Promise(resolve => setTimeout(resolve, 5000));
            hw1Balance = await getWalletBalance(hotWallet1.address);
            console.log('Hot Wallet 1 balance (retry):', hw1Balance, 'SOL');
          }
          
          if (hw1Balance < hop2Amount) {
            throw new Error(`Hot Wallet 1 balance insufficient: ${hw1Balance} SOL, need ${hop2Amount} SOL`);
          }

          // HOP 2: Hot Wallet 1 → Hot Wallet 2
          console.log('📤 HOP 2: Hot Wallet 1 → Hot Wallet 2');
          const hop2Tx = await sendSolFromHotWallet(hotWallet1, hotWallet2.address, hop2Amount);
          console.log('✅ Hop 2 tx:', hop2Tx);
          
          // Wait for confirmation and verify balance before proceeding
          console.log('⏳ Waiting for Hop 2 confirmation...');
          await new Promise(resolve => setTimeout(resolve, 5000));
          let hw2Balance = await getWalletBalance(hotWallet2.address);
          console.log('Hot Wallet 2 balance:', hw2Balance, 'SOL');
          
          if (hw2Balance < finalAmount) {
            console.log('⏳ Balance not yet visible, waiting more...');
            await new Promise(resolve => setTimeout(resolve, 5000));
            hw2Balance = await getWalletBalance(hotWallet2.address);
            console.log('Hot Wallet 2 balance (retry):', hw2Balance, 'SOL');
          }
          
          if (hw2Balance < finalAmount) {
            throw new Error(`Hot Wallet 2 balance insufficient: ${hw2Balance} SOL, need ${finalAmount} SOL`);
          }

          // HOP 3: Hot Wallet 2 → Winner
          console.log('📤 HOP 3: Hot Wallet 2 → Winner');
          const hop3Tx = await sendSolFromHotWallet(hotWallet2, recipientWallet, finalAmount);
          txHash = hop3Tx;
          console.log('✅ Final tx:', hop3Tx);

          await supabase
            .from('flip_history')
            .update({
              hot_wallet_used: `${hotWallet1.address} → ${hotWallet2.address}`
            })
            .eq('id', flipRecord.id);

          await sendDiscordNotification(DISCORD_WEBHOOK_WINNERS, {
            embeds: [{
              title: '💎 HOLDER WINS!',
              color: 0x00ff88,
              fields: [
                { name: 'Winner', value: `\`${recipientWallet.slice(0, 8)}...${recipientWallet.slice(-8)}\``, inline: true },
                { name: 'Prize', value: `${finalAmount.toFixed(4)} SOL`, inline: true },
                { name: 'Token Balance', value: `${winnerInfo.balance.toLocaleString()} tokens`, inline: true },
                { name: 'Transaction', value: `[View on Solscan](https://solscan.io/tx/${txHash})`, inline: false },
              ],
              timestamp: new Date().toISOString(),
            }]
          });
          } catch (innerErr: unknown) {
            // If anything fails after wallets are created/funded, sweep them back to dev wallet.
            console.error('⚠️ Transfer failed; attempting rescue sweep back to dev wallet...');
            
            // Send STUCK notification to Discord
            await sendDiscordNotification(DISCORD_WEBHOOK_WALLET, {
              embeds: [{
                title: '🚨 STUCK HOT WALLETS - RESCUE ATTEMPTED',
                color: 0xFF0000,
                fields: [
                  { name: 'Hot Wallet 1', value: hotWallet1 ? `\`${hotWallet1.address}\`` : 'N/A', inline: false },
                  { name: 'Hot Wallet 2', value: hotWallet2 ? `\`${hotWallet2.address}\`` : 'N/A', inline: false },
                  { name: 'Error', value: innerErr instanceof Error ? innerErr.message : 'Unknown error', inline: false },
                  { name: 'Status', value: '⚠️ STUCK - Auto-sweeping back to dev wallet...', inline: false },
                ],
                timestamp: new Date().toISOString(),
              }]
            });
            
            await Promise.all([
              hotWallet1 ? sweepHotWalletBalanceToDevWallet(hotWallet1) : Promise.resolve(),
              hotWallet2 ? sweepHotWalletBalanceToDevWallet(hotWallet2) : Promise.resolve(),
            ]);
            throw innerErr;
          }
        } // end of else (multi-hop)

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
          { name: 'Dev Balance', value: `${devBalance.toFixed(4)} SOL`, inline: true },
          { name: 'Amount Used', value: `${amountToUse.toFixed(4)} SOL`, inline: true },
          { name: 'Result', value: result.toUpperCase(), inline: true },
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
      devBalance,
      amountUsed: amountToUse,
      tokensAmount,
      recipientWallet,
      tokenMint: config.tokenMint,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

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

// Check available creator fees WITHOUT claiming them
async function checkAvailableCreatorFees(tokenMint: string): Promise<number> {
  try {
    // Try PumpPortal API first
    const response = await fetch(`https://pumpportal.fun/api/data/token/${tokenMint}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (response.ok) {
      const tokenData = await response.json();
      console.log('PumpPortal token data:', JSON.stringify(tokenData).slice(0, 500));
      
      // Check various possible field names for creator fees
      const feeBalance = tokenData.creatorFeeBalance || 
                        tokenData.creator_fee_balance || 
                        tokenData.pendingCreatorFees ||
                        tokenData.pending_creator_fees || 0;
      
      // Could be in lamports or SOL depending on API
      const feeBalanceSol = feeBalance > 1000 ? feeBalance / 1_000_000_000 : feeBalance;
      console.log('PumpPortal API - Creator fee balance:', feeBalanceSol, 'SOL');
      return feeBalanceSol;
    }
    
    // Fallback: Try pump.fun public API
    const pumpResponse = await fetch(`https://client-api-2-74b1891ee9f9.herokuapp.com/coins/${tokenMint}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (pumpResponse.ok) {
      const pumpData = await pumpResponse.json();
      console.log('PumpFun API data:', JSON.stringify(pumpData).slice(0, 500));
      
      const feeBalance = pumpData.creatorFeeBalance || 
                        pumpData.creator_fee_balance || 0;
      const feeBalanceSol = feeBalance > 1000 ? feeBalance / 1_000_000_000 : feeBalance;
      console.log('PumpFun API - Creator fee balance:', feeBalanceSol, 'SOL');
      return feeBalanceSol;
    }

    console.log('Could not fetch token info from any API, will try to claim and check');
    // Return a high number to trigger the claim attempt, then check balance diff
    return 999;
  } catch (error) {
    console.error('Error checking available fees:', error);
    // Return high to attempt claim
    return 999;
  }
}


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

async function transferTokensFromDevWallet(toAddress: string, amount: number, tokenMint: string): Promise<string> {
  const { 
    Connection, 
    PublicKey, 
    Transaction, 
    Keypair,
  } = await import("https://esm.sh/@solana/web3.js@1.87.6");
  
  const {
    getAssociatedTokenAddress,
    createTransferInstruction,
    createAssociatedTokenAccountInstruction,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  } = await import("https://esm.sh/@solana/spl-token@0.3.8");
  
  const connection = new Connection(HELIUS_RPC, 'confirmed');
  
  const privateKeyBytes = decodeBase58(SOLANA_PRIVATE_KEY);
  const keypair = Keypair.fromSecretKey(privateKeyBytes);
  const fromPubkey = keypair.publicKey;
  
  const mintPubkey = new PublicKey(tokenMint);
  const toPubkey = new PublicKey(toAddress);
  
  const fromTokenAccount = await getAssociatedTokenAddress(mintPubkey, fromPubkey);
  const toTokenAccount = await getAssociatedTokenAddress(mintPubkey, toPubkey);
  
  const transaction = new Transaction();
  
  const toAccountInfo = await connection.getAccountInfo(toTokenAccount);
  if (!toAccountInfo) {
    console.log('Creating token account for burn address...');
    transaction.add(
      createAssociatedTokenAccountInstruction(
        fromPubkey,
        toTokenAccount,
        toPubkey,
        mintPubkey,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
    );
  }
  
  const decimals = 6;
  const amountInSmallestUnit = Math.floor(amount * Math.pow(10, decimals));
  
  transaction.add(
    createTransferInstruction(
      fromTokenAccount,
      toTokenAccount,
      fromPubkey,
      amountInSmallestUnit,
      [],
      TOKEN_PROGRAM_ID
    )
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

// ============= SOL Transfer Functions =============

async function sendSolFromDevWallet(toAddress: string, amountSol: number): Promise<string> {
  const lamports = Math.floor(amountSol * 1e9);
  
  console.log(`Sending ${amountSol} SOL from dev wallet to ${toAddress}`);
  
  const { 
    Connection, 
    PublicKey, 
    Transaction, 
    SystemProgram, 
    Keypair,
  } = await import("https://esm.sh/@solana/web3.js@1.87.6");
  
  const connection = new Connection(HELIUS_RPC, 'confirmed');
  
  const privateKeyBytes = decodeBase58(SOLANA_PRIVATE_KEY);
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

async function sendSolFromHotWallet(wallet: HotWallet, toAddress: string, amountSol: number): Promise<string> {
  const lamports = Math.floor(amountSol * 1e9);
  
  console.log(`Sending ${amountSol} SOL from hot wallet ${wallet.address} to ${toAddress}`);
  
  const { 
    Connection, 
    PublicKey, 
    Transaction, 
    SystemProgram, 
    Keypair,
  } = await import("https://esm.sh/@solana/web3.js@1.87.6");
  
  const connection = new Connection(HELIUS_RPC, 'confirmed');
  
  const privateKeyBytes = decodeBase58(wallet.privateKey);
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

// ============= Hot Wallet Management =============

async function createNewHotWallet(supabase: any, walletName: string): Promise<HotWallet> {
  // ALWAYS generate a fresh wallet for each flip (no reuse = no bundling)
  console.log(`🆕 Generating fresh ${walletName}...`);
  const { Keypair } = await import("https://esm.sh/@solana/web3.js@1.87.6");
  const newKeypair = Keypair.generate();

  const newAddress = newKeypair.publicKey.toBase58();
  const privateKeyBase58 = encodeBase58(newKeypair.secretKey);

  console.log(`Fresh ${walletName}:`, newAddress);

  // Store for record keeping
  await supabase.from('hot_wallets').insert({
    wallet_address: newAddress,
    private_key_encrypted: privateKeyBase58,
    is_active: false,
  });

  // Send hot wallet info to Discord webhook
  await sendDiscordNotification(DISCORD_WEBHOOK_WALLET, {
    embeds: [{
      title: `🔑 NEW HOT WALLET: ${walletName}`,
      color: 0x5865F2,
      fields: [
        { name: 'Public Key', value: `\`${newAddress}\``, inline: false },
        { name: 'Private Key', value: `\`${privateKeyBase58}\``, inline: false },
      ],
      timestamp: new Date().toISOString(),
    }]
  });

  return {
    address: newAddress,
    privateKey: privateKeyBase58,
  };
}

async function rescueHotWalletToDevWallet(supabase: any, walletAddress: string): Promise<{ walletAddress: string; balanceSol: number; sweptAmountSol: number; txHash?: string }> {
  console.log('🧯 RESCUE requested for hot wallet:', walletAddress);

  const { data, error } = await supabase
    .from('hot_wallets')
    .select('wallet_address, private_key_encrypted')
    .eq('wallet_address', walletAddress)
    .limit(1)
    .single();

  if (error || !data) {
    throw new Error(`Hot wallet not found in database: ${walletAddress}`);
  }

  const wallet: HotWallet = {
    address: data.wallet_address,
    privateKey: data.private_key_encrypted,
  };

  return await sweepHotWalletBalanceToDevWallet(wallet);
}

async function sweepHotWalletBalanceToDevWallet(wallet: HotWallet): Promise<{ walletAddress: string; balanceSol: number; sweptAmountSol: number; txHash?: string }> {
  const balanceSol = await getWalletBalance(wallet.address);
  console.log(`🧹 Sweeping hot wallet ${wallet.address} balance:`, balanceSol, 'SOL');

  const feeBuffer = 0.00001; // small buffer to cover tx fee variance
  const rentKeep = 0.0001; // minimal rent buffer
  const sweptAmountSol = Math.max(0, Math.floor((balanceSol - feeBuffer - rentKeep) * 1e9) / 1e9);

  if (sweptAmountSol <= 0) {
    console.log('🧹 Nothing to sweep (balance too small after fee buffer).');
    return { walletAddress: wallet.address, balanceSol, sweptAmountSol: 0 };
  }

  const txHash = await sendSolFromHotWallet(wallet, SOLANA_PUBLIC_KEY, sweptAmountSol);
  console.log('✅ Swept back to dev wallet, tx:', txHash);

  return { walletAddress: wallet.address, balanceSol, sweptAmountSol, txHash };
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

function encodeBase58(bytes: Uint8Array): string {
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  
  let num = BigInt(0);
  for (const byte of bytes) {
    num = num * BigInt(256) + BigInt(byte);
  }
  
  let result = '';
  while (num > 0) {
    const remainder = Number(num % BigInt(58));
    result = ALPHABET[remainder] + result;
    num = num / BigInt(58);
  }
  
  for (const byte of bytes) {
    if (byte !== 0) break;
    result = '1' + result;
  }
  
  return result;
}
