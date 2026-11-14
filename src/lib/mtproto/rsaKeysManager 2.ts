/*
 * Originally from:
 * https://github.com/zhukov/webogram
 * Copyright (C) 2014 Igor Zhukov <igor.beatle@gmail.com>
 * https://github.com/zhukov/webogram/blob/master/LICENSE
 */

import {TLSerialization} from '@lib/mtproto/tl_utils';
import cryptoWorker from '@lib/crypto/cryptoMessagePort';
import bytesFromHex from '@helpers/bytes/bytesFromHex';
import bytesToHex from '@helpers/bytes/bytesToHex';
import bigInt from 'big-integer';

export type RSAPublicKeyHex = {
  modulus: string,
  exponent: string
};

/**
 * Публичный RSA-ключ ВАШЕГО сервера (mtproto_server.py).
 * При запуске сервер печатает в консоли блок «КЛЮЧ ДЛЯ tweb»: скопируйте modulus оттуда.
 * modulus: 512 символов hex без пробелов и без ведущих нулей, exponent: '010001'.
 */
const SERVER_RSA_KEY: RSAPublicKeyHex = {
  modulus: 'PASTE_MODULUS_HERE',
  exponent: '010001'
};

export class RSAKeysManager {
  // Ключи Telegram убраны: клиент должен доверять только вашему серверу.
  private publisKeysHex: RSAPublicKeyHex[] = [SERVER_RSA_KEY];

  private publicKeysParsed: {
    [hex: string]: RSAPublicKeyHex
  } = {};
  private prepared = false;
  private preparePromise: Promise<void> = null;

  public prepare(): Promise<void> {
    if(this.preparePromise) return this.preparePromise;
    else if(this.prepared) {
      return Promise.resolve();
    }

    if(!/^[0-9a-f]{512}$/i.test(SERVER_RSA_KEY.modulus)) {
      return Promise.reject(new Error('[MT] SERVER_RSA_KEY.modulus не задан: вставьте modulus из консоли сервера в rsaKeysManager.ts'));
    }

    return this.preparePromise = Promise.all(this.publisKeysHex.map((keyParsed) => {
      const RSAPublicKey = new TLSerialization();
      RSAPublicKey.storeBytes(bytesFromHex(keyParsed.modulus), 'n');
      RSAPublicKey.storeBytes(bytesFromHex(keyParsed.exponent), 'e');

      const buffer = RSAPublicKey.getBuffer();

      return cryptoWorker.invokeCrypto('sha1', buffer).then((bytes) => {
        const fingerprintBytes = bytes.slice(-8);
        fingerprintBytes.reverse();

        this.publicKeysParsed[bytesToHex(fingerprintBytes).toLowerCase()] = {
          modulus: keyParsed.modulus,
          exponent: keyParsed.exponent
        };
      });
    })).then(() => {
      this.prepared = true;

      // console.log('[MT] Prepared keys');
      this.preparePromise = null;
    });
  }

  public async select(fingerprints: Array<string>) {
    await this.prepare();

    for(let i = 0; i < fingerprints.length; ++i) {
      let fingerprintHex = bigInt(fingerprints[i]).toString(16).toLowerCase();

      if(fingerprintHex.length < 16) {
        fingerprintHex = new Array(16 - fingerprintHex.length).fill('0').join('') + fingerprintHex;
      }

      // console.log(fingerprintHex, this.publicKeysParsed);
      const foundKey = this.publicKeysParsed[fingerprintHex];
      if(foundKey) {
        return Object.assign({
          fingerprint: fingerprints[i]
        }, foundKey);
      }
    }
  }
}

export default new RSAKeysManager();
