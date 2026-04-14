import { AlgorandClient } from '@algorandfoundation/algokit-utils'
import { YieldVaultFactory } from '../artifacts/yield_vault/YieldVaultClient'

export async function deploy() {
  console.log('=== Deploying YieldVault ===')

  const algorand = AlgorandClient.fromEnvironment()
  const deployer = await algorand.account.fromEnvironment('DEPLOYER')

  // Use the SUSDC ID we just created
  const USDC_ID = process.env.USDC_ID ? BigInt(process.env.USDC_ID) : 758817439n

  const factory = algorand.client.getTypedAppFactory(YieldVaultFactory, {
    defaultSender: deployer.addr,
    name: 'SakhiVault_Release_V1'
  })

  // Deploy the app using direct create to ensure ABI args are passed
  console.log('Sending create transaction...')
  const { appClient, result } = await factory.send.create.createApplication({
    args: []
  })
  
  // Create a result-like object
  const deployResult = { operationPerformed: 'create' }

  console.log(`YieldVault deployed at ID: ${appClient.appId} with address: ${appClient.appAddress}`)

  // Fund the app account with 1 ALGO for MB and fees
  if (deployResult.operationPerformed === 'create') {
    console.log('Funding app account...')
    await algorand.send.payment({
      amount: (1).algo(),
      sender: deployer.addr,
      receiver: appClient.appAddress,
    })

    console.log(`Bootstrapping with Asset ID: ${USDC_ID}`)
    try {
      // Use REAL manual encoding with ABIMethod for robustness
      const { ABIMethod, encodeUint64 } = await import('algosdk')
      const method = new ABIMethod({ 
          name: 'bootstrap', 
          args: [{ type: 'uint64', name: 'asset' }], 
          returns: { type: 'void' } 
      })
      
      await algorand.send.appCall({
        sender: deployer.addr,
        appId: appClient.appId,
        args: [method.getSelector(), encodeUint64(USDC_ID)],
      })
      
      console.log(`Bootstrap successful with Asset ID: ${USDC_ID}`)
      console.log(`FINAL_VAULT_APP_ID=${appClient.appId}`)
    } catch (e) {
      console.warn('Bootstrap failed:', e)
    }
  }
}
