/**
 * ============================================================
 * BUYBACK & BURN SCRIPT
 * ============================================================
 * 
 * This script handles buying tokens using SOL and then burning them.
 * Works with Pump.fun tokens using PumpPortal API and Token-2022 program.
 * 
 * FLOW:
 * 1. Check wallet SOL balance
 * 2. Optionally claim creator fees (if you're the token creator)
 * 3. Buy tokens via PumpPortal API
 * 4. Burn purchased tokens using SPL Token-2022 burn instruction
 * 
 * REQUIRED ENVIRONMENT VARIABLES:
 * - SOLANA_PRIVATE_KEY: Base58 encoded private key of the wallet
 * - SOLANA_PUBLIC_KEY: Public key of the wallet
 * - HELIUS_API_KEY: Your Helius RPC API key
 * 
 * OPTIONAL:
 * - DISCORD_WEBHOOK: Discord webhook URL for notifications
 * 
 * ============================================================
 */

// ==================== CONFIGURATION ====================

interface BuybackBurnConfig {
  tokenMint: string;              // The token CA (Contract Address)
  amountSol: number;              // Amount of SOL to use for buyback
  slippage?: number;              // Slippage tolerance (default: 25%)
  priorityFee?: number;           // Priority fee in SOL (default: 0.001)
  discordWebhook?: string;        // Optional Discord webhook for notifications
}

// ==================== ENVIRONMENT ====================

const SOLANA_PRIVATE_KEY = Deno.env.get('SOLANA_PRIVATE_KEY')!;
const SOLANA_PUBLIC_KEY = Deno.env.get('SOLANA_PUBLIC_KEY')!;
const HELIUS_API_KEY = Deno.env.get('HELIUS_API_KEY')!;
const HELIUS_RPC = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;
const PUMPPORTAL_API = 'https://pumpportal.fun/api/trade-local';

// ==================== MAIN FUNCTION ====================

/**
 * Execute a buyback and burn operation
 * @param config Configuration for the buyback and burn
 * @returns Result with transaction hashes and amounts
 */
export async function executeBuybackAndBurn(config: BuybackBurnConfig): Promise<{
  success: boolean;
  buyTxHash?: string;
  burnTxHash?: string;
  tokensBurned?: number;
  solUsed: number;
  error?: string;
}> {
  const { tokenMint, amountSol, slippage = 25, priorityFee = 0.001 } = config;
  
  console.log('🔥 === BUYBACK & BURN ===');
  console.log('Token:', tokenMint);
  console.log('Amount:', amountSol, 'SOL');
  
  try {
    // Step 1: Check wallet balance
    const balance = await getWalletBalance(SOLANA_PUBLIC_KEY);
    console.log('Wallet balance:', balance, 'SOL');
    
    if (balance < amountSol + 0.001) {
      throw new Error(`Insufficient balance. Have: ${balance} SOL, Need: ${amountSol + 0.001} SOL`);
    }
    
    // Step 2: Buy tokens via PumpPortal
    console.log('📈 Buying tokens via PumpPortal...');
    const buyResult = await buyTokens(tokenMint, amountSol, slippage, priorityFee);
    console.log('✅ Buy tx:', buyResult.signature);
    
    // Step 3: Wait for buy to settle
    console.log('⏳ Waiting for buy to settle...');
    await sleep(5000);
    
    // Step 4: Get token balance
    let tokenBalance = await getTokenBalance(SOLANA_PUBLIC_KEY, tokenMint);
    console.log('💰 Token balance:', tokenBalance.toLocaleString());
    
    // Retry if balance not visible yet
    if (tokenBalance <= 0) {
      console.log('⏳ Balance not visible yet, waiting more...');
      await sleep(5000);
      tokenBalance = await getTokenBalance(SOLANA_PUBLIC_KEY, tokenMint);
      console.log('💰 Token balance (retry):', tokenBalance.toLocaleString());
    }
    
    if (tokenBalance <= 0) {
      return {
        success: false,
        buyTxHash: buyResult.signature,
        solUsed: amountSol,
        error: 'No tokens received from buy (may need more time to settle)',
      };
    }
    
    // Step 5: Burn tokens
    console.log('🔥 Burning', tokenBalance.toLocaleString(), 'tokens...');
    const burnTxHash = await burnTokens(tokenMint, tokenBalance);
    console.log('🔥 Burn tx:', burnTxHash);
    
    // Step 6: Send Discord notification (optional)
    if (config.discordWebhook) {
      await sendDiscordNotification(config.discordWebhook, {
        embeds: [{
          title: '🔥 BUYBACK & BURN COMPLETE',
          color: 0xff4444,
          fields: [
            { name: 'SOL Used', value: `${amountSol.toFixed(4)} SOL`, inline: true },
            { name: 'Tokens Burned', value: tokenBalance.toLocaleString(), inline: true },
            { name: 'Token', value: `\`${tokenMint.slice(0, 8)}...\``, inline: true },
            { name: 'Buy Tx', value: `[View](https://solscan.io/tx/${buyResult.signature})`, inline: true },
            { name: 'Burn Tx', value: `[View](https://solscan.io/tx/${burnTxHash})`, inline: true },
          ],
          timestamp: new Date().toISOString(),
        }]
      });
    }
    
    return {
      success: true,
      buyTxHash: buyResult.signature,
      burnTxHash,
      tokensBurned: tokenBalance,
      solUsed: amountSol,
    };
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('❌ Buyback & Burn error:', errorMessage);
    return {
      success: false,
      solUsed: amountSol,
      error: errorMessage,
    };
  }
}

