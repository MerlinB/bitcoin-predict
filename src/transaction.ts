import { bsv, SigHashPreimage, PubKey, Bytes, Sig } from "scryptlib"
import {
  getMarketVersion,
  getMarketStatusfromHex,
  getMarketBalance,
  marketDetails,
  entry,
  marketStatus,
  getBalanceFromHex,
  getMarketDetailsFromHex,
  isValidMarketInfo,
  validateEntries,
  marketInfo,
  marketStatusHexLength,
  balanceHexLength,
  getMerklePath,
  getEntryHex,
  getToken,
  getBalanceMerkleRoot as getMerkleRoot,
  getMarketSatBalance
} from "./pm"
import { minerDetail, getMinerDetailsFromHex, getMinerSigsString } from "./oracle"
import { getLmsrSats, getLmsrShas, getLmsrMerklePath, lmsrScaled, SatScaling, balance } from "./lmsr"
import { hash } from "./sha"
import { getMerkleRootByPath } from "./merkleTree"
import { sha256 } from "./sha"
import { DEFAULT_FLAGS } from "scryptlib/dist/utils"
import { rabinSig } from "rabinsig"
import { cloneDeep } from "./utils"

const feeb = 0.5

const Signature = bsv.crypto.Signature
const sighashType = Signature.SIGHASH_ANYONECANPAY | Signature.SIGHASH_SINGLE | Signature.SIGHASH_FORKID

const opReturnDataLength = 3

// export function getLockingScript(market: marketInfo): bsv.Script {
//   const asm = getLockingScriptASM(market.miners).join(" ")
//   const marketBalanceHex = getBalanceHex(market.balance) + String(market.balanceMerkleRoot)
//   const marketDetailsHex = getMarketDetailsHex(market.details)
//   const marketStatusHex = getMarketStatusHex(market.status)

//   const fullScript = `${asm} OP_RETURN ${identifier} ${marketDetailsHex} ${marketStatusHex + marketBalanceHex}`

//   return bsv.Script.fromASM(fullScript)
// }

// export function getLockingScript(market: marketInfo): bsv.Script {
//   const token = getToken(market.miners)

//   const marketBalanceHex = getBalanceHex(market.balance) + String(market.balanceMerkleRoot)
//   const marketDetailsHex = getMarketDetailsHex(market.details)
//   const marketStatusHex = getMarketStatusHex(market.status)

//   token.setDataPart(`${identifier} ${marketDetailsHex} ${marketStatusHex + marketBalanceHex}`)

//   return token.lockingScript as bsv.Script
// }

// export function getOpReturnHex(market: marketInfo): string {
//   const marketBalanceHex = getBalanceHex(market.balance) + String(market.balanceMerkleRoot)
//   const marketDetailsHex = getMarketDetailsHex(market.details)
//   const marketStatusHex = getMarketStatusHex(market.status)

//   return `${identifier} ${marketDetailsHex} ${marketStatusHex + marketBalanceHex}`
// }

export function getOpReturnData(script: bsv.Script): string[] {
  const asm = script.toASM().split(" ")
  return asm.slice(asm.length - opReturnDataLength, asm.length)
}

export function getMinerDetails(script: bsv.Script): minerDetail[] {
  const data = getOpReturnData(script)
  const version = getMarketVersion(data[0])
  const minerHex = script.toASM().split(" ")[version.minerKeyPos]
  return getMinerDetailsFromHex(minerHex)
}

export function getMarketDetails(opReturnData: string[]): marketDetails {
  return getMarketDetailsFromHex(opReturnData[1])
}

export function getMarketStatus(opReturnData: string[]): marketStatus {
  const decisionHex = opReturnData[2].slice(0, marketStatusHexLength)
  return getMarketStatusfromHex(decisionHex)
}

export function getBalance(opReturnData: string[]): balance {
  const balanceHex = opReturnData[2].slice(marketStatusHexLength, marketStatusHexLength + balanceHexLength)
  return getBalanceFromHex(balanceHex)
}

export function getBalanceMerkleRoot(opReturnData: string[]): hash {
  const position = marketStatusHexLength + balanceHexLength
  return opReturnData[2].slice(position, position + 64)
}

export function buildTx(market: marketInfo): bsv.Transaction {
  const token = getToken(market)

  const contractBalance = getLmsrSats(market.balance)

  const tx = new bsv.Transaction()
  tx.addOutput(new bsv.Transaction.Output({ script: token.lockingScript, satoshis: contractBalance }))

  tx.feePerKb(feeb * 1000)

  return tx
}

