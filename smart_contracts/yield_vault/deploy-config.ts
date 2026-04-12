import { AlgorandClient } from '@algorandfoundation/algokit-utils'
import { YieldVaultFactory } from '../artifacts/yield_vault/YieldVaultClient'

export async function deploy() {
  console.log('=== Deploying YieldVault ===')

  const algorand = AlgorandClient.fromEnvironment()
  const deployer = await algorand.account.fromEnvironment('DEPLOYER')

  const factory = algorand.client.getTypedAppFactory(YieldVaultFactory, {
    defaultSender: deployer.addr,
  })

  // Deploy the app
  const { appClient, result } = await factory.deploy({ 
    onUpdate: 'replace', 
    onSchemaBreak: 'replace' 
  })


  console.log(`YieldVault deployed at ID: ${appClient.appId} with address: ${appClient.appAddress}`)

  // Fund the app account with 1 ALGO for MB and fees
  if (['create', 'replace'].includes(result.operationPerformed)) {
    console.log('Funding app account...')
    await algorand.send.payment({
      amount: (1).algo(),
      sender: deployer.addr,
      receiver: appClient.appAddress,
    })

    // Simulated USDC. On localnet, we create one.
    console.log('Creating dummy USDC...')
    const createRes = await algorand.send.assetCreate({
      sender: deployer.addr,
      assetName: 'USDC Simulator',
      unitName: 'USDC',
      total: 1000000000n,
      decimals: 6,
    })
    const USDC_ID = BigInt(createRes.confirmation.assetIndex!)
    
    console.log(`Bootstrapping with Asset ID: ${USDC_ID}`)
    try {
      // Opt the app into the asset first
      await algorand.send.assetTransfer({
        assetId: USDC_ID,
        amount: 0n,
        sender: appClient.appAddress,
        receiver: appClient.appAddress,
        extraFee: (1000).microAlgos(),
      })

      // Call bootstrap
      await appClient.send.bootstrap({
        args: { asset: USDC_ID },
      })
      console.log(`Bootstrap successful with Asset ID: ${USDC_ID}`)
      
      console.log(`FINAL_APP_ID=${appClient.appId}`)
      console.log(`FINAL_ASSET_ID=${USDC_ID}`)
    } catch (e) {
      console.warn('Bootstrap failed:', e)
    }


  }
}
