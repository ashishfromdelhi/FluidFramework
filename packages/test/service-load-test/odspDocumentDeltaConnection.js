"use strict";
/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.OdspDocumentDeltaConnection = void 0;
const common_utils_1 = require("@fluidframework/common-utils");
const driver_base_1 = require("@fluidframework/driver-base");
const uuid_1 = require("uuid");
const odspError_1 = require("./odspError");
const protocolVersions = ["^0.4.0", "^0.3.0", "^0.2.0", "^0.1.0"];
// How long to wait before disconnecting the socket after the last reference is removed
// This allows reconnection after receiving a nack to be smooth
const socketReferenceBufferTime = 2000;
class SocketReference {
    constructor(key, socket) {
        this.key = key;
        this.references = 1;
        // When making decisions about socket reuse, we do not reuse disconnected socket.
        // But we want to differentiate the following case from disconnected case:
        // Socket that never connected and never failed, it's in "attempting to connect" mode
        // such sockets should be reused, despite socket.disconnected === true
        this.isPendingInitialConnection = true;
        this._socket = socket;
        SocketReference.socketIoSockets.set(key, this);
        // The server always closes the socket after sending this message
        // fully remove the socket reference now
        socket.on("server_disconnect", (socketError) => {
            // Treat all errors as recoverable, and rely on joinSession / reconnection flow to
            // filter out retryable vs. non-retryable cases.
            const error = odspError_1.errorObjectFromSocketError(socketError, "server_disconnect");
            error.canRetry = true;
            // see comment in disconnected() getter
            // Setting it here to ensure socket reuse does not happen if new request to connect
            // comes in from "disconnect" listener below, before we close socket.
            this.isPendingInitialConnection = false;
            socket.emit("disconnect", error);
            this.closeSocket();
        });
    }
    static find(key, logger) {
        const socketReference = SocketReference.socketIoSockets.get(key);
        // Verify the socket is healthy before reusing it
        if (socketReference && socketReference.disconnected) {
            // The socket is in a bad state. fully remove the reference
            socketReference.closeSocket();
            return undefined;
        }
        if (socketReference) {
            // Clear the pending deletion if there is one
            socketReference.clearTimer();
            socketReference.references++;
            logger.sendTelemetryEvent({
                references: socketReference.references,
                eventName: "OdspDocumentDeltaCollection.GetSocketIoReference",
                delayDeleteDelta: socketReference.delayDeleteTimeoutSetTime !== undefined ?
                    (Date.now() - socketReference.delayDeleteTimeoutSetTime) : undefined,
            });
        }
        return socketReference;
    }
    /**
     * Removes a reference for the given key
     * Once the ref count hits 0, the socket is disconnected and removed
     * @param key - socket reference key
     * @param isFatalError - true if the socket reference should be removed immediately due to a fatal error
     */
    removeSocketIoReference(isFatalError) {
        common_utils_1.assert(this.references > 0);
        this.references--;
        // see comment in disconnected() getter
        this.isPendingInitialConnection = false;
        if (isFatalError || this.disconnected) {
            this.closeSocket();
            return;
        }
        if (this.references === 0 && this.delayDeleteTimeout === undefined) {
            this.delayDeleteTimeout = setTimeout(() => {
                // We should not get here with active users.
                common_utils_1.assert(this.references === 0);
                this.closeSocket();
            }, socketReferenceBufferTime);
            this.delayDeleteTimeoutSetTime = Date.now();
        }
    }
    get socket() {
        if (!this._socket) {
            throw new Error(`Invalid socket for key "${this.key}`);
        }
        return this._socket;
    }
    clearTimer() {
        if (this.delayDeleteTimeout !== undefined) {
            clearTimeout(this.delayDeleteTimeout);
            this.delayDeleteTimeout = undefined;
            this.delayDeleteTimeoutSetTime = undefined;
        }
    }
    closeSocket() {
        if (!this._socket) {
            return;
        }
        this.clearTimer();
        common_utils_1.assert(SocketReference.socketIoSockets.get(this.key) === this);
        SocketReference.socketIoSockets.delete(this.key);
        const socket = this._socket;
        this._socket = undefined;
        // Delay closing socket, to make sure all users of socket observe the same event that causes
        // this instance to close, and thus properly record reason for clusure.
        // All event raising is synchronous, so clients will have a chance to react before socket is
        // closed without any extra data on why it was closed.
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        Promise.resolve().then(() => { socket.disconnect(); });
    }
    get disconnected() {
        if (this._socket === undefined) {
            return true;
        }
        if (this.socket.connected) {
            return false;
        }
        // We have a socket that is not connected. Possible cases:
        // 1) It was connected some time ago and lost connection. We do not want to reuse it.
        // 2) It failed to connect (was never connected).
        // 3) It was just created and never had a chance to connect - connection is in process.
        // We have to differentiate 1 from 2-3 (specifically 1 & 3) in order to be able to reuse socket in #3.
        // We will use the fact that socket had some activity. I.e. if socket disconnected, or client stopped using
        // socket, then removeSocketIoReference() will be called for it, and it will be the indiction that it's not #3.
        return !this.isPendingInitialConnection;
    }
}
// Map of all existing socket io sockets. [url, tenantId, documentId] -> socket
SocketReference.socketIoSockets = new Map();
/**
 * Represents a connection to a stream of delta updates
 */
