/*
 * Originally from:
 * https://github.com/zhukov/webogram
 * Copyright (C) 2014 Igor Zhukov <igor.beatle@gmail.com>
 * https://github.com/zhukov/webogram/blob/master/LICENSE
 */

import MTTransport, {MTConnectionConstructable} from '@lib/mtproto/transports/transport';
import Modes from '@config/modes';
import indexOfAndSplice from '@helpers/array/indexOfAndSplice';
import Socket from '@lib/mtproto/transports/websocket';
import HTTP from '@lib/mtproto/transports/http';
import TcpObfuscated from '@lib/mtproto/transports/tcpObfuscated';
import {IS_WEB_WORKER} from '@helpers/context';
import {DcId} from '@types';
import {getEnvironment} from '@environment/utils';
import SocketProxied from '@lib/mtproto/transports/socketProxied';
import isValidDcId from '@lib/mtproto/isValidDcId';

export type TransportType = 'websocket' | 'https' | 'http';
export type ConnectionType = 'client' | 'download' | 'upload';
type Servers = {
  [transportType in TransportType]: {
    [connectionType in ConnectionType]: {
      [dcId: DcId]: MTTransport[]
    }
  }
};

/* ============================ НАСТРОЙКИ СВОЕГО СЕРВЕРА ============================ */
const SERVER_HOST = 'telega.wispbyte.app';
const SERVER_PORT = 14486;      // 0 или 443 для TLS: порт в адресе не пишется
// wss:// если страница открыта по HTTPS (иначе браузер заблокирует ws://), ws:// если по обычному HTTP.
// Работает и в воркерах: у них тот же origin, что у страницы.
const SERVER_TLS = typeof self !== 'undefined' && self.location?.protocol === 'https:';
const SERVER_PATH = 'apiws';
/* ================================================================================= */

const RETRY_TIMEOUT_CLIENT = 3000;
const RETRY_TIMEOUT_DOWNLOAD = 3000;

export function getTelegramConnectionSuffix(connectionType: ConnectionType) {
  return connectionType === 'client' ? '' : '-1';
}

// dcId can arrive from the service worker's `stream/` route (a URL any page can craft),
// so it is still validated, even though it no longer ends up in the host name.
export function assertValidDcId(dcId: DcId): DcId {
  if(!isValidDcId(dcId)) {
    throw new Error('[MT] invalid dcId: ' + dcId);
  }

  return +dcId as DcId;
}

/**
 * Один и тот же адрес для всех дата-центров и типов соединений: сервер у нас один.
 */
export function constructTelegramWebSocketUrl(_dcId: DcId, _connectionType: ConnectionType, _premium?: boolean) {
  assertValidDcId(_dcId);

  const scheme = SERVER_TLS ? 'wss' : 'ws';
  const defaultPort = SERVER_TLS ? 443 : 80;
  const port = SERVER_PORT && SERVER_PORT !== defaultPort ? ':' + SERVER_PORT : '';
  return `${scheme}://${SERVER_HOST}${port}/${SERVER_PATH}`;
}

/**
 * HTTP-транспорт нужен tweb только для сравнения скорости с WebSocket (он пингует оба).
 * Указываем на наш же сервер: на Telegram запросы не уходят.
 */
export function constructTelegramHttpUrl(_dcId: DcId, _connectionType: ConnectionType) {
  const scheme = SERVER_TLS ? 'https' : 'http';
  const defaultPort = SERVER_TLS ? 443 : 80;
  const port = SERVER_PORT && SERVER_PORT !== defaultPort ? ':' + SERVER_PORT : '';
  return `${scheme}://${SERVER_HOST}${port}/apiw1`;
}

export class DcConfigurator {
  public chosenServers: Servers = {} as any;

  private transportSocket = (dcId: DcId, connectionType: ConnectionType, premium?: boolean) => {
    const chosenServer = constructTelegramWebSocketUrl(dcId, connectionType, premium);
    const logSuffix = connectionType === 'upload' ? '-U' : connectionType === 'download' ? '-D' : '';

    const retryTimeout = connectionType === 'client' ? RETRY_TIMEOUT_CLIENT : RETRY_TIMEOUT_DOWNLOAD;

    let oooohLetMeLive: MTConnectionConstructable;
    if(import.meta.env.VITE_MTPROTO_SW || !import.meta.env.VITE_SAFARI_PROXY_WEBSOCKET) {
      oooohLetMeLive = Socket;
    } else {
      oooohLetMeLive = (getEnvironment().IS_SAFARI && IS_WEB_WORKER && typeof(SocketProxied) !== 'undefined') /* || true */ ? SocketProxied : Socket;
    }

    return new TcpObfuscated(oooohLetMeLive, dcId, chosenServer, logSuffix, retryTimeout);
  };

  private transportHTTP = (dcId: DcId, connectionType: ConnectionType, _premium?: boolean) => {
    const chosenServer = constructTelegramHttpUrl(dcId, connectionType);
    const logSuffix = connectionType === 'upload' ? '-U' : connectionType === 'download' ? '-D' : '';
    return new HTTP(dcId, chosenServer, logSuffix);
  };

  public chooseServer(
    dcId: DcId,
    connectionType: ConnectionType = 'client',
    transportType: TransportType = Modes.transport,
    reuse = true,
    premium?: boolean
  ) {
    dcId = assertValidDcId(dcId);

    if(!this.chosenServers.hasOwnProperty(transportType)) {
      this.chosenServers[transportType] = {
        client: {},
        download: {},
        upload: {}
      };
    }

    const servers = this.chosenServers[transportType][connectionType];

    if(!(dcId in servers)) {
      servers[dcId] = [];
    }

    const transports = servers[dcId];

    if(!transports.length || !reuse/*  || (upload && transports.length < 1) */) {
      // websocket -> наш /apiws, остальные типы -> HTTP на наш же сервер (/apiw1)
      const transport: MTTransport = (transportType === 'websocket' ? this.transportSocket : this.transportHTTP)(dcId, connectionType, premium);

      if(!transport) {
        console.error('No chosenServer!', dcId);
        return null;
      }

      if(reuse) {
        transports.push(transport);
      }

      return transport;
    }

    return transports[0];
  }

  public static removeTransport<T>(obj: any, transport: T) {
    for(const transportType in obj) {
      // @ts-ignore
      for(const connectionType in obj[transportType]) {
        // @ts-ignore
        for(const dcId in obj[transportType][connectionType]) {
          // @ts-ignore
          const transports: T[] = obj[transportType][connectionType][dcId];
          indexOfAndSplice(transports, transport);
        }
      }
    }
  }
}
