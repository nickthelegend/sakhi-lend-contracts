import { AlgorandClient } from '@algorandfoundation/algokit-utils'
import { TrustOracleFactory } from '../artifacts/trust_oracle/TrustOracleClient'

export async function deploy() {
  console.log('=== Deploying TrustOracle ===')

  const algorand = AlgorandClient.fromEnvironment()
  const deployer = await algorand.account.fromEnvironment('DEPLOYER')

  const factory = algorand.client.getTypedAppFactory(TrustOracleFactory, {
    defaultSender: deployer.addr,
    name: 'SakhiOracle_Local_v1'
  })

  // Deploy the app using direct create
  console.log('Sending create transaction...')
  const { appClient, result } = await factory.send.create.createApplication({
    args: []
  })
  
  const deployResult = { operationPerformed: 'create' }

  console.log(`TrustOracle deployed at ID: ${appClient.appId} with address: ${appClient.appAddress}`)

  // Set initial data if needed (Oracle setup)
  if (['create', 'replace'].includes(result.operationPerformed)) {
     console.log('TrustOracle initialized.')
     console.log(`FINAL_ORACLE_APP_ID=${appClient.appId}`)
  }
}
