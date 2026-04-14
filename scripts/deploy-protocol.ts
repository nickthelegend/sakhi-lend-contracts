import * as algokit from '@algorandfoundation/algokit-utils'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { YieldVaultFactory } from '../smart_contracts/artifacts/yield_vault/YieldVaultClient'
import { LoanPoolFactory } from '../smart_contracts/artifacts/loan_pool/LoanPoolClient'
import { TrustOracleFactory } from '../smart_contracts/artifacts/trust_oracle/TrustOracleClient'

async function deploy() {
  const algorand = algokit.AlgorandClient.defaultLocalNet()
  const creator = await algorand.account.localNetDispenser()
  const creatorAddress = creator.addr

  console.log(`Using creator: ${creatorAddress}`)

  console.log('Deploying TrustOracle...')
  const oracleFactory = new TrustOracleFactory({
    algorand,
    defaultSender: creatorAddress,
  })
  const oracleDeployment = await oracleFactory.deploy({
    onSchemaBreak: 'replace',
    onUpdate: 'replace',
    createParams: {
      method: 'createApplication',
      args: [],
    }
  })
  const oracleAppId = oracleDeployment.appClient.appId
  console.log(`TrustOracle deployed: ${oracleAppId}`)

  console.log('Creating Mock USDC...')
  const usdcResult = await algorand.send.assetCreate({
    sender: creatorAddress,
    total: BigInt(10_000_000_000) * BigInt(1_000_000), // 10 Billion USDC
    decimals: 6,
    assetName: 'Mock USDC',
    unitName: 'USDC',
  })
  const usdcId = BigInt(usdcResult.confirmation.assetIndex!)
  console.log(`Mock USDC created: ${usdcId}`)

  console.log('Deploying YieldVault...')
  const vaultFactory = new YieldVaultFactory({
    algorand,
    defaultSender: creatorAddress,
  })
  const vaultDeployment = await vaultFactory.deploy({
    onSchemaBreak: 'replace',
    onUpdate: 'replace',
    createParams: {
      method: 'createApplication',
      args: [],
    }
  })
  const vaultAppId = vaultDeployment.appClient.appId
  console.log(`YieldVault deployed: ${vaultAppId}`)

  console.log('Funding YieldVault for MBR...')
  await algorand.send.payment({
    sender: creatorAddress,
    receiver: vaultDeployment.appClient.appAddress,
    amount: algokit.algos(1),
  })

  console.log('Bootstrapping YieldVault...')
  try {
    await vaultDeployment.appClient.send.bootstrap({ 
      args: { asset: usdcId },
      extraFee: algokit.microAlgos(1000),
    })
    console.log('YieldVault bootstrapped')
  } catch (e: any) {
    if (e.message && e.message.includes('Already bootstrapped')) {
      console.log('YieldVault already bootstrapped')
    } else {
      throw e
    }
  }

  console.log('Deploying LoanPool...')
  const poolFactory = new LoanPoolFactory({
    algorand,
    defaultSender: creatorAddress,
  })
  const poolDeployment = await poolFactory.deploy({
    onSchemaBreak: 'replace',
    onUpdate: 'replace',
    createParams: {
      method: 'createApplication',
      args: [],
    }
  })
  const poolAppId = poolDeployment.appClient.appId
  console.log(`LoanPool deployed: ${poolAppId}`)

  console.log('Funding LoanPool for MBR...')
  await algorand.send.payment({
    sender: creatorAddress,
    receiver: poolDeployment.appClient.appAddress,
    amount: algokit.algos(1),
  })

  console.log('Bootstrapping LoanPool...')
  try {
    await poolDeployment.appClient.send.bootstrap({ 
      args: { asset: usdcId },
      extraFee: algokit.microAlgos(1000),
    })
    console.log('LoanPool bootstrapped')
  } catch (e: any) {
    if (e.message && e.message.includes('Already bootstrapped')) {
      console.log('LoanPool already bootstrapped')
    } else {
      throw e
    }
  }

  // Save to localnet.json
  const config = {
    trustOracleAppId: Number(oracleAppId),
    yieldVaultAppId: Number(vaultAppId),
    loanPoolAppId: Number(poolAppId),
    usdcAssetId: Number(usdcId),
    creatorAddress: creatorAddress.toString(),
  }

  const outputPath = path.resolve(__dirname, '../../sakhi-lend/contracts/localnet.json')
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  fs.writeFileSync(outputPath, JSON.stringify(config, null, 2))
  console.log(`Configuration saved to ${outputPath}`)
}

deploy().catch((e) => {
  console.error(e)
  process.exit(1)
})