// ==================== CLAIM CREATOR FEES (OPTIONAL) ====================

/**
 * Claim creator fees from PumpPortal (only works if you're the token creator)
 * @param tokenMint The token CA
 * @returns Claim result with signature
 */
export async function claimCreatorFees(tokenMint: string): Promise<{
  success: boolean;
  signature?: string;
  error?: string;
}> {
  try {
    console.log('💰 Claiming creator fees...');
    
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
      console.log('Claim response:', errorText);
      return { success: false, error: errorText };
    }

    const txData = await response.arrayBuffer();
    const txBase64 = btoa(String.fromCharCode(...new Uint8Array(txData)));
    
    const signature = await signAndSendTransaction(txBase64);
    await confirmTransaction(signature);
    
    console.log('✅ Claimed fees, tx:', signature);
    return { success: true, signature };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, error: errorMessage };
  }
}

// ==================== CORE FUNCTIONS ====================

async function buyTokens(
  tokenMint: string, 
  amountSol: number, 
  slippage: number,
  priorityFee: number
): Promise<{ signature: string }> {
  const response = await fetch(PUMPPORTAL_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      publicKey: SOLANA_PUBLIC_KEY,
      action: 'buy',
      mint: tokenMint,
      amount: amountSol,
      denominatedInSol: 'true',
      slippage,
      priorityFee,
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

async function burnTokens(tokenMint: string, amount: number): Promise<string> {
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
  
  const decimals = 6; // Pump.fun tokens use 6 decimals
  const amountInSmallestUnit = Math.floor(amount * Math.pow(10, decimals));
  
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

// ==================== HELPER FUNCTIONS ====================

async function getWalletBalance(address: string): Promise<number> {
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

async function getTokenBalance(walletAddress: string, mintAddress: string): Promise<number> {
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
}

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
    await sleep(1000);
    
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

async function sendDiscordNotification(webhookUrl: string, payload: Record<string, unknown>): Promise<void> {
  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    console.error('Discord notification failed:', error);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ==================== BASE58 UTILITIES ====================

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

// ==================== EXAMPLE USAGE ====================

/*
// Example: Run a buyback and burn

const result = await executeBuybackAndBurn({
  tokenMint: 'YOUR_TOKEN_CA_HERE',
  amountSol: 0.1,
  slippage: 25,
  priorityFee: 0.001,
  discordWebhook: 'YOUR_DISCORD_WEBHOOK_URL', // optional
});

console.log('Result:', result);

// Example: Claim creator fees first, then buyback and burn

const claimResult = await claimCreatorFees('YOUR_TOKEN_CA_HERE');
if (claimResult.success) {
  await sleep(5000); // Wait for fees to arrive
  await executeBuybackAndBurn({
    tokenMint: 'YOUR_TOKEN_CA_HERE',
    amountSol: 0.1,
  });
}
*/
