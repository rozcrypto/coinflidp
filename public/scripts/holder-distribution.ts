/**
 * ============================================================
 * HOLDER DISTRIBUTION SCRIPT
 * ============================================================
 * 
 * This script handles distributing SOL rewards to token holders.
 * Supports both direct sends and multi-hop transfers for anonymity.
 * 
 * FLOW:
 * 1. Fetch eligible token holders from chain
 * 2. Select winner (weighted random by balance OR priority wallet)
 * 3. Send reward via direct transfer OR multi-hop (through hot wallets)
 * 
 * MULTI-HOP FLOW (for larger amounts, avoids bundling):
 * Dev Wallet → Hot Wallet 1 → Hot Wallet 2 → Winner
 * 
 * REQUIRED ENVIRONMENT VARIABLES:
 * - SOLANA_PRIVATE_KEY: Base58 encoded private key of the dev wallet
 * - SOLANA_PUBLIC_KEY: Public key of the dev wallet
 * - HELIUS_API_KEY: Your Helius RPC API key
 * 
 * OPTIONAL:
 * - DISCORD_WEBHOOK: Discord webhook URL for notifications
 * 
 * ============================================================
 */

// ==================== CONFIGURATION ====================

interface DistributionConfig {
  tokenMint: string;              // The token CA (Contract Address)
  amountSol: number;              // Amount of SOL to distribute
  excludedWallets?: string[];     // Wallets to exclude from selection
  priorityWallets?: string[];     // Wallets with priority selection chance
  priorityChance?: number;        // Chance for priority wallet (0-1, default: 0.25)
  maxEligibleBalance?: number;    // Max token balance to be eligible (default: 50M)
  useMultiHop?: boolean;          // Force multi-hop mode (default: auto based on amount)
  multiHopThreshold?: number;     // SOL threshold for multi-hop (default: 0.05)
  discordWebhook?: string;        // Optional Discord webhook
  onHotWalletCreated?: (address: string, privateKey: string) => Promise<void>; // Callback for hot wallet storage
}

interface TokenHolder {
  address: string;
  balance: number;
}

interface HotWallet {
  address: string;
  privateKey: string;
}

// ==================== ENVIRONMENT ====================

const SOLANA_PRIVATE_KEY = Deno.env.get('SOLANA_PRIVATE_KEY')!;
const SOLANA_PUBLIC_KEY = Deno.env.get('SOLANA_PUBLIC_KEY')!;
const HELIUS_API_KEY = Deno.env.get('HELIUS_API_KEY')!;
const HELIUS_RPC = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;

// ==================== MAIN FUNCTION ====================

/**
 * Distribute SOL to a random token holder
 * @param config Configuration for the distribution
 * @returns Result with transaction hash and winner info
 */
