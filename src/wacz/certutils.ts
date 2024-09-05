import {
  toByteArray as decodeBase64,
  fromByteArray as encodeBase64,
} from "base64-js";
import { base16 } from "../utils";

import * as x509 from "@peculiar/x509";
import { AsnParser } from "@peculiar/asn1-schema";
import { ECDSASigValue } from "@peculiar/asn1-ecc";
//import { ASN1 } from "asn1-parser";

import { concatChunks } from "warcio";

const SPLIT_PEM = /-{5}(BEGIN|END) .*-{5}/gm;

type VerifySigData = {
  hash: string;
  signature: string;
  publicKey: string;
  domain: string;
  domainCert: string;
  created: string;
  software: string;
};

type VerifyResult = {
  id: string;
  // [TODO]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  expected: any;
  // [TODO]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-redundant-type-constituents
  matched: any | null;
};

export async function verifyWACZSignature({
  hash,
  signature,
  publicKey,
  domain,
  domainCert,
  created,
  software,
}: VerifySigData) {
  let domainActual;
  const results: VerifyResult[] = [];

  const signatureBuff = decodeBase64(signature);

  let publicKeyCrypto: CryptoKey;

  if (domainCert && domain && !publicKey) {
    const certs = domainCert.split("\n\n");

    const certBuffer = decodeBase64(
      // @ts-expect-error [TODO] - TS2532 - Object is possibly 'undefined'.
      certs[0].replace(SPLIT_PEM, "").replace(/\s/gm, ""),
    );

    const fingerprint = base16(
      await crypto.subtle.digest("SHA-256", certBuffer),
    );
    results.push({
      id: "certFingerprint",
      expected: fingerprint,
      matched: null,
    });

    const cert = new x509.X509Certificate(certBuffer);

    publicKeyCrypto = await cert.publicKey.export();

    const publicKeyEncoded = encodeBase64(
      new Uint8Array(cert.publicKey.rawData),
    );
    results.push({
      id: "publicKey",
      expected: publicKeyEncoded,
      matched: null,
    });

    // [TODO]
    // eslint-disable-next-line @typescript-eslint/prefer-optional-chain
    if (cert.subject && cert.subject.startsWith("CN=")) {
      domainActual = cert.subject.substring(3);
    }

    //signature = parseASN1Signature(signature);
  } else {
    const ecdsaImportParams = {
      name: "ECDSA",
      namedCurve: "P-384",
    };

    results.push({ id: "publicKey", expected: publicKey, matched: null });

    publicKeyCrypto = await crypto.subtle.importKey(
      "spki",
      decodeBase64(publicKey),
      ecdsaImportParams,
      true,
      ["verify"],
    );
  }

  const ecdsaSignParams = {
    name: "ECDSA",
    hash: "SHA-256",
  };

  const encoder = new TextEncoder();

  const sigValid = await crypto.subtle.verify(
    ecdsaSignParams,
    publicKeyCrypto,
    signatureBuff,
    encoder.encode(hash),
  );

  results.push({ id: "signature", expected: true, matched: sigValid });

  if (created) {
    results.push({ id: "created", expected: created, matched: null });
  }

  if (software) {
    results.push({ id: "software", expected: software, matched: null });
  }

  if (domain) {
    results.push({ id: "domain", expected: domain, matched: domainActual });
  }

  return results;
}

// [TODO]
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function parseASN1Signature(signature: Uint8Array) {
  // extract r|s values from asn1
  try {
    const sig = AsnParser.parse(signature, ECDSASigValue);

    const sigR = sig.r as Uint8Array;
    const sigS = sig.s as Uint8Array;

    const r = sigR[0] === 0 ? sigR.slice(1) : sigR;
    const s = sigS[0] === 0 ? sigS.slice(1) : sigS;
    signature = concatChunks([r, s], r.length + s.length);
  } catch (se) {
    console.log(se);
  }

  return signature;
}

// function parseSignature2(signature) {
//   // extract r|s values from asn1
//     try {
//       signature = decodeBase64(signature);

//       const result = ASN1.parse(signature);
//
//       if (result && result.children && result.children.length == 2) {
//         const r = result.children[0].value;
//         const s = result.children[1].value;
//
//         signature = concatChunks([r, s], r.length + s.length);
//       }
//
//     } catch (se) {
//       console.log(se);
//     }
//
//     return signature;
//   }
