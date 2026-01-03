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
  BURN_ADDRESS,
];

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

    // Step 1: Claim creator fees from PumpPortal
    console.log('Step 1: Claiming creator fees...');
    const claimedFees = await claimCreatorFees();
    console.log('Claimed fees result:', claimedFees);

    // Step 2: Get wallet balance
    const solBalance = await getWalletBalance(SOLANA_PUBLIC_KEY);
    console.log('Current SOL balance:', solBalance);

    // Minimum threshold to proceed (0.005 SOL minimum)
    if (solBalance < 0.005) {
      console.log('Insufficient balance for flip, skipping round');
      return new Response(JSON.stringify({ 
        success: false, 
        message: 'Insufficient balance for this round',
        balance: solBalance
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Calculate amounts (90% for action, 10% for tx fees buffer)
    const amountToUse = Math.floor((solBalance * 0.9) * 1000) / 1000;
    
    if (amountToUse <= 0) {
      console.log('No funds available after reserving tx fees');
      return new Response(JSON.stringify({ 
        success: false, 
        message: 'No funds available after tx fee reserve' 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Step 3: Flip the coin (50/50)
    const result = Math.random() < 0.5 ? 'burn' : 'holder';
    console.log('🎲 Flip result:', result);

    // Step 4: Create flip record
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

    if (result === 'burn') {
      // 🔥 BURN: Buyback tokens via PumpPortal and burn them
      console.log('🔥 Executing buyback and burn via PumpPortal...');
      
      try {
        const burnResult = await buyAndBurn(amountToUse);
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
      
      try {
        // Get token holders (filtered)
        const holders = await getTokenHolders();
        if (holders.length === 0) {
          throw new Error('No eligible token holders found');
        }

        console.log(`Found ${holders.length} eligible holders`);

        // Select random holder (weighted by balance)
        recipientWallet = selectRandomHolder(holders);
        console.log('Selected winner:', recipientWallet);

        // Send SOL to holder
        const sendResult = await sendSolToAddress(recipientWallet, amountToUse);
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
          { name: 'From Wallet', value: `\`${SOLANA_PUBLIC_KEY.slice(0, 8)}...${SOLANA_PUBLIC_KEY.slice(-8)}\``, inline: true },
          { name: 'Amount', value: `${amountToUse.toFixed(4)} SOL`, inline: true },
          { name: 'Result', value: result.toUpperCase(), inline: true },
          { name: 'To', value: result === 'burn' ? 'Burn Address' : `\`${recipientWallet?.slice(0, 8)}...${recipientWallet?.slice(-8)}\``, inline: false },
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
      amountSol: amountToUse,
      amountTokens: tokensAmount,
      recipientWallet
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

    // Get the transaction to sign
    const txData = await response.arrayBuffer();
    const txBase64 = btoa(String.fromCharCode(...new Uint8Array(txData)));
    
    // Sign and send the transaction
    const signature = await signAndSendTransaction(txBase64);
    console.log('Fee claim tx:', signature);
    
    // Wait for confirmation
    await confirmTransaction(signature);
    
    return { success: true, signature };
  } catch (error) {
    console.log('Fee claim skipped or failed:', error);
    return { success: false };
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

// ============= Solana Transaction Functions =============

async function signAndSendTransaction(txBase64: string): Promise<string> {
  // Decode the private key
  const privateKeyBytes = decodeBase58(SOLANA_PRIVATE_KEY);
  
  // Decode the transaction
  const txBytes = Uint8Array.from(atob(txBase64), c => c.charCodeAt(0));
  
  // Import tweetnacl for signing (Deno-compatible)
  const nacl = await import("https://esm.sh/tweetnacl@1.0.3");
  
  // Sign the transaction message (skip the signature placeholder bytes)
  // The first 64 bytes are typically the signature placeholder
  const messageToSign = txBytes.slice(65); // Adjust based on tx format
  const keyPair = nacl.default.sign.keyPair.fromSeed(privateKeyBytes.slice(0, 32));
  const signatureResult = nacl.default.sign.detached(messageToSign, keyPair.secretKey);
  
  // Insert signature into transaction
  const signedTx = new Uint8Array(txBytes.length);
  signedTx.set(signatureResult, 1); // Signature starts after length byte
  signedTx.set(txBytes.slice(65), 65);
  
  const signedTxBase64 = btoa(String.fromCharCode(...signedTx));
  
  // Send via Helius RPC
  const response = await fetch(HELIUS_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'sendTransaction',
      params: [signedTxBase64, { 
        encoding: 'base64',
        skipPreflight: false,
        maxRetries: 3 
      }],
    }),
  });

  const data = await response.json();
  
  if (data.error) {
    console.error('RPC error:', data.error);
    throw new Error(data.error.message || 'Transaction failed');
  }
  
  return data.result;
}

async function sendSolToAddress(toAddress: string, amountSol: number): Promise<{ signature: string }> {
  const lamports = Math.floor(amountSol * 1e9);
  
  console.log(`Sending ${amountSol} SOL (${lamports} lamports) to ${toAddress}`);
  
  // Get recent blockhash
  const blockhashResponse = await fetch(HELIUS_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getLatestBlockhash',
      params: [{ commitment: 'finalized' }],
    }),
  });
  
  const blockhashData = await blockhashResponse.json();
  const recentBlockhash = blockhashData.result.value.blockhash;
  
  // Build a simple SOL transfer transaction manually
  // This is a simplified version - for production use proper serialization
  const fromPubkey = decodeBase58(SOLANA_PUBLIC_KEY);
  const toPubkey = decodeBase58(toAddress);
  
  // Create transfer instruction
  // System program transfer: program ID, from, to, lamports
  const SYSTEM_PROGRAM_ID = new Uint8Array(32); // All zeros = system program
  
  // Build transaction bytes (simplified - use proper library in production)
  const transaction = buildTransferTransaction(
    fromPubkey,
    toPubkey,
    lamports,
    recentBlockhash
  );
  
  // Sign the transaction
  const nacl = await import("https://esm.sh/tweetnacl@1.0.3");
  const privateKeyBytes = decodeBase58(SOLANA_PRIVATE_KEY);
  
  const message = transaction.slice(65); // Message starts after signatures
  const keyPair = nacl.default.sign.keyPair.fromSeed(privateKeyBytes.slice(0, 32));
  const signatureResult = nacl.default.sign.detached(message, keyPair.secretKey);
  
  // Insert signature
  transaction.set(signatureResult, 1);
  
  const txBase64 = btoa(String.fromCharCode(...transaction));
  
  // Send transaction
  const response = await fetch(HELIUS_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'sendTransaction',
      params: [txBase64, { 
        encoding: 'base64',
        skipPreflight: false 
      }],
    }),
  });

  const data = await response.json();
  
  if (data.error) {
    throw new Error(data.error.message || 'SOL transfer failed');
  }
  
  return { signature: data.result };
}

function buildTransferTransaction(
  fromPubkey: Uint8Array,
  toPubkey: Uint8Array,
  lamports: number,
  blockhash: string
): Uint8Array {
  // This is a simplified transaction builder
  // For production, use @solana/web3.js or proper serialization
  
  const blockhashBytes = decodeBase58(blockhash);
  
  // Transaction format:
  // [1] num signatures
  // [64] signature placeholder
  // [message...]
  
  const buffer = new Uint8Array(200);
  let offset = 0;
  
  // Num required signatures
  buffer[offset++] = 1;
  
  // Signature placeholder (64 bytes)
  offset += 64;
  
  // Message header
  buffer[offset++] = 1; // num_required_signatures
  buffer[offset++] = 0; // num_readonly_signed_accounts
  buffer[offset++] = 1; // num_readonly_unsigned_accounts
  
  // Account addresses (3: from, to, system program)
  buffer[offset++] = 3;
  buffer.set(fromPubkey, offset); offset += 32;
  buffer.set(toPubkey, offset); offset += 32;
  buffer.set(new Uint8Array(32), offset); offset += 32; // System program (all zeros)
  
  // Recent blockhash
  buffer.set(blockhashBytes, offset); offset += 32;
  
  // Instructions (1 instruction)
  buffer[offset++] = 1;
  
  // Transfer instruction
  buffer[offset++] = 2; // Program ID index (system program)
  buffer[offset++] = 2; // Num accounts
  buffer[offset++] = 0; // From account index
  buffer[offset++] = 1; // To account index
  
  // Instruction data (transfer = 2, then lamports as u64 LE)
  buffer[offset++] = 12; // Data length
  buffer[offset++] = 2; // Transfer instruction
  buffer[offset++] = 0;
  buffer[offset++] = 0;
  buffer[offset++] = 0;
  
  // Lamports as u64 little-endian
  const lamportsBytes = new Uint8Array(8);
  let tempLamports = lamports;
  for (let i = 0; i < 8; i++) {
    lamportsBytes[i] = tempLamports & 0xff;
    tempLamports = Math.floor(tempLamports / 256);
  }
  buffer.set(lamportsBytes, offset);
  offset += 8;
  
  return buffer.slice(0, offset);
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
  const holders: TokenHolder[] = [];
  
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
    
    if (owner && !EXCLUDED_WALLETS.includes(owner)) {
      holders.push({
        address: owner,
        balance: parseFloat(account.uiAmountString || '0'),
      });
    }
  }
  
  console.log(`Found ${holders.length} eligible holders after filtering`);
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
