import { toByteArray as decodeBase64 } from "base64-js";
import { base16 } from "../utils";
import * as pkijs from "pkijs";
import * as asn1js from "asn1js";
import * as pvutils from "pvutils";

const SPLIT_PEM = /-{5}(BEGIN|END) .*-{5}/gm;


export async function verifyWACZSignature({hash, signature, publicKey, domain, domainCert, created} = {}) {
  signature = decodeBase64(signature);

  let domainActual;

  const results = [];

  if (domainCert && domain && !publicKey) {
    const certs = domainCert.split("\n\n");

    let certBuffer = decodeBase64(certs[0].replace(SPLIT_PEM, "").replace(/\s/gm, ""));

    const cert = pkijs.Certificate.fromBER(certBuffer);

    const fingerprint = base16(await crypto.subtle.digest("SHA-256", certBuffer));

    results.push({id: "certFingerprint", expected: fingerprint, matched: null});

    publicKey = await cert.getPublicKey();

    // extract r|s values from asn1

    try {
      const sigasn1 = asn1js.fromBER(signature.buffer);

      const sigvalues = sigasn1.result.valueBlock.value;

      if (sigvalues.length === 2) {
        const n0 = new Uint8Array(sigvalues[0].valueBlock.valueHex);
        const n1 = new Uint8Array(sigvalues[1].valueBlock.valueHex);

        const inx0 = n0[0] === 0 ? 1 : 0;
        const inx1 = n1[0] === 0 ? 1 : 0;

        signature = pvutils.utilConcatBuf(n0.slice(inx0), n1.slice(inx1));
      }
    } catch (se) {
      console.log(se);
    }

    // CommonName Field
    const CN = "2.5.4.3";

    for (const typeAndVal of cert.subject.typesAndValues) {
      if (typeAndVal.type === CN) {
        domainActual = typeAndVal.value.valueBlock.value;
        break;
      }
    }
  
  } else {
    const ecdsaImportParams = {
      name: "ECDSA",
      namedCurve: "P-384"
    };

    publicKey = await crypto.subtle.importKey("spki", decodeBase64(publicKey), ecdsaImportParams, true, ["verify"]);
  }

  const ecdsaSignParams = {
    name: "ECDSA",
    hash: "SHA-256"
  };

  const encoder = new TextEncoder();

  const sigValid = await crypto.subtle.verify(ecdsaSignParams, publicKey, signature, encoder.encode(hash));

  results.push({id: "signature", expected: true, matched: sigValid});

  if (created) {
    results.push({id: "created", expected: created, matched: null});
  }

  if (domain) {
    results.push({id: "domain", expected: domain, matched: domainActual});
  }

  return results;
}