"use strict";

import RPCServer from "./rpc";
import ProviderRpcError from "./error";
import Utils from "./utils";
import IdMapping from "./id_mapping";
import { EventEmitter } from "events";
import isUtf8 from "isutf8";
import { TypedDataUtils } from "eth-sig-util";

import 'web3/dist/web3.min.js'

class U2UWeb3Provider extends EventEmitter {
  constructor(config) {
    super();
    this.setConfig(config);

    this.idMapping = new IdMapping();
    this.callbacks = new Map();
    this.wrapResults = new Map();
    this.isU2UWallet = true;
    this.isDebug = !!config.isDebug;

    this.emitConnect(Number(config.chainId));
  }

  setAddress(address) {
    const lowerAddress = (address || "").toLowerCase();
    this.address = lowerAddress;
    this.ready = !!address;
    for (var i = 0; i < window.frames.length; i++) {
      const frame = window.frames[i];
      if (frame.u2u && frame.u2u.isU2UWallet) {
        frame.u2u.address = lowerAddress;
        frame.u2u.ready = !!address;
      }
    }
  }

  setConfig(config) {
    this.setAddress(config.address);

    this.chainId = Number(config.chainId);
    this.rpc = new RPCServer(config.rpcUrl);
    this.isDebug = !!config.isDebug;
  }

  request(payload) {
    // this points to window in methods like web3.eth.getAccounts()
    var that = this;
    if (!(this instanceof U2UWeb3Provider)) {
      that = window.u2u;
    }
    return that._request(payload, false);
  }

  /**
   * @deprecated Listen to "connect" event instead.
   */
  isConnected() {
    return true;
  }

  /**
   * @deprecated Use request({method: "eth_requestAccounts"}) instead.
   */
  enable() {
    return this.request({ method: "eth_requestAccounts", params: [] });
  }

  /**
   * @deprecated Use request() method instead.
   */
  send(payload) {
    let response = { jsonrpc: "2.0", id: payload.id };
    switch (payload.method) {
      case "eth_accounts":
        response.result = this.eth_accounts();
        break;
      case "eth_coinbase":
        response.result = this.eth_coinbase();
        break;
      case "net_version":
        response.result = this.net_version();
        break;
      case "eth_chainId":
        response.result = this.eth_chainId();
        break;
      default:
        throw new ProviderRpcError(
          4200,
          `U2U Wallet does not support calling ${payload.method} synchronously without a callback. Please provide a callback parameter to call ${payload.method} asynchronously.`
        );
    }
    return response;
  }

  /**
   * @deprecated Use request() method instead.
   */
  sendAsync(payload, callback) {
    // this points to window in methods like web3.eth.getAccounts()
    var that = this;
    if (!(this instanceof U2UWeb3Provider)) {
      that = window.ethereum;
    }
    if (Array.isArray(payload)) {
      Promise.all(payload.map(that._request.bind(that)))
        .then((data) => callback(null, data))
        .catch((error) => callback(error, null));
    } else {
      that
        ._request(payload)
        .then((data) => callback(null, data))
        .catch((error) => callback(error, null));
    }
  }

  /**
   * @private Internal rpc handler
   */
  _request(payload, wrapResult = true) {
    this.idMapping.tryIntifyId(payload);
    return new Promise((resolve, reject) => {
      if (!payload.id) {
        payload.id = Utils.genId();
      }
      this.callbacks.set(payload.id, (error, data) => {
        if (error) {
          reject(error);
        } else {
          resolve(data);
        }
      });
      this.wrapResults.set(payload.id, wrapResult);
      switch (payload.method) {
        case "eth_accounts":
          return this.sendResponse(payload.id, this.eth_accounts());
        case "eth_coinbase":
          return this.sendResponse(payload.id, this.eth_coinbase());
        case "net_version":
          return this.sendResponse(payload.id, this.net_version());
        case "eth_chainId":
          return this.sendResponse(payload.id, this.eth_chainId());
        case "eth_sign":
          return this.eth_sign(payload);
        case "personal_sign":
          return this.personal_sign(payload);
        case "personal_ecRecover":
          return this.personal_ecRecover(payload);
        case "eth_signTypedData_v3":
          return this.eth_signTypedData(payload, false);
        case "eth_signTypedData":
        case "eth_signTypedData_v4":
          return this.eth_signTypedData(payload, true);
        case "eth_sendTransaction":
          return this.eth_sendTransaction(payload);
        case "eth_requestAccounts":
          return this.eth_requestAccounts(payload);
        case "wallet_watchAsset":
          return this.wallet_watchAsset(payload);
        case "wallet_addEthereumChain":
          return this.wallet_addEthereumChain(payload);
        case "eth_newFilter":
        case "eth_newBlockFilter":
        case "eth_newPendingTransactionFilter":
        case "eth_uninstallFilter":
        case "eth_subscribe":
          throw new ProviderRpcError(
            4200,
            `U2U Wallet does not support calling ${payload.method}. Please use your own solution`
          );
        default:
          // call upstream rpc
          this.callbacks.delete(payload.id);
          this.wrapResults.delete(payload.id);
          return this.rpc
            .call(payload)
            .then((response) => {
              wrapResult ? resolve(response) : resolve(response.result);
            })
            .catch(reject);
      }
    });
  }