export function getUpdateTx(
  prevTx: bsv.Transaction,
  market: marketInfo,
  unlockingScript: bsv.Script = bsv.Script.empty()
): bsv.Transaction {
  const tx = buildTx(market)

  tx.addInput(
    bsv.Transaction.Input.fromObject({
      prevTxId: prevTx.hash,
      outputIndex: 0,
      script: unlockingScript,
      output: prevTx.outputs[0] // prevTx of newTx here?
    })
  )
  return tx
}

export function getPreimage(prevTx: bsv.Transaction, newTx: bsv.Transaction): Buffer {
  // TODO: Maybe prevTx could be replaced by a market
  // script could get generated using market.miners
  const preimageBuf = bsv.Transaction.sighash.sighashPreimage(
    newTx,
    sighashType,
    0,
    prevTx.outputs[0].script,
    prevTx.outputs[0].satoshisBN,
    DEFAULT_FLAGS
  )
  return preimageBuf
}

export function getMarketFromScript(script: bsv.Script): marketInfo {
  const data = getOpReturnData(script)
  return {
    version: data[0],
    details: getMarketDetails(data),
    status: getMarketStatus(data),
    miners: getMinerDetails(script),
    balance: getBalance(data),
    balanceMerkleRoot: getBalanceMerkleRoot(data)
  }
}

export function isValidMarketUpdateTx(tx: bsv.Transaction, prevTx: bsv.Transaction, entries: entry[]): boolean {
  const lockingScript = prevTx.outputs[0].script
  const unlockingScript = tx.inputs[0].script
  const interpreter = bsv.Script.Interpreter()
  return (
    interpreter.verify(unlockingScript, lockingScript, tx, 0, DEFAULT_FLAGS, prevTx.outputs[0].satoshisBN) &&
    isValidMarketTx(tx, entries)
  )
}

export function isValidMarketTx(tx: bsv.Transaction, entries: entry[]): boolean {
  const script = tx.outputs[0].script
  const balance = tx.outputs[0].satoshis
  const market = getMarketFromScript(script)

  const hasValidSatBalance = getMarketSatBalance(market.status, entries) <= balance
  const hasValidMarketBalance = market.status.decided ? true : validateEntries(market.balance, entries)

  return (
    tx.verify() === true &&
    !tx.getSerializationError() &&
    isValidMarketInfo(market) &&
    hasValidMarketBalance &&
    hasValidSatBalance
  )
}

export function getAddEntryTx(prevTx: bsv.Transaction, prevEntries: entry[], entry: entry): bsv.Transaction {
  const lastEntry = getEntryHex(prevEntries[prevEntries.length - 1])
  const lastMerklePath = getMerklePath(prevEntries, prevEntries.length - 1)

  const newEntries = prevEntries.concat([entry])
  const newBalance = getMarketBalance(newEntries)
  const newLmsrBalance = lmsrScaled(newBalance)

  const prevMarket = getMarketFromScript(prevTx.outputs[0].script)

  const newMarket: marketInfo = {
    ...prevMarket,
    balance: newBalance,
    balanceMerkleRoot: getMerkleRoot(newEntries)
  }

  const newTx = getUpdateTx(prevTx, newMarket)
  const preimage = getPreimage(prevTx, newTx).toString("hex")
  const lmsrShas = getLmsrShas(newMarket.details.maxLiquidity, newMarket.details.maxShares)
  const lmsrMerklePath = getLmsrMerklePath(newBalance, lmsrShas)

  // const asm = [
  //   preimage,
  //   int2Hex(entry.balance.liquidity, 1),
  //   int2Hex(entry.balance.sharesFor, 1),
  //   int2Hex(entry.balance.sharesAgainst, 1),
  //   entry.publicKey.toString(),
  //   int2Hex(newSatBalance),
  //   lmsrMerklePath,
  //   lastEntry,
  //   lastMerklePath,
  //   "OP_1" // Selects sCrypt function to call
  // ].join(" ")

  const token = getToken(prevMarket)

  token.txContext = { tx: newTx, inputIndex: 0, inputSatoshis: prevTx.outputs[0].satoshis }

  const unlockingScript = token
    .addEntry(
      new SigHashPreimage(preimage),
      entry.balance.liquidity,
      entry.balance.sharesFor,
      entry.balance.sharesAgainst,
      new PubKey(entry.publicKey.toString()),
      newLmsrBalance,
      new Bytes(lmsrMerklePath),
      new Bytes(lastEntry),
      new Bytes(lastMerklePath)
    )
    .toScript() as bsv.Script

  newTx.inputs[0].setScript(unlockingScript)
  return newTx
}

export function getSignature(preimage: Buffer, privateKey: bsv.PrivateKey): Buffer {
  const preimageHash = bsv.crypto.Hash.sha256sha256(preimage)
  const buffer = new bsv.encoding.BufferReader(preimageHash).readReverse()

  return bsv.crypto.ECDSA.sign(buffer, privateKey, "little")
    .set({
      nhashtype: sighashType
    })
    .toTxFormat()
}

