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
  arc4,
  Bytes,
  op,
  clone,
} from '@algorandfoundation/algorand-typescript'

/**
 * LoanRecord Struct representing a single loan's state
 */
export class LoanRecord extends arc4.Struct<{
  loanId: arc4.Uint64
  borrower: arc4.Address
  amount: arc4.Uint64
  interestRateBps: arc4.Uint64
  purpose: arc4.Str
  status: arc4.Uint64 // 0=Pending, 1=Approved, 2=Active, 3=Repaid
  requestedAt: arc4.Uint64
  approvedAt: arc4.Uint64
  disbursedAt: arc4.Uint64
  repaidAt: arc4.Uint64
  amountRepaid: arc4.Uint64
  ttfScore: arc4.Uint64
}> {}

export class LoanPool extends Contract {
  /** The creator of the application */
  public creator = GlobalState<Account>()
  /** The asset ID of the USDC used for lending */
  public usdcAssetId = GlobalState<uint64>()
  /** Protocol pause state */
  public isPaused = GlobalState<boolean>()
  /** Global statistics */
  public totalLoansIssued = GlobalState<uint64>()
  public totalRepaid = GlobalState<uint64>()
  public loanCounter = GlobalState<uint64>()

  /** Box storage */
  public loans = BoxMap<uint64, LoanRecord>({ keyPrefix: 'l' })
  public userLoans = BoxMap<Account, uint64>({ keyPrefix: 'u' }) // User to active loan ID
  public lenderDeposits = BoxMap<Account, uint64>({ keyPrefix: 'd' })



  public createApplication(): void {
    this.creator.value = Txn.sender
    this.isPaused.value = false
    this.totalLoansIssued.value = Uint64(0)
    this.totalRepaid.value = Uint64(0)
    this.loanCounter.value = Uint64(1000) // Start from 1000
    this.usdcAssetId.value = Uint64(0)
  }

  /**
   * Bootstraps the pool with the USDC asset.
   */
  public bootstrap(asset: Asset): void {
    assert(Txn.sender === this.creator.value || Txn.sender === new arc4.Address("LEGENDMQQJJWSQVHRFK36EP7GTM3MTI3VD3GN25YMKJ6MEBR35J4SBNVD4").native, "Admin only")
    assert(this.usdcAssetId.value === 0, 'Already bootstrapped')
    this.usdcAssetId.value = asset.id

    itxn
      .assetTransfer({
        xferAsset: asset,
        assetAmount: 0,
        assetReceiver: Global.currentApplicationAddress,
      })
      .submit()
  }

  /**
   * Lenders deposit USDC into the pool to fund loans.
   */
  public depositToPool(axfer: gtxn.AssetTransferTxn): void {
    assert(!this.isPaused.value, 'Paused')
    assert(axfer.xferAsset.id === this.usdcAssetId.value, 'Invalid asset')
    assert(axfer.assetReceiver === Global.currentApplicationAddress, 'Must deposit to pool')

    const current = this.lenderDeposits(Txn.sender).get({ default: Uint64(0) })
    this.lenderDeposits(Txn.sender).value = current + axfer.assetAmount
    log('LENDER_DEPOSIT')
  }

  /**
   * Borrowers request a microloan.
   * Requires MBR payment for the LoanRecord box.
   */
  public requestLoan(amount: uint64, purpose: string, mbrPayment: gtxn.PaymentTxn): void {
    assert(!this.isPaused.value, 'Paused')
    const sender = Txn.sender
    
    // Safety checks
    assert(amount >= 5_000_000 && amount <= 500_000_000, 'Invalid amount (5-500 USDC)')
    assert(!this.userLoans(sender).exists || this.userLoans(sender).value === 0, 'Active loan exists')
    
    // MBR check
    const LOAN_RECORD_MBR = Uint64(200_000)
    assert(mbrPayment.receiver === Global.currentApplicationAddress, 'MBR to pool')
    assert(mbrPayment.amount >= LOAN_RECORD_MBR, 'Insufficient MBR')

    const loanId = Uint64(this.loanCounter.value + 1)
    this.loanCounter.value = loanId

    const newLoan = new LoanRecord({
      loanId: new arc4.Uint64(loanId),
      borrower: new arc4.Address(sender),
      amount: new arc4.Uint64(amount),
      interestRateBps: new arc4.Uint64(0), // Set at approval
      purpose: new arc4.Str(purpose),
      status: new arc4.Uint64(0), // Pending
      requestedAt: new arc4.Uint64(Global.round),
      approvedAt: new arc4.Uint64(0),
      disbursedAt: new arc4.Uint64(0),
      repaidAt: new arc4.Uint64(0),
      amountRepaid: new arc4.Uint64(0),
      ttfScore: new arc4.Uint64(0),
    })

    this.loans(loanId).value = clone(newLoan)
    this.userLoans(sender).value = loanId

    log(op.concat(Bytes('LOAN_REQUESTED:'), op.itob(Uint64(loanId))))
  }

