import {
  BoxMap,
  Contract,
  Global,
  GlobalState,
  Uint64,
  Account,
  uint64,
  assert,
  Txn,
  gtxn,
  log,
} from '@algorandfoundation/algorand-typescript'

export class TrustOracle extends Contract {
  /** The creator of the application (oracle admin) */
  public creator = GlobalState<Account>()

  /** Scores (0-1000) for verified users */
  public scores = BoxMap<Account, uint64>({ keyPrefix: 's' })
  /** Verification status */
  public verified = BoxMap<Account, boolean>({ keyPrefix: 'v' })
  /** Last attestation round */
  public attestedAt = BoxMap<Account, uint64>({ keyPrefix: 'a' })



  public createApplication(): void {
    this.creator.value = Txn.sender
  }

  /**
   * Attests to a user's creditworthiness with a TTF score.
   * Admin only. Requires MBR payment for boxes.
   */
  public attest(user: Account, score: uint64, mbrPayment: gtxn.PaymentTxn): void {
    assert(Txn.sender === this.creator.value, 'Admin only')
    assert(score <= 1000, 'Score must be <= 1000')

    // If new user, require MBR
    if (!this.scores(user).exists) {
      const BOX_MBR = Uint64(128_500)
      assert(mbrPayment.receiver === Global.currentApplicationAddress, 'MBR to oracle')
      assert(mbrPayment.amount >= BOX_MBR * 3, 'Insufficient MBR for boxes')
    }

    this.scores(user).value = score
    this.verified(user).value = true
    this.attestedAt(user).value = Global.round

    log('USER_ATTESTED')
  }

  /**
   * Revokes a user's verification status.
   * Admin only.
   */
  public revokeAttestation(user: Account): void {
    assert(Txn.sender === this.creator.value, 'Admin only')
    this.verified(user).value = false
    this.scores(user).value = 0
    log('ATTESTATION_REVOKED')
  }

  /**
   * Returns a user's score.
   */
  public getScore(user: Account): uint64 {
    return this.scores(user).get({ default: Uint64(0) })
  }

  /**
   * Returns whether a user is verified.
   */
  public isVerified(user: Account): boolean {
    return this.verified(user).get({ default: false })
  }
}