export function getUpdateEntryTx(
  prevTx: bsv.Transaction,
  prevEntries: entry[],
  newBalance: balance,
  privKey: bsv.PrivateKey,
  payoutAddress?: string
): bsv.Transaction {
  const publicKey = privKey.publicKey
  const entryIndex = prevEntries.findIndex(entry => entry.publicKey.toString() === publicKey.toString())

  if (entryIndex === -1) throw new Error("No entry with this publicKey found.")

  const oldEntry = prevEntries[entryIndex]
  const newEntry: entry = {
    balance: newBalance,
    publicKey
  }

  const newEntries = [...prevEntries]
  newEntries[entryIndex] = newEntry

  const merklePath = getMerklePath(prevEntries, entryIndex)
  const newMerklePath = getMerklePath(newEntries, entryIndex)

  const prevMarket = getMarketFromScript(prevTx.outputs[0].script)

  const newMarket: marketInfo = {
    ...prevMarket,
    balance: getMarketBalance(newEntries),
    balanceMerkleRoot: getMerkleRootByPath(sha256(getEntryHex(newEntry)), newMerklePath)
  }

  const newTx = getUpdateTx(prevTx, newMarket)

  const preimage = getPreimage(prevTx, newTx)

  const signature = getSignature(preimage, privKey)

  const newLmsrBalance = lmsrScaled(newMarket.balance)

  const shas = getLmsrShas(newMarket.details.maxLiquidity, newMarket.details.maxShares)
  const lmsrMerklePath = getLmsrMerklePath(newMarket.balance, shas)

  const token = getToken(prevMarket)

  token.txContext = { tx: newTx, inputIndex: 0, inputSatoshis: prevTx.outputs[0].satoshis }

  const unlockingScript = token
    .updateEntry(
      new SigHashPreimage(preimage.toString("hex")),
      newBalance.liquidity,
      newBalance.sharesFor,
      newBalance.sharesAgainst,
      oldEntry.balance.liquidity,
      oldEntry.balance.sharesFor,
      oldEntry.balance.sharesAgainst,
      new PubKey(publicKey.toString()),
      new Sig(signature.toString("hex")),
      newLmsrBalance,
      new Bytes(lmsrMerklePath),
      new Bytes(merklePath)
    )
    .toScript() as bsv.Script

  newTx.inputs[0].setScript(unlockingScript)
  if (payoutAddress) newTx.change(payoutAddress)

  return newTx
}

export function getRedeemTx(
  prevTx: bsv.Transaction,
  prevEntries: entry[],
  privKey: bsv.PrivateKey,
  payoutAddress?: string
): bsv.Transaction {
  const publicKey = privKey.publicKey
  const entryIndex = prevEntries.findIndex(entry => entry.publicKey.toString() === publicKey.toString())

  if (entryIndex === -1) throw new Error("No entry with this publicKey found.")

  const oldEntry = prevEntries[entryIndex]
  const newBalance = {
    ...oldEntry.balance,
    sharesFor: 0,
    sharesAgainst: 0
  }
  const newEntry: entry = {
    balance: newBalance,
    publicKey
  }

  const newEntries = [...prevEntries]
  newEntries[entryIndex] = newEntry

  const merklePath = getMerklePath(prevEntries, entryIndex)
  const newMerklePath = getMerklePath(newEntries, entryIndex)

  const prevMarket = getMarketFromScript(prevTx.outputs[0].script)

  const newMarket: marketInfo = {
    ...prevMarket,
    // balance: getMarketBalance(newEntries),
    balanceMerkleRoot: getMerkleRootByPath(sha256(getEntryHex(newEntry)), newMerklePath)
  }

  const sharesRedeemed = prevMarket.status.decision
    ? oldEntry.balance.sharesFor - newBalance.sharesFor
    : oldEntry.balance.sharesAgainst - newBalance.sharesAgainst
  const satsRedeemed = sharesRedeemed * SatScaling

  // const newTx = getRedeemUpdateTx(prevTx, newMarket, satsRedeemed)

  const newTx = getUpdateTx(prevTx, newMarket)
  newTx.outputs[0].satoshis = prevTx.outputs[0].satoshis - satsRedeemed
  // newTx.addOutput(new bsv.Transaction.Output({ script: token.lockingScript, satoshis: contractBalance }))

  const preimage = getPreimage(prevTx, newTx)

  const signature = getSignature(preimage, privKey)

  const token = getToken(prevMarket)

  token.txContext = { tx: newTx, inputIndex: 0, inputSatoshis: prevTx.outputs[0].satoshis }

  const unlockingScript = token
    .redeem(
      new SigHashPreimage(preimage.toString("hex")),
      oldEntry.balance.liquidity,
      oldEntry.balance.sharesFor,
      oldEntry.balance.sharesAgainst,
      new PubKey(publicKey.toString()),
      new Sig(signature.toString("hex")),
      new Bytes(merklePath)
    )
    .toScript() as bsv.Script

  newTx.inputs[0].setScript(unlockingScript)
  if (payoutAddress) newTx.change(payoutAddress)

  return newTx
}

