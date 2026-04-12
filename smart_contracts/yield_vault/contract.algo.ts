import {
  BoxMap,
  Contract,
  Global,
  GlobalState,
  itxn,
  Uint64,
  Account,
  Asset,
  uint64,
  assert,
  Txn,
  gtxn,
  log,
  BigUint,
  Bytes,
  op,
} from '@algorandfoundation/algorand-typescript'

export class YieldVault extends Contract {
  /** The creator of the application */
  public creator = GlobalState<Account>()
  /** The asset ID of the USDC used in this vault */
  public usdcAssetId = GlobalState<uint64>()
  /** Balance of the vault that belongs to reserves (yield runway) */
  public reserveBalance = GlobalState<uint64>()
  /** Protocol pause state */
  public isPaused = GlobalState<boolean>()

  /** User balance in the vault (USDC microunits) */
  public deposits = BoxMap<Account, uint64>({ keyPrefix: 'd' })
  /** Last block round yield was accrued for this user */
  public lastBlocks = BoxMap<Account, uint64>({ keyPrefix: 'b' })



  public createApplication(): void {
    this.creator.value = Txn.sender
    this.isPaused.value = false
    this.reserveBalance.value = Uint64(0)
  }

  /**
   * Bootstraps the vault: sets USDC asset and opts-in.
   * Admin only.
   */
  public bootstrap(asset: Asset): void {
    assert(Txn.sender === this.creator.value, 'Only creator can bootstrap')
    assert(!this.usdcAssetId.hasValue, 'Already bootstrapped')

    this.usdcAssetId.value = asset.id

    // Opt-in the contract to the USDC asset
    itxn
      .assetTransfer({
        xferAsset: asset,
        assetAmount: 0,
        assetReceiver: Global.currentApplicationAddress,
      })
      .submit()

    log('Vault bootstrapped')
  }

  /**
   * Deposits USDC into the vault for the first time.
   * Requires a payment txn to cover MBR.
   */
  public depositFirst(axfer: gtxn.AssetTransferTxn, mbrPayment: gtxn.PaymentTxn): void {
    assert(!this.isPaused.value, 'Protocol is paused')
    assert(axfer.xferAsset.id === this.usdcAssetId.value, 'Invalid asset')
    assert(axfer.assetReceiver === Global.currentApplicationAddress, 'Must deposit to vault')
    const MIN_DEPOSIT = Uint64(1_000_001)
    assert(axfer.assetAmount >= MIN_DEPOSIT, 'Below min deposit')

    const sender = Txn.sender
    assert(!this.deposits(sender).exists, 'User already exists')
    
    // MBR check
    const BOX_MBR = Uint64(128_500)
    assert(mbrPayment.receiver === Global.currentApplicationAddress, 'MBR payment to vault')
    assert(mbrPayment.amount >= BOX_MBR * 2, 'Insufficient MBR payment')

    const currentAmount = Uint64(0)
    this.deposits(sender).value = currentAmount + axfer.assetAmount
    this.lastBlocks(sender).value = Global.round

    log(op.concat(Bytes('DEPOSIT:'), op.itob(axfer.assetAmount)))
  }

  /**
   * Deposits more USDC into the vault for existing users.
   */
  public depositMore(axfer: gtxn.AssetTransferTxn): void {
    assert(!this.isPaused.value, 'Protocol is paused')
    assert(axfer.xferAsset.id === this.usdcAssetId.value, 'Invalid asset')
    assert(axfer.assetReceiver === Global.currentApplicationAddress, 'Must deposit to vault')
    const MIN_DEPOSIT = Uint64(1_000_001)
    assert(axfer.assetAmount >= MIN_DEPOSIT, 'Below min deposit')

    const sender = Txn.sender
    assert(this.deposits(sender).exists, 'User does not exist')

    this.accrueYield(sender)

    const currentAmount = this.deposits(sender).value
    this.deposits(sender).value = currentAmount + axfer.assetAmount
    this.lastBlocks(sender).value = Global.round

    log(op.concat(Bytes('DEPOSIT:'), op.itob(axfer.assetAmount)))
  }

  /**
   * Withdraws USDC from the vault.
   */
  public withdraw(amount: uint64): void {
    assert(!this.isPaused.value, 'Protocol is paused')
    const sender = Txn.sender
    
    this.accrueYield(sender)
    
    const currentBalance = this.deposits(sender).get({ default: Uint64(0) })
    assert(currentBalance >= amount, 'Insufficient balance')
    
    this.deposits(sender).value = currentBalance - amount
    this.lastBlocks(sender).value = Global.round

    // Inner transaction for withdrawal
    itxn
      .assetTransfer({
        xferAsset: Asset(this.usdcAssetId.value),
        assetAmount: amount,
        assetReceiver: sender,
      })
      .submit()

    log(op.concat(Bytes('WITHDRAW:'), op.itob(amount)))
  }

  /**
   * Admin method to fund the yield reserves.
   */
  public fundReserves(axfer: gtxn.AssetTransferTxn): void {
    assert(Txn.sender === this.creator.value, 'Admin only')
    assert(axfer.xferAsset.id === this.usdcAssetId.value, 'Invalid asset')
    assert(axfer.assetReceiver === Global.currentApplicationAddress, 'Must deposit to vault')
    
    this.reserveBalance.value = this.reserveBalance.value + axfer.assetAmount
    log('RESERVES_FUNDED')
  }

  /**
   * Pause or unpause the protocol.
   */
  public setPause(paused: boolean): void {
    assert(Txn.sender === this.creator.value, 'Admin only')
    this.isPaused.value = paused
  }

  /**
   * External view of balance including accrued yield.
   */
  public getBalance(user: Account): uint64 {
    const amount = this.deposits(user).get({ default: Uint64(0) })
    const lastBlock = this.lastBlocks(user).get({ default: Global.round })
    const blocksElapsed = Uint64(Global.round - lastBlock)

    if (amount > 0 && blocksElapsed > 0) {
      const yieldAmt = this.calculateYield(amount, blocksElapsed)
      return amount + yieldAmt
    }
    return amount
  }

  /**
   * Internal method to calculate and add yield.
   */
  private accrueYield(user: Account): void {
    const amount = this.deposits(user).get({ default: Uint64(0) })

    if (amount === 0) {
      this.lastBlocks(user).value = Global.round
      return
    }
    
    const lastBlock = this.lastBlocks(user).get({ default: Global.round })
    const blocksElapsed = Uint64(Global.round - lastBlock)
    
    if (blocksElapsed > 0) {
      const earnedYield = this.calculateYield(amount, blocksElapsed)
      if (earnedYield > 0) {
        this.deposits(user).value = amount + earnedYield
      }
    }
    this.lastBlocks(user).value = Global.round
  }

  /**
   * Securely calculates yield using BigUint to prevent overflow.
   * Yield = (Amount * YIELD_BPS * BlocksElapsed) / (10000 * ANNUAL_BLOCKS)
   */
  private calculateYield(amount: uint64, blocksElapsed: uint64): uint64 {
    const ANNUAL_BLOCKS = Uint64(10_512_000)
    const YIELD_BPS = Uint64(600)
    const prod: uint64 = amount * YIELD_BPS
    const [high, low] = op.mulw(prod, blocksElapsed)
    const denominator: uint64 = Uint64(10000) * ANNUAL_BLOCKS
    return op.divw(high, low, denominator)
  }
}