export async function distributeToHolder(config: DistributionConfig): Promise<{
  success: boolean;
  winner?: string;
  winnerBalance?: number;
  amountSent?: number;
  txHash?: string;
  usedMultiHop?: boolean;
  hotWalletsUsed?: string[];
  error?: string;
}> {
  const {
    tokenMint,
    amountSol,
    excludedWallets = [],
    priorityWallets = [],
    priorityChance = 0.25,
    maxEligibleBalance = 50_000_000,
    multiHopThreshold = 0.05,
  } = config;
  
  // Determine if multi-hop should be used
  const useMultiHop = config.useMultiHop ?? (amountSol >= multiHopThreshold);
  
  console.log('💎 === HOLDER DISTRIBUTION ===');
  console.log('Token:', tokenMint);
  console.log('Amount:', amountSol, 'SOL');
  console.log('Mode:', useMultiHop ? 'Multi-Hop' : 'Direct');
  
  try {
    // Step 1: Check wallet balance
    const balance = await getWalletBalance(SOLANA_PUBLIC_KEY);
    console.log('Dev wallet balance:', balance, 'SOL');
    
    if (balance < amountSol + 0.001) {
      throw new Error(`Insufficient balance. Have: ${balance} SOL, Need: ${amountSol + 0.001} SOL`);
    }
    
    // Step 2: Build exclusion list
    const fullExcludedList = [
      SOLANA_PUBLIC_KEY,
      '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1', // Raydium
      'CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM', // Pump Curve
      ...excludedWallets,
    ];
    
    // Step 3: Fetch eligible holders
    console.log('📊 Fetching token holders...');
    const holders = await getTokenHolders(tokenMint, fullExcludedList, maxEligibleBalance);
    
    if (holders.length === 0) {
      throw new Error('No eligible token holders found');
    }
    
    console.log(`Found ${holders.length} eligible holders`);
    holders.forEach((h, i) => {
      console.log(`  ${i + 1}. ${h.address.slice(0, 8)}... - ${h.balance.toLocaleString()} tokens`);
    });
    
    // Step 4: Select winner
    let winner: string;
    let winnerBalance: number;
    let usedPriority = false;
    
    // Check if priority wallet should win
    if (priorityWallets.length > 0 && Math.random() < priorityChance) {
      winner = priorityWallets[Math.floor(Math.random() * priorityWallets.length)];
      usedPriority = true;
      // Try to find their balance in holders list
      const holderInfo = holders.find(h => h.address === winner);
      winnerBalance = holderInfo?.balance || 0;
      console.log('⭐ Priority wallet selected:', winner.slice(0, 8) + '...');
    } else {
      // Weighted random selection based on balance
      winner = selectRandomHolder(holders);
      const holderInfo = holders.find(h => h.address === winner)!;
      winnerBalance = holderInfo.balance;
      
      // Safety checks for regular holders
      if (fullExcludedList.includes(winner)) {
        throw new Error('SAFETY: Selected winner is in excluded list!');
      }
      if (winnerBalance > maxEligibleBalance) {
        throw new Error(`SAFETY: Winner has ${winnerBalance.toLocaleString()} tokens (exceeds max)`);
      }
      console.log('🎯 Selected winner:', winner.slice(0, 8) + '...');
    }
    
    console.log('Winner balance:', winnerBalance.toLocaleString(), 'tokens');
    
    // Step 5: Send reward
    let txHash: string;
    let hotWalletsUsed: string[] = [];
    
    if (!useMultiHop) {
      // DIRECT SEND
      console.log('💸 Sending directly to winner...');
      const txFee = 0.000005;
      const finalAmount = Math.floor((amountSol - txFee) * 1e9) / 1e9;
      
      txHash = await sendSolFromWallet(
        SOLANA_PRIVATE_KEY,
        SOLANA_PUBLIC_KEY,
        winner,
        finalAmount
      );
      console.log('✅ Direct send tx:', txHash);
      
    } else {
      // MULTI-HOP SEND
      console.log('🔀 Using multi-hop transfer...');
      
      const hotWallet1 = await createNewHotWallet();
      const hotWallet2 = await createNewHotWallet();
      
      hotWalletsUsed = [hotWallet1.address, hotWallet2.address];
      console.log('Hot Wallet 1:', hotWallet1.address);
      console.log('Hot Wallet 2:', hotWallet2.address);
      
      // Store hot wallet info if callback provided
      if (config.onHotWalletCreated) {
        await config.onHotWalletCreated(hotWallet1.address, hotWallet1.privateKey);
        await config.onHotWalletCreated(hotWallet2.address, hotWallet2.privateKey);
      }
      
      try {
        const txFee = 0.000005;
        const hop1Amount = amountSol;
        const hop2Amount = Math.floor((hop1Amount - txFee) * 1e9) / 1e9;
        const finalAmount = Math.floor((hop2Amount - txFee) * 1e9) / 1e9;
        
        console.log(`Hop amounts: ${hop1Amount} → ${hop2Amount} → ${finalAmount} SOL`);
        
        if (finalAmount < 0.0001) {
          throw new Error(`Amount too small for multi-hop. Need at least 0.0003 SOL input`);
        }
        
        // HOP 1: Dev → Hot Wallet 1
        console.log('📤 HOP 1: Dev → Hot Wallet 1');
        const hop1Tx = await sendSolFromWallet(
          SOLANA_PRIVATE_KEY,
          SOLANA_PUBLIC_KEY,
          hotWallet1.address,
          hop1Amount
        );
        console.log('✅ Hop 1 tx:', hop1Tx);
        
        await sleep(5000);
        let hw1Balance = await getWalletBalance(hotWallet1.address);
        console.log('Hot Wallet 1 balance:', hw1Balance, 'SOL');
        
        if (hw1Balance < hop2Amount) {
          await sleep(5000);
          hw1Balance = await getWalletBalance(hotWallet1.address);
          if (hw1Balance < hop2Amount) {
            throw new Error(`Hot Wallet 1 balance insufficient: ${hw1Balance} SOL`);
          }
        }
        
        // HOP 2: Hot Wallet 1 → Hot Wallet 2
        console.log('📤 HOP 2: Hot Wallet 1 → Hot Wallet 2');
        const hop2Tx = await sendSolFromWallet(
          hotWallet1.privateKey,
          hotWallet1.address,
          hotWallet2.address,
          hop2Amount
        );
        console.log('✅ Hop 2 tx:', hop2Tx);
        
        await sleep(5000);
        let hw2Balance = await getWalletBalance(hotWallet2.address);
        console.log('Hot Wallet 2 balance:', hw2Balance, 'SOL');
        
        if (hw2Balance < finalAmount) {
          await sleep(5000);
          hw2Balance = await getWalletBalance(hotWallet2.address);
          if (hw2Balance < finalAmount) {
            throw new Error(`Hot Wallet 2 balance insufficient: ${hw2Balance} SOL`);
          }
        }
        
        // HOP 3: Hot Wallet 2 → Winner
        console.log('📤 HOP 3: Hot Wallet 2 → Winner');
        txHash = await sendSolFromWallet(
          hotWallet2.privateKey,
          hotWallet2.address,
          winner,
          finalAmount
        );
        console.log('✅ Final tx:', txHash);
        
      } catch (hopError) {
        // Attempt to sweep back any stuck funds
        console.error('⚠️ Multi-hop failed, attempting to sweep back...');
        await Promise.all([
          sweepWalletToDevWallet(hotWallet1),
          sweepWalletToDevWallet(hotWallet2),
        ]);
        throw hopError;
      }
    }
    
    // Step 6: Send Discord notification
    if (config.discordWebhook) {
      await sendDiscordNotification(config.discordWebhook, {
        embeds: [{
          title: '💎 HOLDER REWARD SENT',
          color: 0x00ff88,
          fields: [
            { name: 'Winner', value: `\`${winner.slice(0, 8)}...${winner.slice(-6)}\``, inline: true },
            { name: 'Amount', value: `${amountSol.toFixed(6)} SOL`, inline: true },
            { name: 'Token Balance', value: `${winnerBalance.toLocaleString()}`, inline: true },
            { name: 'Mode', value: useMultiHop ? 'Multi-Hop' : 'Direct', inline: true },
            { name: 'Priority', value: usedPriority ? 'Yes' : 'No', inline: true },
            { name: 'Transaction', value: `[View](https://solscan.io/tx/${txHash})`, inline: false },
          ],
          timestamp: new Date().toISOString(),
        }]
      });
    }
    
    return {
      success: true,
      winner,
      winnerBalance,
      amountSent: amountSol,
      txHash,
      usedMultiHop: useMultiHop,
      hotWalletsUsed: hotWalletsUsed.length > 0 ? hotWalletsUsed : undefined,
    };
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('❌ Distribution error:', errorMessage);
    return {
      success: false,
      error: errorMessage,
    };
  }
}