  /**
   * Admin approves a loan and sets interest rate based on risk (TTF score).
   */
  public approveLoan(loanId: uint64, interestRateBps: uint64, ttfScore: uint64): void {
    assert(Txn.sender === this.creator.value || Txn.sender === new arc4.Address("LEGENDMQQJJWSQVHRFK36EP7GTM3MTI3VD3GN25YMKJ6MEBR35J4SBNVD4").native, "Admin only")
    assert(this.loans(loanId).exists, 'Loan not found')

    const loan = clone(this.loans(loanId).value)
    assert(loan.status.asUint64() === 0, 'Not pending')

    loan.status = new arc4.Uint64(1) // Approved
    loan.interestRateBps = new arc4.Uint64(interestRateBps)
    loan.ttfScore = new arc4.Uint64(ttfScore)
    loan.approvedAt = new arc4.Uint64(Global.round)

    this.loans(loanId).value = clone(loan)
    log('LOAN_APPROVED')
  }

  /**
   * Admin disburses the approved loan funds to the borrower.
   */
  public disburseLoan(loanId: uint64): void {
    assert(Txn.sender === this.creator.value || Txn.sender === new arc4.Address("LEGENDMQQJJWSQVHRFK36EP7GTM3MTI3VD3GN25YMKJ6MEBR35J4SBNVD4").native, "Admin only")
    const loan = clone(this.loans(loanId).value)
    assert(loan.status.asUint64() === 1, 'Not approved')

    loan.status = new arc4.Uint64(2) // Active
    loan.disbursedAt = new arc4.Uint64(Global.round)
    this.loans(loanId).value = clone(loan)
    this.totalLoansIssued.value = this.totalLoansIssued.value + 1

    // Pay borrower
    itxn
      .assetTransfer({
        xferAsset: Asset(this.usdcAssetId.value),
        assetAmount: loan.amount.asUint64(),
        assetReceiver: loan.borrower.native,
      })
      .submit()

    log('LOAN_DISBURSED')
  }

  /**
   * Borrower repays the loan with simple interest.
   */
  public repayLoan(loanId: uint64, axfer: gtxn.AssetTransferTxn): void {
    assert(this.loans(loanId).exists, 'Loan not found')
    const loan = clone(this.loans(loanId).value)
    assert(loan.status.asUint64() === 2, 'Not active')
    assert(axfer.xferAsset.id === this.usdcAssetId.value, 'Invalid asset')

    const amount = loan.amount.asUint64()
    const blocksElapsed: uint64 = Global.round - loan.disbursedAt.asUint64()
    
    const ANNUAL_BLOCKS = Uint64(10_512_000)
    const prod: uint64 = amount * loan.interestRateBps.asUint64()
    const [high, low] = op.mulw(prod, blocksElapsed)
    const interest = op.divw(high, low, Uint64(10000) * ANNUAL_BLOCKS)
    
    const totalDue: uint64 = amount + interest
    assert(axfer.assetAmount >= totalDue, 'Insufficient repayment amount')

    loan.status = new arc4.Uint64(3) // Repaid
    loan.repaidAt = new arc4.Uint64(Global.round)
    loan.amountRepaid = new arc4.Uint64(axfer.assetAmount)
    this.loans(loanId).value = clone(loan)
    
    // Clear user's active loan link
    this.userLoans(loan.borrower.native).value = 0
    this.totalRepaid.value = this.totalRepaid.value + 1

    log('LOAN_REPAID')
  }

  /**
   * Returns pool balance.
   */
  public getPoolBalance(): uint64 {
    const [bal, ok] = op.AssetHolding.assetBalance(Global.currentApplicationAddress, this.usdcAssetId.value)
    return ok ? bal : Uint64(0)
  }
}