  emitConnect(chainId) {
    this.emit("connect", { chainId: chainId });
  }

  eth_accounts() {
    return this.address ? [this.address] : [];
  }

  eth_coinbase() {
    return this.address;
  }

  net_version() {
    return this.chainId.toString(10) || null;
  }

  eth_chainId() {
    return "0x" + this.chainId.toString(16);
  }

  eth_sign(payload) {
    const buffer = Utils.messageToBuffer(payload.params[1]);
    const hex = Utils.bufferToHex(buffer);
    if (isUtf8(buffer)) {
      this.postMessage("signPersonalMessage", payload.id, { data: hex });
    } else {
      this.postMessage("signMessage", payload.id, { data: hex });
    }
  }

  personal_sign(payload) {
    const message = payload.params[0];
    this.postMessage("signPersonalMessage", payload.id, { data: message });
    // const buffer = Utils.messageToBuffer(message);
    // if (buffer.length === 0) {
    //   // hex it
    //   const hex = Utils.bufferToHex(message);
    //   this.postMessage("signPersonalMessage", payload.id, { data: hex });
    // } else {
    //   this.postMessage("signPersonalMessage", payload.id, { data: message });
    // }
  }

  personal_ecRecover(payload) {
    this.postMessage("ecRecover", payload.id, {
      signature: payload.params[1],
      message: payload.params[0],
    });
  }

  eth_signTypedData(payload, useV4) {
    const message = JSON.parse(payload.params[1]);
    const hash = TypedDataUtils.sign(message, useV4);
    this.postMessage("signTypedMessage", payload.id, {
      data: "0x" + hash.toString("hex"),
      raw: payload.params[1],
    });
  }

  eth_sendTransaction(payload) {
    this.postMessage("signTransaction", payload.id, payload.params[0]);
  }

  eth_requestAccounts(payload) {
    this.postMessage("requestAccounts", payload.id, {});
  }

  wallet_watchAsset(payload) {
    let options = payload.params.options;
    this.postMessage("watchAsset", payload.id, {
      type: payload.type,
      contract: options.address,
      symbol: options.symbol,
      decimals: options.decimals || 0,
    });
  }

  wallet_addEthereumChain(payload) {
    this.postMessage("addEthereumChain", payload.id, payload.params[0]);
  }

  /**
   * @private Internal js -> native message handler
   */
  postMessage(handler, id, data) {
    if (this.ready || handler === "requestAccounts") {
      let object = {
        id: id,
        name: handler,
        object: data,
      };
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify(object));
      }
    } else {
      // don't forget to verify in the app
      this.sendError(id, new ProviderRpcError(4100, "provider is not ready"));
    }
  }

  remoteEmit(eventName, message) {
    let dataToEmit
    if (typeof message === 'string') {
      try {
        dataToEmit = JSON.parse(message)
      } catch (error) {
        dataToEmit = message; 
      }
    } else {
      dataToEmit = message;
    }
    this.emit(eventName, dataToEmit)
  }

  /**
   * @private Internal native result -> js
   */
  sendResponse(id, result) {
    let originId = this.idMapping.tryPopId(id) || id;
    let callback = this.callbacks.get(id);
    let wrapResult = this.wrapResults.get(id);
    let data = { jsonrpc: "2.0", id: originId };
    if (typeof result === "object" && result.jsonrpc && result.result) {
      data.result = result.result;
    } else if (typeof result === 'string') {
      try {
        const parsed = JSON.parse(result)
        data.result = parsed
      } catch (error) {
        data.result = result; 
      }
    } else {
      data.result = result;
    }
    if (callback) {
      wrapResult ? callback(null, data) : callback(null, result);
      this.callbacks.delete(id);
    } else {
      // check if it's iframe callback
      for (var i = 0; i < window.frames.length; i++) {
        const frame = window.frames[i];
        try {
          if (frame.u2u.callbacks.has(id)) {
            frame.u2u.sendResponse(id, result);
          }
        } catch (error) {
          console.log(`send response to frame error: ${error}`);
        }
      }
    }
  }

  /**
   * @private Internal native error -> js
   */
  sendError(id, error) {
    let callback = this.callbacks.get(id);
    if (callback) {
      callback(error instanceof Error ? error : new Error(error), null);
      this.callbacks.delete(id);
    }
  }
};

window.ethereum = new U2UWeb3Provider({
  address: '{{WALLET_ADDRESS}}',
  chainId: '{{CHAIN_ID}}',
  rpcUrl: '{{RPC_URL}}',
  isDebug: false
});

window.u2u = new U2UWeb3Provider({
  address: '{{WALLET_ADDRESS}}',
  chainId: '{{CHAIN_ID}}',
  rpcUrl: '{{RPC_URL}}',
  isDebug: false
});

// DEBUG
if (window.ReactNativeWebView) {
  console = new Object();
  console.log = function(log, type = 'log') {
    window.ReactNativeWebView.postMessage(JSON.stringify({
      type: type,
      data: log
    }));
  };
  console.debug = (...args) => console.log(args, 'debug');
  console.info = (...args) => console.log(args, 'info');
  console.warn = (...args) => console.log(args, 'warn');
  console.error = (...args) => console.log(args, 'error');
}
