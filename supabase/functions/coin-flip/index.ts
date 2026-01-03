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

const TOKEN_MINT = '8Se9ec6eAuq2qqYxF2WysCd3dV3qbG1qD4z6wenPpump';
const BURN_ADDRESS = '1nc1nerator11111111111111111111111111111111';
const PUMPPORTAL_API = 'https://pumpportal.fun/api/trade-local';
const HELIUS_RPC = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;

// Excluded wallets (Creator, Raydium, Pump Curve, Bonding Curve, etc.)
const EXCLUDED_WALLETS = [
  SOLANA_PUBLIC_KEY,
  '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1', // Raydium
  'CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM', // Pump Curve
  'CexgPodxeSJmVB8X9oFdg7Q81Dvi3t4MqofGpexjeo2k', // Bonding Curve (top holder)
  BURN_ADDRESS,
];

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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    console.log('=== Starting Coin Flip Round ===');
    console.log('Dev wallet:', SOLANA_PUBLIC_KEY);

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
    // STEP 1: Claim creator fees to dev wallet
    // ============================================================
    console.log('STEP 1: Claiming creator fees to dev wallet...');
    const devBalanceBefore = await getWalletBalance(SOLANA_PUBLIC_KEY);
    console.log('Dev wallet balance BEFORE claim:', devBalanceBefore, 'SOL');
    
    const claimResult = await claimCreatorFees();
    if (claimResult.success) {
      console.log('✅ Claimed fees, tx:', claimResult.signature);
      await new Promise(resolve => setTimeout(resolve, 3000));
    } else {
      console.log('ℹ️ No pending fees to claim');
    }

    const devBalanceAfter = await getWalletBalance(SOLANA_PUBLIC_KEY);
    console.log('Dev wallet balance AFTER claim:', devBalanceAfter, 'SOL');
    
    const claimedFees = Math.max(0, devBalanceAfter - devBalanceBefore);
    console.log('💰 Newly claimed fees:', claimedFees, 'SOL');

    // Minimum threshold - need at least 0.005 SOL claimed to proceed
    const MIN_CLAIMED_FEES = 0.005;
    if (claimedFees < MIN_CLAIMED_FEES) {
      console.log(`🛑 Not enough fees claimed: ${claimedFees} SOL (need ${MIN_CLAIMED_FEES} SOL)`);
      return new Response(JSON.stringify({ 
        success: false, 
        message: `Not enough creator fees claimed. Claimed: ${claimedFees.toFixed(6)} SOL, Need: ${MIN_CLAIMED_FEES} SOL`,
        claimedFees,
        minRequired: MIN_CLAIMED_FEES
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Reserve some for tx fees, use the rest
    const amountToUse = Math.floor((claimedFees - 0.002) * 1000) / 1000;
    console.log('Amount to use for flip:', amountToUse, 'SOL');

    if (amountToUse <= 0) {
      return new Response(JSON.stringify({ 
        success: false, 
        message: 'Claimed amount too small after tx fee reserve' 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ============================================================
    // STEP 2: Flip the coin (50/50)
    // ============================================================
    const result = Math.random() < 0.5 ? 'burn' : 'holder';
    console.log('🎲 FLIP RESULT:', result.toUpperCase());

    // Create flip record
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
        // Buy tokens using dev wallet's SOL (the claimed fees)
        const buyResult = await buyTokensFromDevWallet(amountToUse);
        console.log('✅ Buy tx:', buyResult.signature);
        
        // Wait for token account to update
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // Get token balance in dev wallet
        const tokenBalance = await getTokenBalance(SOLANA_PUBLIC_KEY, TOKEN_MINT);
        console.log('💰 Dev wallet has', tokenBalance.toLocaleString(), 'tokens to burn');
        
        if (tokenBalance > 0) {
          // Transfer ALL tokens from dev wallet to burn address
          console.log('🔥 Transferring tokens to burn address...');
          const burnTx = await transferTokensFromDevWallet(BURN_ADDRESS, tokenBalance);
          txHash = burnTx;
          tokensAmount = tokenBalance;
          console.log('🔥 Burn tx:', burnTx);
        } else {
          txHash = buyResult.signature;
          tokensAmount = 0;
          console.log('⚠️ No tokens received, using buy tx as reference');
        }
        
        // Discord notification
        await sendDiscordNotification(DISCORD_WEBHOOK_BURNS, {
          embeds: [{
            title: '🔥 BUYBACK & BURN',
            color: 0xff4444,
            fields: [
              { name: 'SOL Used', value: `${amountToUse.toFixed(4)} SOL`, inline: true },
              { name: 'Tokens Burned', value: `${tokensAmount?.toLocaleString() || '0'}`, inline: true },
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
        // Get eligible holders (no >50M holders)
        const holders = await getTokenHolders();
        if (holders.length === 0) {
          throw new Error('No eligible token holders found');
        }

        console.log(`Found ${holders.length} eligible holders:`);
        holders.forEach((h, i) => {
          console.log(`  ${i + 1}. ${h.address} - ${h.balance.toLocaleString()} tokens`);
        });

        // Select random holder (weighted by balance)
        recipientWallet = selectRandomHolder(holders);
        console.log('🎯 Selected winner:', recipientWallet);
        
        // SAFETY CHECK: Verify winner is valid
        if (EXCLUDED_WALLETS.includes(recipientWallet)) {
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

        // Get or create TWO hot wallets for multi-hop
        const hotWallet1 = await getOrCreateHotWallet(supabase, 'hot_wallet_1');
        const hotWallet2 = await getOrCreateHotWallet(supabase, 'hot_wallet_2');
        
        console.log('Hot Wallet 1:', hotWallet1.address);
        console.log('Hot Wallet 2:', hotWallet2.address);

        // Calculate amounts (account for tx fees at each hop)
        const txFee = 0.000005; // ~5000 lamports per tx
        const hop1Amount = amountToUse;
        const hop2Amount = hop1Amount - txFee;
        const finalAmount = hop2Amount - txFee;

        console.log(`Hop amounts: ${hop1Amount} → ${hop2Amount} → ${finalAmount} SOL`);

        // HOP 1: Dev Wallet → Hot Wallet 1
        console.log('📤 HOP 1: Dev → Hot Wallet 1');
        const hop1Tx = await sendSolFromDevWallet(hotWallet1.address, hop1Amount);
        console.log('✅ Hop 1 tx:', hop1Tx);
        await new Promise(resolve => setTimeout(resolve, 2000));

        // HOP 2: Hot Wallet 1 → Hot Wallet 2
        console.log('📤 HOP 2: Hot Wallet 1 → Hot Wallet 2');
        const hop2Tx = await sendSolFromHotWallet(hotWallet1, hotWallet2.address, hop2Amount);
        console.log('✅ Hop 2 tx:', hop2Tx);
        await new Promise(resolve => setTimeout(resolve, 2000));

        // HOP 3: Hot Wallet 2 → Winner
        console.log('📤 HOP 3: Hot Wallet 2 → Winner');
        const hop3Tx = await sendSolFromHotWallet(hotWallet2, recipientWallet, finalAmount);
        txHash = hop3Tx;
        console.log('✅ Final tx:', hop3Tx);

        // Update flip record with hot wallets used
        await supabase
          .from('flip_history')
          .update({ 
            hot_wallet_used: `${hotWallet1.address} → ${hotWallet2.address}` 
          })
          .eq('id', flipRecord.id);

        // Discord notification
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

    // Update flip record as completed
    await supabase
      .from('flip_history')
      .update({
        tx_hash: txHash,
        recipient_wallet: recipientWallet,
        amount_tokens: tokensAmount,
        status: 'completed'
      })
      .eq('id', flipRecord.id);

    // Wallet flow notification
    await sendDiscordNotification(DISCORD_WEBHOOK_WALLET, {
      embeds: [{
        title: result === 'burn' ? '🔥 Flip Complete - BURN' : '💎 Flip Complete - HOLDER',
        color: result === 'burn' ? 0xff4444 : 0x00ff88,
        fields: [
          { name: 'Claimed Fees', value: `${claimedFees.toFixed(4)} SOL`, inline: true },
          { name: 'Amount Used', value: `${amountToUse.toFixed(4)} SOL`, inline: true },
          { name: 'Result', value: result.toUpperCase(), inline: true },
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
      claimedFees,
      amountUsed: amountToUse,
      tokensAmount,
      recipientWallet,
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

async function claimCreatorFees(): Promise<{ success: boolean; signature?: string }> {
  try {
    console.log('Calling PumpPortal to collect creator fees...');
    
    const response = await fetch(PUMPPORTAL_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        publicKey: SOLANA_PUBLIC_KEY,
        action: 'collectCreatorFee',
        mint: TOKEN_MINT,
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

async function buyTokensFromDevWallet(amountSol: number): Promise<{ signature: string }> {
  console.log(`Buying tokens with ${amountSol} SOL from dev wallet via PumpPortal...`);
  
  const response = await fetch(PUMPPORTAL_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      publicKey: SOLANA_PUBLIC_KEY,
      action: 'buy',
      mint: TOKEN_MINT,
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

async function transferTokensFromDevWallet(toAddress: string, amount: number): Promise<string> {
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
  
  const mintPubkey = new PublicKey(TOKEN_MINT);
  const toPubkey = new PublicKey(toAddress);
  
  const fromTokenAccount = await getAssociatedTokenAddress(mintPubkey, fromPubkey);
  const toTokenAccount = await getAssociatedTokenAddress(mintPubkey, toPubkey);
  
  const transaction = new Transaction();
  
  // Check if destination token account exists
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

async function getTokenHolders(): Promise<TokenHolder[]> {
  const response = await fetch(HELIUS_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getTokenLargestAccounts',
      params: [TOKEN_MINT],
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
    
    // Skip excluded wallets
    if (EXCLUDED_WALLETS.includes(owner)) {
      console.log(`🚫 Excluding (excluded list): ${owner}`);
      continue;
    }
    
    if (balance <= 0) continue;

    // Skip wallets with >50M tokens
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

async function getOrCreateHotWallet(supabase: any, walletName: string): Promise<HotWallet> {
  // Check for existing wallet with this name tag
  const { data: existingWallets } = await supabase
    .from('hot_wallets')
    .select('*')
    .eq('is_active', true);

  // Find wallet by position (hot_wallet_1 = first, hot_wallet_2 = second)
  const walletIndex = walletName === 'hot_wallet_1' ? 0 : 1;
  
  if (existingWallets && existingWallets.length > walletIndex) {
    const wallet = existingWallets[walletIndex];
    return {
      address: wallet.wallet_address,
      privateKey: wallet.private_key_encrypted,
    };
  }

  // Generate new wallet
  console.log(`🆕 Generating new ${walletName}...`);
  const { Keypair } = await import("https://esm.sh/@solana/web3.js@1.87.6");
  const newKeypair = Keypair.generate();
  
  const newAddress = newKeypair.publicKey.toBase58();
  const privateKeyBase58 = encodeBase58(newKeypair.secretKey);
  
  console.log(`New ${walletName}:`, newAddress);

  await supabase.from('hot_wallets').insert({
    wallet_address: newAddress,
    private_key_encrypted: privateKeyBase58,
    is_active: true,
  });

  return {
    address: newAddress,
    privateKey: privateKeyBase58,
  };
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
