import { toByteArray as decodeBase64 } from "base64-js";
import { base16 } from "../utils";

import * as x509 from "@peculiar/x509";
import { AsnParser } from "@peculiar/asn1-schema";
import { ECDSASigValue } from "@peculiar/asn1-ecc";

import { concatChunks } from "warcio";

const SPLIT_PEM = /-{5}(BEGIN|END) .*-{5}/gm;

export async function verifyWACZSignature({hash, signature, publicKey, domain, domainCert, created} = {}) {
  signature = decodeBase64(signature);

  let domainActual;

  const results = [];

  if (domainCert && domain && !publicKey) {
    const certs = domainCert.split("\n\n");

    const certBuffer = decodeBase64(certs[0].replace(SPLIT_PEM, "").replace(/\s/gm, ""));

    const fingerprint = base16(await crypto.subtle.digest("SHA-256", certBuffer));

    const cert = new x509.X509Certificate(certBuffer);

    results.push({id: "certFingerprint", expected: fingerprint, matched: null});

    publicKey = await cert.publicKey.export();

    // extract r|s values from asn1
    try {
      const sig = AsnParser.parse(signature, ECDSASigValue);

      const r = sig.r[0] === 0 ? sig.r.slice(1) : sig.r;
      const s = sig.s[0] === 0 ? sig.s.slice(1) : sig.s;
      signature = concatChunks([r, s], r.length + s.length);

    } catch (se) {
      console.log(se);
    }

    if (cert.subject && cert.subject.startsWith("CN=")) {
      domainActual = cert.subject.split(3);
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