class OdspDocumentDeltaConnection extends driver_base_1.DocumentDeltaConnection {
    /**
     * @param socket - websocket to be used
     * @param documentId - ID of the document
     * @param details - details of the websocket connection
     * @param socketReferenceKey - socket reference key
     * @param enableMultiplexing - If the websocket is multiplexing multiple documents
     */
    constructor(socket, documentId, socketReference, logger, enableMultiplexing) {
        super(socket, documentId, logger);
        this.enableMultiplexing = enableMultiplexing;
        this.socketReference = socketReference;
    }
    /**
     * Create a OdspDocumentDeltaConnection
     * If url #1 fails to connect, will try url #2 if applicable.
     *
     * @param tenantId - the ID of the tenant
     * @param documentId - document ID
     * @param token - authorization token for storage service
     * @param io - websocket library
     * @param client - information about the client
     * @param mode - mode of the client
     * @param url - websocket URL
     * @param telemetryLogger - optional telemetry logger
     */
    static async create(tenantId, documentId, token, io, client, url, telemetryLogger, timeoutMs, epochTracker) {
        // enable multiplexing when the websocket url does not include the tenant/document id
        const parsedUrl = new URL(url);
        const enableMultiplexing = false;
        // do not include the specific tenant/doc id in the ref key when multiplexing
        // this will allow multiple documents to share the same websocket connection
		console.log(`url:${url}, tenantId:${tenantId}, documentId:${documentId}, enableMultiplexing:${enableMultiplexing}`);
        const socketReferenceKey = enableMultiplexing ? url : `${url},${tenantId},${documentId}`;
        const socketReference = OdspDocumentDeltaConnection.getOrCreateSocketIoReference(io, timeoutMs, socketReferenceKey, url, enableMultiplexing, tenantId, documentId, telemetryLogger);
        const socket = socketReference.socket;
        const connectMessage = {
            client,
            id: documentId,
            mode: client.mode,
            tenantId,
            token,
            versions: protocolVersions,
            nonce: uuid_1.v4(),
            epoch: epochTracker.fluidEpoch,
        };
        const deltaConnection = new OdspDocumentDeltaConnection(socket, documentId, socketReference, telemetryLogger, enableMultiplexing);
        try {
            await deltaConnection.initialize(connectMessage, timeoutMs);
            await epochTracker.validateEpochFromPush(deltaConnection.details);
        }
        catch (errorObject) {
            if (errorObject !== null && typeof errorObject === "object") {
                // We have to special-case error types here in terms of what is re-triable.
                // These errors have to re-retried, we just need new joinSession result to connect to right server:
                //    400: Invalid tenant or document id. The WebSocket is connected to a different document
                //         Document is full (with retryAfter)
                //    404: Invalid document. The document \"local/w1-...\" does not exist
                // But this has to stay not-retriable:
                //    406: Unsupported client protocol. This path is the only gatekeeper, have to fail!
                //    409: Epoch Version Mismatch. Client epoch and server epoch does not match, so app needs
                //         to be refreshed.
                // This one is fine either way
                //    401/403: Code will retry once with new token either way, then it becomes fatal - on this path
                //         and on join Session path.
                //    501: (Fluid not enabled): this is fine either way, as joinSession is gatekeeper
                if (errorObject.statusCode === 400 || errorObject.statusCode === 404) {
                    errorObject.canRetry = true;
                }
            }
            throw errorObject;
        }
        return deltaConnection;
    }
    /**
     * Error raising for socket.io issues
     */
    createErrorObject(handler, error, canRetry = true) {
        // Note: we suspect the incoming error object is either:
        // - a string: log it in the message (if not a string, it may contain PII but will print as [object Object])
        // - a socketError: add it to the OdspError object for driver to be able to parse it and reason
        //   over it.
        if (canRetry && typeof error === "object" && error !== null) {
            return odspError_1.errorObjectFromSocketError(error, handler);
        }
        else {
            return super.createErrorObject(handler, error, canRetry);
        }
    }
    /**
     * Gets or create a socket io connection for the given key
     */
    static getOrCreateSocketIoReference(io, timeoutMs, key, url, enableMultiplexing, tenantId, documentId, logger) {
        const existingSocketReference = SocketReference.find(key, logger);
        if (existingSocketReference) {
            return existingSocketReference;
        }
        const query = enableMultiplexing ? undefined : { documentId, tenantId };
		console.log(`SocketKey:${key}, EnableMultiplexing:${enableMultiplexing}`);
        const socket = io(url, {
            multiplex: false,
            query,
            reconnection: false,
            transports: ["websocket"],
            timeout: timeoutMs,
        });
        return new SocketReference(key, socket);
    }
    async initialize(connectMessage, timeout) {
        if (this.enableMultiplexing) {
            // multiplex compatible early handlers
            this.earlyOpHandler = (messageDocumentId, msgs) => {
                if (this.documentId === messageDocumentId) {
                    this.queuedMessages.push(...msgs);
                }
            };
            this.earlySignalHandler = (msg, messageDocumentId) => {
                if (messageDocumentId === undefined || messageDocumentId === this.documentId) {
                    this.queuedSignals.push(msg);
                }
            };
        }
        return super.initialize(connectMessage, timeout);
    }
    addTrackedListener(event, listener) {
        // override some event listeners in order to support multiple documents/clients over the same websocket
        switch (event) {
            case "op":
                // per document op handling
                super.addTrackedListener(event, (documentId, msgs) => {
                    if (!this.enableMultiplexing || this.documentId === documentId) {
                        listener(documentId, msgs);
                    }
                });
                break;
            case "signal":
                // per document signal handling
                super.addTrackedListener(event, (msg, documentId) => {
                    if (!this.enableMultiplexing || !documentId || documentId === this.documentId) {
                        listener(msg, documentId);
                    }
                });
                break;
            case "nack":
                // per client / document nack handling
                super.addTrackedListener(event, (clientIdOrDocumentId, message) => {
                    if (clientIdOrDocumentId.length === 0 ||
                        clientIdOrDocumentId === this.documentId ||
                        (this.hasDetails && clientIdOrDocumentId === this.clientId)) {
                        this.emit("nack", clientIdOrDocumentId, message);
                    }
                });
                break;
            default:
                super.addTrackedListener(event, listener);
                break;
        }
    }
    /**
     * Disconnect from the websocket
     */
    disconnect(socketProtocolError, reason) {
        const socket = this.socketReference;
        common_utils_1.assert(socket !== undefined, "reentrancy not supported!");
        this.socketReference = undefined;
        if (!socketProtocolError && this.hasDetails) {
            // tell the server we are disconnecting this client from the document
            this.socket.emit("disconnect_document", this.clientId, this.documentId);
        }
        socket.removeSocketIoReference(socketProtocolError);
        this.emit("disconnect", reason);
    }
}
exports.OdspDocumentDeltaConnection = OdspDocumentDeltaConnection;
//# sourceMappingURL=odspDocumentDeltaConnection.js.map