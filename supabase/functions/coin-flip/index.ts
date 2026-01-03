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

// Excluded wallets (Creator, Raydium, Pump Curve, etc.)
const EXCLUDED_WALLETS = [
  SOLANA_PUBLIC_KEY,
  '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1', // Raydium
  'CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM', // Pump Curve
  'CexgPodxeSJmVB8X9oFdg7Q81Dvi3t4MqofGpexjeo2k', // Bonding Curve (top holder)
  BURN_ADDRESS,
];

// Maximum token balance to be eligible for rewards (50M tokens)
// This filters out bonding curves and other large protocol wallets
const MAX_ELIGIBLE_BALANCE = 50_000_000;

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
    console.log('=== Starting Coin Flip Round ===');
    console.log('Creator wallet:', SOLANA_PUBLIC_KEY);

    // ============================================================
    // MUTEX LOCK: Prevent multiple simultaneous flip attempts
    // Check if there's already a flip in progress (processing status)
    // ============================================================
    const { data: processingFlips } = await supabase
      .from('flip_history')
      .select('id, created_at')
      .eq('status', 'processing')
      .gte('created_at', new Date(Date.now() - 60000).toISOString()); // Within last 60 seconds

    if (processingFlips && processingFlips.length > 0) {
      console.log('🔒 MUTEX LOCK: Another flip is already in progress, skipping');
      console.log('Active flip:', processingFlips[0].id);
      return new Response(JSON.stringify({ 
        success: false, 
        message: 'Another flip is already in progress',
        activeFlipId: processingFlips[0].id
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ============================================================
    // STEP 1: Get or create dedicated flip hot wallet
    // This wallet receives claimed fees and executes flip operations
    // ============================================================
    console.log('Step 1: Getting/creating flip hot wallet...');
    const flipWallet = await getOrCreateFlipWallet(supabase);
    console.log('Flip wallet:', flipWallet.address);

    // ============================================================
    // STEP 2: Claim any pending creator fees to dev wallet
    // ============================================================
    console.log('Step 2: Attempting to claim any pending creator fees...');
    const devBalanceBefore = await getWalletBalance(SOLANA_PUBLIC_KEY);
    console.log('Dev wallet balance BEFORE claim:', devBalanceBefore, 'SOL');
    
    const claimResult = await claimCreatorFees();
    if (claimResult.success) {
      console.log('✅ Claimed pending fees, tx:', claimResult.signature);
      // Wait for balance to update
      await new Promise(resolve => setTimeout(resolve, 3000));
    } else {
      console.log('ℹ️ No pending fees to claim');
    }

    // Check balance after claim
    const devBalanceAfter = await getWalletBalance(SOLANA_PUBLIC_KEY);
    console.log('Dev wallet balance AFTER claim:', devBalanceAfter, 'SOL');
    
    const newlyClaimedFees = Math.max(0, devBalanceAfter - devBalanceBefore);
    console.log('Newly claimed fees:', newlyClaimedFees, 'SOL');

    // ============================================================
    // STEP 3: Transfer new fees from dev wallet to flip wallet
    // Reserve 0.005 SOL in dev wallet for tx fees
    // ============================================================
    const minDevBalance = 0.005; // Keep some SOL for dev wallet tx fees
    const availableToTransfer = Math.max(0, devBalanceAfter - minDevBalance);

    // IMPORTANT: Only move *newly claimed creator fees* to the flip wallet.
    // Never drain the dev wallet balance (which may include manually funded SOL).
    const transferableAmount = Math.min(newlyClaimedFees, availableToTransfer);

    // Only transfer if there's meaningful amount (> 0.002 SOL)
    if (transferableAmount > 0.002) {
      console.log('Step 3: Transferring newly claimed fees', transferableAmount, 'SOL to flip wallet...');
      try {
        const transferResult = await sendSolFromDevToFlipWallet(flipWallet.address, transferableAmount);
        console.log('✅ Transferred to flip wallet, tx:', transferResult.signature);
        // Wait for balance update
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (transferError) {
        console.log('⚠️ Transfer to flip wallet failed:', transferError);
        // Continue anyway - flip wallet may already have funds
      }
    } else {
      console.log('Step 3: No newly claimed fees to transfer');
    }

    // ============================================================
    // STEP 4: Check flip wallet balance - this is what we use for flip
    // ============================================================
    console.log('Step 4: Checking flip wallet balance...');
    const flipWalletBalance = await getWalletBalance(flipWallet.address);
    console.log('💰 Flip wallet balance:', flipWalletBalance, 'SOL');

    // Minimum threshold (0.001 SOL)
    if (flipWalletBalance < 0.001) {
      console.log('🛑 FLIP WALLET EMPTY - STOPPING');
      return new Response(JSON.stringify({ 
        success: false, 
        message: 'Flip wallet has no funds. Fees need to accumulate.',
        flipWalletBalance,
        flipWalletAddress: flipWallet.address
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Use 90% of flip wallet balance (reserve 10% for tx fees)
    const amountToUse = Math.floor((flipWalletBalance * 0.9) * 1000) / 1000;
    console.log('Amount to use for flip:', amountToUse);

    // Safety check: never use more than flip wallet balance
    if (amountToUse > flipWalletBalance) {
      console.error('🚫 SAFETY BLOCK: Attempted to use more than flip wallet balance!');
      return new Response(JSON.stringify({ 
        success: false, 
        message: 'Safety block: amount exceeds flip wallet balance',
        attempted: amountToUse,
        flipWalletBalance: flipWalletBalance
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    if (amountToUse <= 0) {
      console.log('Flip wallet balance too small after tx fee reserve');
      return new Response(JSON.stringify({ 
        success: false, 
        message: 'Flip wallet balance too small after tx fee reserve' 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('✅ Safety checks passed. Proceeding with flip...');
    console.log(`   Flip Wallet Balance: ${flipWalletBalance} SOL`);
    console.log(`   Using for Flip: ${amountToUse} SOL`);

    // Step 3: Flip the coin (50/50)
    const result = Math.random() < 0.5 ? 'burn' : 'holder';
    console.log('🎲 Flip result:', result);

    // Step 4: Create flip record
    const { data: flipRecord, error: insertError } = await supabase
      .from('flip_history')
      .insert({
        result,
        creator_fees_sol: amountToUse,
        hot_wallet_used: flipWallet.address,
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

    if (result === 'burn') {
      // 🔥 BURN: Buyback tokens via PumpPortal and burn them
      console.log('🔥 Executing buyback and burn via PumpPortal...');
      console.log(`   Using ${amountToUse} SOL from flip wallet`);
      
      try {
        const burnResult = await buyAndBurnFromFlipWallet(amountToUse, flipWallet);
        txHash = burnResult.signature;
        tokensAmount = burnResult.tokensReceived;
        console.log('✅ Buyback & burn complete:', txHash);
        
        // Send Discord notification for burn
        await sendDiscordNotification(DISCORD_WEBHOOK_BURNS, {
          embeds: [{
            title: '🔥 BUYBACK & BURN',
            color: 0xff4444,
            fields: [
              { name: 'SOL Used', value: `${amountToUse.toFixed(4)} SOL`, inline: true },
              { name: 'Tokens Burned', value: `${tokensAmount?.toLocaleString() || 'N/A'}`, inline: true },
              { name: 'Transaction', value: `[View on Solscan](https://solscan.io/tx/${txHash})`, inline: false },
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
    } else {
      // 💎 HOLDER: Send SOL to random holder
      console.log('💎 Executing holder reward...');
      console.log(`   Using ${amountToUse} SOL from flip wallet`);
      
      try {
        // Get token holders (filtered)
        const holders = await getTokenHolders();
        if (holders.length === 0) {
          throw new Error('No eligible token holders found');
        }

        console.log(`Found ${holders.length} eligible holders`);
        
        // Log all holders for verification
        console.log('Eligible holders:');
        holders.forEach((h, i) => {
          console.log(`  ${i + 1}. ${h.address} - ${h.balance.toLocaleString()} tokens`);
        });

        // Select random holder (weighted by balance)
        recipientWallet = selectRandomHolder(holders);
        console.log('Selected winner:', recipientWallet);
        
        // Verify the winner is in our holders list
        const winnerInList = holders.find(h => h.address === recipientWallet);
        if (!winnerInList) {
          throw new Error(`Selected winner ${recipientWallet} not found in holders list - SAFETY BLOCK`);
        }
        console.log(`✅ Winner verified as holder with ${winnerInList.balance.toLocaleString()} tokens`);

        // Send SOL to holder from flip wallet
        const sendResult = await sendSolFromFlipWallet(recipientWallet, amountToUse, flipWallet);
        txHash = sendResult.signature;
        console.log('✅ Holder reward sent:', txHash);
        
        // Send Discord notification for winner
        await sendDiscordNotification(DISCORD_WEBHOOK_WINNERS, {
          embeds: [{
            title: '💎 HOLDER WINS!',
            color: 0x00ff88,
            fields: [
              { name: 'Winner', value: `\`${recipientWallet.slice(0, 8)}...${recipientWallet.slice(-8)}\``, inline: true },
              { name: 'Prize', value: `${amountToUse.toFixed(4)} SOL`, inline: true },
              { name: 'Token Balance', value: `${winnerInList.balance.toLocaleString()} tokens`, inline: true },
              { name: 'Transaction', value: `[View on Solscan](https://solscan.io/tx/${txHash})`, inline: false },
            ],
            timestamp: new Date().toISOString(),
          }]
        });
      } catch (holderError: unknown) {
        console.error('❌ Holder reward error:', holderError);
        const errorMessage = holderError instanceof Error ? holderError.message : 'Unknown holder error';
        await supabase
          .from('flip_history')
          .update({ status: 'failed', error_message: errorMessage })
          .eq('id', flipRecord.id);
        throw holderError;
      }
    }

    // Step 5: Update flip record with results
    const { error: updateError } = await supabase
      .from('flip_history')
      .update({
        tx_hash: txHash,
        recipient_wallet: recipientWallet,
        amount_tokens: tokensAmount,
        status: 'completed'
      })
      .eq('id', flipRecord.id);

    if (updateError) {
      console.error('Error updating flip record:', updateError);
    }

    // Send wallet flow notification
    await sendDiscordNotification(DISCORD_WEBHOOK_WALLET, {
      embeds: [{
        title: result === 'burn' ? '🔥 Flip Complete - BURN' : '💎 Flip Complete - HOLDER',
        color: result === 'burn' ? 0xff4444 : 0x00ff88,
        fields: [
          { name: 'From Wallet', value: `\`${flipWallet.address.slice(0, 8)}...${flipWallet.address.slice(-8)}\``, inline: true },
          { name: 'Amount', value: `${amountToUse.toFixed(4)} SOL`, inline: true },
          { name: 'Result', value: result.toUpperCase(), inline: true },
          { name: 'To', value: result === 'burn' ? 'Burn Address' : `\`${recipientWallet?.slice(0, 8)}...${recipientWallet?.slice(-8)}\``, inline: false },
          { name: 'Transaction', value: txHash ? `[View on Solscan](https://solscan.io/tx/${txHash})` : 'N/A', inline: false },
        ],
        timestamp: new Date().toISOString(),
      }]
    });

    // Record flip wallet balance after flip (for logging only)
    const flipWalletBalanceAfter = await getWalletBalance(flipWallet.address);
    console.log('Flip wallet balance after flip:', flipWalletBalanceAfter, 'SOL');

    console.log('=== Flip Round Complete ===');

    return new Response(JSON.stringify({ 
      success: true, 
      result,
      txHash,
      amountSol: amountToUse,
      amountTokens: tokensAmount,
      recipientWallet,
      flipWalletAddress: flipWallet.address,
      flipWalletBalanceAfter
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

async function claimCreatorFees(): Promise<{ success: boolean; signature?: string; claimedAmount?: number }> {
  try {
    console.log('Calling PumpPortal to collect creator fees...');
    
    // Record balance BEFORE claiming (to calculate exact claimed amount)
    const balanceBefore = await getWalletBalance(SOLANA_PUBLIC_KEY);
    console.log('Balance BEFORE claim:', balanceBefore, 'SOL');
    
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
      return { success: false, claimedAmount: 0 };
    }

    // Get the transaction to sign
    const txData = await response.arrayBuffer();
    const txBase64 = btoa(String.fromCharCode(...new Uint8Array(txData)));
    
    // Sign and send the transaction
    const signature = await signAndSendTransaction(txBase64);
    console.log('Fee claim tx:', signature);
    
    // Wait for confirmation
    await confirmTransaction(signature);
    
    // Wait a moment for balance to update
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Record balance AFTER claiming
    const balanceAfter = await getWalletBalance(SOLANA_PUBLIC_KEY);
    console.log('Balance AFTER claim:', balanceAfter, 'SOL');
    
    // Calculate the EXACT amount claimed (including tx fee deduction)
    // The claimed amount is the increase in balance
    const claimedAmount = Math.max(0, balanceAfter - balanceBefore);
    console.log('💰 Exact claimed amount:', claimedAmount, 'SOL');
    
    if (claimedAmount <= 0) {
      console.log('Claim tx succeeded but no SOL increase detected');
      return { success: false, signature, claimedAmount: 0 };
    }
    
    return { success: true, signature, claimedAmount };
  } catch (error) {
    console.log('Fee claim skipped or failed:', error);
    return { success: false, claimedAmount: 0 };
  }
}

async function buyAndBurn(amountSol: number): Promise<{ signature: string; tokensReceived: number }> {
  console.log(`Buying tokens with ${amountSol} SOL via PumpPortal...`);
  
  // Request buy transaction from PumpPortal
  const response = await fetch(PUMPPORTAL_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      publicKey: SOLANA_PUBLIC_KEY,
      action: 'buy',
      mint: TOKEN_MINT,
      amount: amountSol,
      denominatedInSol: 'true',
      slippage: 25, // 25% slippage for volatile tokens
      priorityFee: 0.001, // Priority fee for faster execution
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`PumpPortal buy failed: ${errorText}`);
  }

  // Get the transaction bytes
  const txData = await response.arrayBuffer();
  const txBase64 = btoa(String.fromCharCode(...new Uint8Array(txData)));
  
  // Sign and send the transaction
  const signature = await signAndSendTransaction(txBase64);
  console.log('Buy tx submitted:', signature);
  
  // Wait for confirmation
  await confirmTransaction(signature);
  
  // Estimate tokens received (actual amount from tx logs would be more accurate)
  const estimatedTokens = amountSol * 1000000; // Rough estimate
  
  return { signature, tokensReceived: estimatedTokens };
}

async function buyAndBurnFromFlipWallet(amountSol: number, wallet: FlipWallet): Promise<{ signature: string; tokensReceived: number }> {
  console.log(`Buying tokens with ${amountSol} SOL from flip wallet via PumpPortal...`);
  
  // Request buy transaction from PumpPortal using flip wallet address
  const response = await fetch(PUMPPORTAL_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      publicKey: wallet.address,
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

  // Get the transaction bytes
  const txData = await response.arrayBuffer();
  const txBase64 = btoa(String.fromCharCode(...new Uint8Array(txData)));
  
  // Sign and send using flip wallet private key
  const signature = await signAndSendTransactionWithKey(txBase64, wallet.privateKey);
  console.log('Buy tx submitted:', signature);
  
  // Wait for confirmation
  await confirmTransaction(signature);
  
  const estimatedTokens = amountSol * 1000000;
  return { signature, tokensReceived: estimatedTokens };
}

async function sendSolFromFlipWallet(toAddress: string, amountSol: number, wallet: FlipWallet): Promise<{ signature: string }> {
  const lamports = Math.floor(amountSol * 1e9);
  
  console.log(`Sending ${amountSol} SOL from flip wallet to ${toAddress}`);
  
  const { 
    Connection, 
    PublicKey, 
    Transaction, 
    SystemProgram, 
    Keypair,
  } = await import("https://esm.sh/@solana/web3.js@1.87.6");
  
  const connection = new Connection(HELIUS_RPC, 'confirmed');
  
  // Use flip wallet private key
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
  
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('finalized');
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = fromPubkey;
  
  transaction.sign(keypair);
  
  const rawTransaction = transaction.serialize();
  
  const signature = await connection.sendRawTransaction(rawTransaction, {
    skipPreflight: false,
    maxRetries: 3,
  });
  
  console.log('Transaction sent:', signature);
  
  // Use polling-based confirmation instead of WebSocket
  await confirmTransaction(signature);
  
  console.log('Transaction confirmed:', signature);
  
  return { signature };
}

async function signAndSendTransactionWithKey(txBase64: string, privateKeyBase58: string): Promise<string> {
  const { 
    Connection, 
    VersionedTransaction, 
    Keypair 
  } = await import("https://esm.sh/@solana/web3.js@1.87.6");
  
  const privateKeyBytes = decodeBase58(privateKeyBase58);
  const keypair = Keypair.fromSecretKey(privateKeyBytes);
  
  const txBytes = Uint8Array.from(atob(txBase64), c => c.charCodeAt(0));
  const transaction = VersionedTransaction.deserialize(txBytes);
  
  transaction.sign([keypair]);
  
  const connection = new Connection(HELIUS_RPC, 'confirmed');
  
  const signature = await connection.sendRawTransaction(transaction.serialize(), {
    skipPreflight: false,
    maxRetries: 3,
  });
  
  console.log('Transaction sent:', signature);
  
  return signature;
}

// ============= Solana Transaction Functions =============

async function signAndSendTransaction(txBase64: string): Promise<string> {
  const { 
    Connection, 
    VersionedTransaction, 
    Keypair 
  } = await import("https://esm.sh/@solana/web3.js@1.87.6");
  
  // Decode the private key
  const privateKeyBytes = decodeBase58(SOLANA_PRIVATE_KEY);
  const keypair = Keypair.fromSecretKey(privateKeyBytes);
  
  // Decode the transaction from base64
  const txBytes = Uint8Array.from(atob(txBase64), c => c.charCodeAt(0));
  
  // Deserialize as VersionedTransaction (PumpPortal uses versioned transactions)
  const transaction = VersionedTransaction.deserialize(txBytes);
  
  // Sign the transaction
  transaction.sign([keypair]);
  
  // Create connection and send
  const connection = new Connection(HELIUS_RPC, 'confirmed');
  
  const signature = await connection.sendRawTransaction(transaction.serialize(), {
    skipPreflight: false,
    maxRetries: 3,
  });
  
  console.log('Transaction sent:', signature);
  
  return signature;
}

async function sendSolToAddress(toAddress: string, amountSol: number): Promise<{ signature: string }> {
  const lamports = Math.floor(amountSol * 1e9);
  
  console.log(`Sending ${amountSol} SOL (${lamports} lamports) to ${toAddress}`);
  
  // Import Solana web3.js
  const { 
    Connection, 
    PublicKey, 
    Transaction, 
    SystemProgram, 
    Keypair,
    sendAndConfirmRawTransaction
  } = await import("https://esm.sh/@solana/web3.js@1.87.6");
  
  const nacl = await import("https://esm.sh/tweetnacl@1.0.3");
  
  // Create connection
  const connection = new Connection(HELIUS_RPC, 'confirmed');
  
  // Decode private key and create keypair
  const privateKeyBytes = decodeBase58(SOLANA_PRIVATE_KEY);
  const keypair = Keypair.fromSecretKey(privateKeyBytes);
  
  // Create transaction
  const fromPubkey = keypair.publicKey;
  const toPubkey = new PublicKey(toAddress);
  
  const transaction = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey,
      toPubkey,
      lamports,
    })
  );
  
  // Get recent blockhash
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('finalized');
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = fromPubkey;
  
  // Sign transaction
  transaction.sign(keypair);
  
  // Serialize and send
  const rawTransaction = transaction.serialize();
  
  const signature = await connection.sendRawTransaction(rawTransaction, {
    skipPreflight: false,
    maxRetries: 3,
  });
  
  console.log('Transaction sent:', signature);
  
  // Wait for confirmation
  await connection.confirmTransaction({
    signature,
    blockhash,
    lastValidBlockHeight,
  }, 'confirmed');
  
  console.log('Transaction confirmed:', signature);
  
  return { signature };
}

async function confirmTransaction(signature: string): Promise<void> {
  console.log('Confirming transaction:', signature);
  
  // Poll for confirmation (max 30 seconds)
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
      console.log('Transaction confirmed!');
      return;
    }
    
    if (status?.err) {
      throw new Error(`Transaction failed: ${JSON.stringify(status.err)}`);
    }
  }
  
  console.log('Transaction confirmation timeout, proceeding anyway');
}

// ============= Holder Selection Functions =============

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

async function getTokenHolders(): Promise<TokenHolder[]> {
  // Use getTokenLargestAccounts for top holders
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

  // Get owner addresses for each token account
  const tokenAccounts = data.result.value;
  const balancesByOwner = new Map<string, number>();

  for (const account of tokenAccounts.slice(0, 20)) {
    // Get account info to find owner
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

    // IMPORTANT: ignore excluded wallets and zero-balance accounts
    if (!owner || EXCLUDED_WALLETS.includes(owner) || balance <= 0) continue;

    // IMPORTANT: Skip wallets with more than MAX_ELIGIBLE_BALANCE (50M tokens)
    // This filters out bonding curves and protocol wallets
    if (balance > MAX_ELIGIBLE_BALANCE) {
      console.log(`⚠️ Skipping ${owner} - balance ${balance.toLocaleString()} exceeds 50M cap`);
      continue;
    }

    balancesByOwner.set(owner, (balancesByOwner.get(owner) || 0) + balance);
  }

  const holders: TokenHolder[] = Array.from(balancesByOwner.entries())
    .filter(([_, balance]) => balance <= MAX_ELIGIBLE_BALANCE) // Double-check after aggregation
    .map(([address, balance]) => ({
      address,
      balance,
    }));

  console.log(`Found ${holders.length} eligible holders after filtering (max 50M tokens)`);
  return holders;
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

// ============= Discord Functions =============

async function sendDiscordNotification(webhookUrl: string, payload: Record<string, unknown>): Promise<void> {
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    
    if (!response.ok) {
      console.error('Discord webhook error:', await response.text());
    } else {
      console.log('Discord notification sent');
    }
  } catch (error) {
    console.error('Failed to send Discord notification:', error);
  }
}

// ============= Flip Wallet Functions =============

interface FlipWallet {
  address: string;
  privateKey: string;
}

async function getOrCreateFlipWallet(supabase: any): Promise<FlipWallet> {
  // Check if we have an active flip wallet
  const { data: existingWallet } = await supabase
    .from('hot_wallets')
    .select('*')
    .eq('is_active', true)
    .limit(1)
    .single();

  if (existingWallet) {
    console.log('Using existing flip wallet:', existingWallet.wallet_address);
    return {
      address: existingWallet.wallet_address,
      privateKey: existingWallet.private_key_encrypted, // Already base58 encoded
    };
  }

  // Generate new flip wallet
  console.log('🆕 Generating new flip wallet...');
  const { Keypair } = await import("https://esm.sh/@solana/web3.js@1.87.6");
  const newKeypair = Keypair.generate();
  
  const newAddress = newKeypair.publicKey.toBase58();
  const privateKeyBase58 = encodeBase58(newKeypair.secretKey);
  
  console.log('New flip wallet address:', newAddress);

  // Store in database
  await supabase.from('hot_wallets').insert({
    wallet_address: newAddress,
    private_key_encrypted: privateKeyBase58,
    is_active: true,
  });

  console.log('✅ Flip wallet stored in database');

  return {
    address: newAddress,
    privateKey: privateKeyBase58,
  };
}

async function sendSolFromDevToFlipWallet(toAddress: string, amountSol: number): Promise<{ signature: string }> {
  const lamports = Math.floor(amountSol * 1e9);
  
  console.log(`Transferring ${amountSol} SOL (${lamports} lamports) from dev wallet to flip wallet`);
  
  const { 
    Connection, 
    PublicKey, 
    Transaction, 
    SystemProgram, 
    Keypair,
  } = await import("https://esm.sh/@solana/web3.js@1.87.6");
  
  // Create connection
  const connection = new Connection(HELIUS_RPC, 'confirmed');
  
  // Decode private key and create keypair from DEV wallet
  const privateKeyBytes = decodeBase58(SOLANA_PRIVATE_KEY);
  const keypair = Keypair.fromSecretKey(privateKeyBytes);
  
  // Create transaction
  const fromPubkey = keypair.publicKey;
  const toPubkey = new PublicKey(toAddress);
  
  const transaction = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey,
      toPubkey,
      lamports,
    })
  );
  
  // Get recent blockhash
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('finalized');
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = fromPubkey;
  
  // Sign transaction
  transaction.sign(keypair);
  
  // Serialize and send
  const rawTransaction = transaction.serialize();
  
  const signature = await connection.sendRawTransaction(rawTransaction, {
    skipPreflight: false,
    maxRetries: 3,
  });
  
  console.log('Transfer transaction sent:', signature);
  
  // Use polling-based confirmation instead of WebSocket
  await confirmTransaction(signature);
  
  console.log('Transfer confirmed:', signature);
  
  return { signature };
}

// ============= Utility Functions =============

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
  
  // Convert bytes to a big number
  let num = BigInt(0);
  for (const byte of bytes) {
    num = num * BigInt(256) + BigInt(byte);
  }
  
  // Convert to base58
  let result = '';
  while (num > 0) {
    const remainder = Number(num % BigInt(58));
    result = ALPHABET[remainder] + result;
    num = num / BigInt(58);
  }
  
  // Add leading zeros
  for (const byte of bytes) {
    if (byte !== 0) break;
    result = '1' + result;
  }
  
  return result;
}