// ==================== TOKEN HOLDER FUNCTIONS ====================

/**
 * Fetch eligible token holders from chain
 */
export async function getTokenHolders(
  tokenMint: string,
  excludedWallets: string[],
  maxBalance: number
): Promise<TokenHolder[]> {
  const response = await fetch(HELIUS_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getTokenLargestAccounts',
      params: [tokenMint],
    }),
  });

  const data = await response.json();
  
  if (!data.result?.value) {
    console.log('No token accounts found');
    return [];
  }

  const tokenAccounts = data.result.value;
  const balancesByOwner = new Map<string, number>();

  // Fetch owner info for top 20 accounts
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
    if (excludedWallets.includes(owner)) {
      console.log(`🚫 Excluding: ${owner.slice(0, 8)}...`);
      continue;
    }
    
    if (balance <= 0) continue;

    // Skip wallets over max balance
    if (balance > maxBalance) {
      console.log(`🚫 Over max (${balance.toLocaleString()}): ${owner.slice(0, 8)}...`);
      continue;
    }

    balancesByOwner.set(owner, (balancesByOwner.get(owner) || 0) + balance);
  }

  const holders: TokenHolder[] = Array.from(balancesByOwner.entries())
    .filter(([_, balance]) => balance <= maxBalance)
    .map(([address, balance]) => ({ address, balance }));

  return holders;
}

