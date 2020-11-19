import { buildInitTx, fundTx, getAddEntryUnlockingScript } from "../src/transaction"
import { privKeyToPubKey } from "rabinsig"
import bsv from "bsv"

const privKey1 = {
  p: 3097117482495218740761570398276008894011381249145414887346233174147008460690669803628686127894575795412733149071918669075694907431747167762627687052467n,
  q: 650047001204168007801848889418948532353073326909497585177081016045346562912146630794965372241635285465610094863279373295872825824127728241709483771067n
}

const privKey2 = {
  p: 5282996768621071377953148561714230757875959595062017918330039194973991105026912034418577469175391947647260152227014115175065212479767996019477136300223n,
  q: 650047001204168007801848889418948532353073326909497585177081016045346562912146630794965372241635285465610094863279373295872825824127728241709483771067n
}

const pubKey1 = privKeyToPubKey(privKey1.p, privKey1.q)
const pubKey2 = privKeyToPubKey(privKey2.p, privKey2.q)

const minerDetails = [
  {
    pubKey: pubKey1,
    votes: 40
  },
  {
    pubKey: pubKey2,
    votes: 60
  }
]

const marketDetails = {
  resolve: "test"
}

const privateKey = bsv.PrivateKey.fromRandom()

const liquidity = 1

const utxoData = [
  {
    address: "18VfMk5AUgaJWiDBCvVN9ckmZnSjc2sYdW",
    txid: "740d05345f5acbbfe5ef042c54a996367d0f43fd8c9f5242c05f01b99d3ed9ec",
    vout: 1,
    amount: 0.00008,
    satoshis: 8000,
    value: 8000,
    height: 661843,
    confirmations: 82,
    scriptPubKey: "76a91452348bf81d90282c6b38d11a24474cd498ccd29c88ac",
    script: "76a91452348bf81d90282c6b38d11a24474cd498ccd29c88ac",
    outputIndex: 1
  }
]

const utxos = utxoData.map(utxo => bsv.Transaction.UnspentOutput.fromObject(utxo))

test("build pm init transaction", () => {
  const tx = buildInitTx(marketDetails, liquidity, privateKey.publicKey, minerDetails)
  const funded = fundTx(tx, privateKey, utxos)
  expect(funded.verify()).toBe(true)
})

// test("create addEntry unlocking script", () => {
//   getAddEntryUnlockingScript()
// })