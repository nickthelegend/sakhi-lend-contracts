import { AlgorandClient } from '@algorandfoundation/algokit-utils'
import * as algokit from '@algorandfoundation/algokit-utils'
import { LoanPoolFactory } from '../artifacts/loan_pool/LoanPoolClient'

export async function deploy() {
  console.log('=== Deploying LoanPool ===')

  const algorand = AlgorandClient.fromEnvironment()
  const deployer = await algorand.account.fromEnvironment('DEPLOYER')

  // Use the SUSDC ID
  const USDC_ID = process.env.USDC_ID ? BigInt(process.env.USDC_ID) : 758817439n

  const factory = algorand.client.getTypedAppFactory(LoanPoolFactory, {
    defaultSender: deployer.addr,
    name: 'SakhiPool_Local_v1'
  })

  // Deploy the app using direct create to ensure ABI args are passed
  console.log('Sending create transaction...')
  const { appClient, result } = await factory.send.create.createApplication({
    args: []
  })
  
  // Create a result-like object for the rest of the script
  const deployResult = { operationPerformed: 'create' }

  console.log(`LoanPool deployed at ID: ${appClient.appId} with address: ${appClient.appAddress}`)

  // Fund and Bootstrap
  if (['create'].includes(deployResult.operationPerformed)) {
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
      console.log(`FINAL_POOL_APP_ID=${appClient.appId}`)
    } catch (e) {
      console.warn('Bootstrap failed:', e)
    }
  }
}