/**
 * Select a random holder weighted by balance
 */
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

// ==================== HOT WALLET FUNCTIONS ====================

/**
 * Create a new hot wallet (generates fresh keypair)
 */
async function createNewHotWallet(): Promise<HotWallet> {
  const { Keypair } = await import("https://esm.sh/@solana/web3.js@1.87.6");
  const newKeypair = Keypair.generate();

  return {
    address: newKeypair.publicKey.toBase58(),
    privateKey: encodeBase58(newKeypair.secretKey),
  };
}

/**
 * Sweep remaining balance from hot wallet back to dev wallet
 */
async function sweepWalletToDevWallet(wallet: HotWallet): Promise<string | null> {
  const balance = await getWalletBalance(wallet.address);
  console.log(`🧹 Sweeping ${wallet.address.slice(0, 8)}... balance:`, balance, 'SOL');

  const feeBuffer = 0.00001;
  const sweepAmount = Math.max(0, Math.floor((balance - feeBuffer) * 1e9) / 1e9);

  if (sweepAmount <= 0) {
    console.log('🧹 Nothing to sweep');
    return null;
  }

  const txHash = await sendSolFromWallet(
    wallet.privateKey,
    wallet.address,
    SOLANA_PUBLIC_KEY,
    sweepAmount
  );
  console.log('✅ Swept back to dev wallet, tx:', txHash);
  return txHash;
}

// ==================== SOL TRANSFER FUNCTIONS ====================

async function sendSolFromWallet(
  privateKey: string,
  fromAddress: string,
  toAddress: string,
  amountSol: number
): Promise<string> {
  const lamports = Math.floor(amountSol * 1e9);
  
  console.log(`Sending ${amountSol} SOL from ${fromAddress.slice(0, 8)}... to ${toAddress.slice(0, 8)}...`);
  
  const { 
    Connection, 
    PublicKey, 
    Transaction, 
    SystemProgram, 
    Keypair,
  } = await import("https://esm.sh/@solana/web3.js@1.87.6");
  
  const connection = new Connection(HELIUS_RPC, 'confirmed');
  
  const privateKeyBytes = decodeBase58(privateKey);
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

// ==================== EXAMPLE USAGE ====================

/*
// Example 1: Simple distribution (auto-selects direct or multi-hop)

const result = await distributeToHolder({
  tokenMint: 'YOUR_TOKEN_CA_HERE',
  amountSol: 0.05,
  discordWebhook: 'YOUR_DISCORD_WEBHOOK_URL', // optional
});

console.log('Result:', result);


// Example 2: Distribution with priority wallets

const result = await distributeToHolder({
  tokenMint: 'YOUR_TOKEN_CA_HERE',
  amountSol: 0.1,
  priorityWallets: [
    'PRIORITY_WALLET_1',
    'PRIORITY_WALLET_2',
  ],
  priorityChance: 0.25, // 25% chance a priority wallet wins
  excludedWallets: [
    'WHALE_WALLET_TO_EXCLUDE',
    'TEAM_WALLET_TO_EXCLUDE',
  ],
  maxEligibleBalance: 50_000_000, // Exclude holders with >50M tokens
});


// Example 3: Force multi-hop mode for small amounts

const result = await distributeToHolder({
  tokenMint: 'YOUR_TOKEN_CA_HERE',
  amountSol: 0.01,
  useMultiHop: true, // Force multi-hop even for small amounts
  onHotWalletCreated: async (address, privateKey) => {
    // Store hot wallet info in your database
    console.log('Hot wallet created:', address);
  },
});


// Example 4: Get holders list only (for analytics)

const holders = await getTokenHolders(
  'YOUR_TOKEN_CA_HERE',
  ['EXCLUDED_WALLET_1', 'EXCLUDED_WALLET_2'],
  50_000_000
);

console.log('Eligible holders:', holders.length);
holders.forEach(h => {
  console.log(`${h.address}: ${h.balance.toLocaleString()} tokens`);
});
*/
