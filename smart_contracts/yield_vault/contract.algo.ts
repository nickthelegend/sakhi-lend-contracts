import { BoxMap, Contract, Global, GlobalState, itxn, Uint64, Account, Asset, uint64, assert, Txn, gtxn, log } from '@algorandfoundation/algorand-typescript'

// Version 1.0.1 - Forcing redeploy
export class YieldVault extends Contract {
  /** User balance in the vault */
  public deposits = BoxMap<Account, uint64>({ keyPrefix: 'd' })
  /** Last block round yield was accrued for this user */
  public lastBlocks = BoxMap<Account, uint64>({ keyPrefix: 'b' })
  /** The asset ID of the USDC used in this vault */
  public usdcAssetId = GlobalState<uint64>()

  /**
   * Bootstraps the vault with the asset it will handle.
   */
  public bootstrap(asset: Asset): void {
    assert(this.usdcAssetId.hasValue === false, 'Already bootstrapped')
    this.usdcAssetId.value = asset.id
    log('Vault bootstrapped')
  }

  /**
   * Deposits an asset into the vault.
   * @param axfer The asset transfer transaction.
   */
  public deposit(axfer: gtxn.AssetTransferTxn): void {
    assert(axfer.xferAsset.id === this.usdcAssetId.value, 'Invalid asset')
    assert(axfer.assetReceiver === Global.currentApplicationAddress, 'Must deposit to vault')
    
    const sender = Txn.sender
    this.accrueYield(sender)
    
    const currentAmount = this.deposits(sender).get({ default: Uint64(0) })
    this.deposits(sender).value = currentAmount + axfer.assetAmount
    this.lastBlocks(sender).value = Global.round
  }

  /**
   * Internal method to calculate and add yield to user balance.
   */
  private accrueYield(user: Account): void {
    const amount = this.deposits(user).get({ default: Uint64(0) })

    if (amount === Uint64(0)) {
      this.lastBlocks(user).value = Global.round
      return
    }
    
    const lastBlock = this.lastBlocks(user).get({ default: Global.round })
    const blocksElapsed = Uint64(Global.round - lastBlock)
    
    if (blocksElapsed > Uint64(0)) {
      const ANNUAL_BLOCKS = Uint64(10_512_000)
      const earnedYield = Uint64((amount * Uint64(60 / 10) * blocksElapsed) / (Uint64(100) * ANNUAL_BLOCKS))
      
      if (earnedYield > Uint64(0)) {

        this.deposits(user).value = amount + earnedYield
      }
    }
    this.lastBlocks(user).value = Global.round
  }

  /**
   * Withdraws a specific amount from the vault.
   */
  public withdraw(amount: uint64): void {
    const sender = Txn.sender
    this.accrueYield(sender)
    
    const currentBalance = this.deposits(sender).get({ default: Uint64(0) })
    assert(currentBalance >= amount, 'Insufficient balance')
    
    this.deposits(sender).value = currentBalance - amount
    
    itxn
      .assetTransfer({
        xferAsset: Asset(this.usdcAssetId.value),
        assetAmount: amount,
        assetReceiver: sender,
      })
      .submit()
  }

  /**
   * Returns current balance for a user including accrued yield.
   */
  public getBalance(user: Account): uint64 {
    const amount = this.deposits(user).get({ default: Uint64(0) })
    const lastBlock = this.lastBlocks(user).get({ default: Global.round })
    const blocksElapsed = Uint64(Global.round - lastBlock)
    
    if (amount > Uint64(0) && blocksElapsed > Uint64(0)) {
      const ANNUAL_BLOCKS = Uint64(10_512_000)
      const earnedYield = Uint64((amount * Uint64(6) * blocksElapsed) / (Uint64(100) * ANNUAL_BLOCKS))
      return amount + earnedYield
    }
    
    return amount
  }
}