export function getDecideTx(prevTx: bsv.Transaction, result: 1 | 0, signatures: rabinSig[]): bsv.Transaction {
  const sigHex = getMinerSigsString(signatures)

  const prevMarket = getMarketFromScript(prevTx.outputs[0].script)
  const newMarket = {
    ...prevMarket,
    status: {
      decided: true,
      decision: result
    }
  }

  const newTx = getUpdateTx(prevTx, newMarket)
  const preimage = getPreimage(prevTx, newTx)

  const token = getToken(prevMarket)

  token.txContext = { tx: newTx, inputIndex: 0, inputSatoshis: prevTx.outputs[0].satoshis }

  const unlockingScript = token
    .decide(new SigHashPreimage(preimage.toString("hex")), result, new Bytes(sigHex))
    .toScript() as bsv.Script

  newTx.inputs[0].setScript(unlockingScript)
  return newTx
}

export function fundTx(
  tx: bsv.Transaction,
  privateKey: bsv.PrivateKey,
  changeAddress: bsv.Address,
  utxos: bsv.Transaction.UnspentOutput[]
): bsv.Transaction {
  const inputAmount = tx.inputs.length

  tx.change(changeAddress)

  tx.from(utxos)

  const fundingInputs = tx.inputs.slice(inputAmount, tx.inputs.length)

  // Check amount
  if (tx.inputAmount < tx.outputAmount) throw new Error(`Input amount needs to be at least ${tx.outputAmount}`)

  fundingInputs.forEach((input: bsv.Transaction.Input, index: number) => {
    const [signature] = input.getSignatures(tx, privateKey, index + inputAmount)
    if (!signature) throw new Error("Invalid privateKey")
    input.addSignature(tx, signature)
  })

  return tx
}

export function getIntFromOP(op: string): number {
  const numString = op.startsWith("OP") ? op.slice(3) : op
  return parseInt(numString)
}

export function getFunctionName(script: bsv.Script): string {
  const asm = script.toASM().split(" ")

  const functionOp = getIntFromOP(asm[asm.length - 1])

  if (functionOp === 0) {
    return "addEntry"
  } else if (functionOp === 1) {
    return "updateEntry"
  } else if (functionOp === 2) {
    return "redeem"
  } else if (functionOp === 3) {
    return "decide"
  } else {
    throw new Error("No known function")
  }
}

export function getNewEntries(prevEntries: entry[], script: bsv.Script): entry[] {
  const asm = script.toASM().split(" ")

  const functionOp = getIntFromOP(asm[asm.length - 1])
  // const functionPos = parseInt(functionOp.slice(3))
  // const functionName = functionNames[functionPos]

  if (functionOp === 0) {
    // addEntry

    const entry: entry = {
      balance: {
        liquidity: getIntFromOP(asm[1]),
        sharesFor: getIntFromOP(asm[2]),
        sharesAgainst: getIntFromOP(asm[3])
      },
      publicKey: bsv.PublicKey.fromHex(asm[4])
    }

    const newEntries = cloneDeep(prevEntries) as entry[]
    newEntries.push(entry)
    return newEntries
  } else if (functionOp === 1) {
    // updateEntry

    const publicKey = bsv.PublicKey.fromHex(asm[7])

    const entry: entry = {
      balance: {
        liquidity: getIntFromOP(asm[1]),
        sharesFor: getIntFromOP(asm[2]),
        sharesAgainst: getIntFromOP(asm[3])
      },
      publicKey
    }

    const entryIndex = prevEntries.findIndex(entry => entry.publicKey.toString() === publicKey.toString())

    const newEntries = cloneDeep(prevEntries) as entry[]
    newEntries[entryIndex] = entry
    return newEntries
  } else if (functionOp === 2) {
    // redeem

    const publicKey = bsv.PublicKey.fromHex(asm[4])
    const entryIndex = prevEntries.findIndex(entry => entry.publicKey.toString() === publicKey.toString())

    const entry = cloneDeep(prevEntries[entryIndex]) as entry
    entry.balance.sharesFor = 0
    entry.balance.sharesAgainst = 0

    const newEntries = cloneDeep(prevEntries) as entry[]
    newEntries[entryIndex] = entry
    return newEntries
  } else {
    return prevEntries
  }
}
