/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

import assert from "assert";
import * as appinsights from "applicationinsights";

import { ITelemetryBaseEvent } from "@fluidframework/common-definitions";
import { Container } from "@fluidframework/container-loader";
import { TelemetryLogger } from "@fluidframework/telemetry-utils";
import { ITelemetryBufferedLogger } from "@fluidframework/test-driver-definitions";
import { IRunConfig } from "./loadTestDataStore";

export class AppInsightsLogger extends TelemetryLogger implements ITelemetryBufferedLogger {
    private readonly telemetryClient: appinsights.TelemetryClient;

    public constructor() {
        super();

        appinsights.setup().start();
        this.telemetryClient = appinsights.defaultClient;

        if (process.env.FLUID_TEST_UID) {
            this.telemetryClient.commonProperties.testUid = process.env.FLUID_TEST_UID;
        }

        if (process.env.login__odsp__test__accounts) {
            const passwords: { [user: string]: string } = JSON.parse(process.env.login__odsp__test__accounts);
            const users = Object.keys(passwords);
            assert(users.length === 1, `login__odsp__test__accounts should have exactly one user. Users: ${users}`);
            const username = Object.keys(passwords)[0];
            this.telemetryClient.commonProperties.envUserName = username;
        }
    }

    async flush(runInfo?: { url: string, runId?: number }): Promise<void> {
        await new Promise<void>((resolve) => {
            this.telemetryClient.flush({
                callback: () => resolve(),
            });
        });
    }

    send(event: ITelemetryBaseEvent): void {
        event.Event_Time = Date.now();
        this.telemetryClient.trackEvent({
            name: event.eventName,
            tagOverrides: {
                category: event.category,
            },
            properties: event,
        });
    }

    trackMetric(telemetry: appinsights.Contracts.MetricTelemetry): void {
        this.telemetryClient.trackMetric(telemetry);
    }

    trackTrace(telemetry: appinsights.Contracts.TraceTelemetry): void {
        this.telemetryClient.trackTrace(telemetry);
    }
}

const clientIdUserNameMap: { [clientId: string]: string } = {};

const getUserName = (container: Container) => {
    const clientId = container.clientId;
    if (clientId) {
        if (clientIdUserNameMap[clientId]) {
            return clientIdUserNameMap[clientId];
        }

        const userName = container.getQuorum().getMember(clientId)?.client.user.id;
        if (userName) {
            clientIdUserNameMap[clientId] = userName;
            return userName;
        }
    } else {
        return "Unknown";
    }
};

export async function setAppInsightsTelemetry(container: Container, runConfig: IRunConfig, url: string) {
    const telemetryClient = new AppInsightsLogger();

    container.deltaManager.on("connect", (details) => {
        telemetryClient.trackTrace({
            message: "Client connected.", properties: {
                connectedlientId: details.clientId,
                clientId: container.clientId ?? "",
                runId: runConfig.runId,
                podId: runConfig.podId,
                url,
                userName: getUserName(container),
            },
        });
    });

    container.deltaManager.on("disconnect", (reason) => {
        telemetryClient.trackTrace({
            message: "Client disconnected.", properties: {
                reason,
                clientId: container.clientId ?? "",
                runId: runConfig.runId,
                podId: runConfig.podId,
                url,
                userName: getUserName(container),
            },
        });
    });

    let submitOps = 0;
    let submitIncrementOps = 0;
    container.deltaManager.on("submitOp", (message) => {
        if (message?.type === "op") {
            submitOps++;
            const contents = JSON.parse(message.contents);
            if (contents?.contents?.contents?.content?.contents?.type === "increment") {
                submitIncrementOps++;
            }
        }
    });

    let receiveOps = 0;
    let receiveIncrementOps = 0;
    container.deltaManager.on("op", (message) => {
        if (message?.type === "op") {
            receiveOps++;
            const contents = message.contents;
            if (contents?.contents?.contents?.content?.contents?.type === "increment") {
                receiveIncrementOps++;
            }
        }
    });

    let cnt = 0;
    let t: NodeJS.Timeout | undefined;
    const sendTelemetry = () => {
        if (submitOps > 0) {
            telemetryClient.trackMetric({
                name: "Fluid Operations Sent", value: submitOps, properties: {
                    clientId: container.clientId ?? "",
                    runId: runConfig.runId,
                    podId: runConfig.podId,
                    url,
                    userName: getUserName(container),
                },
            });
        }
        if (receiveOps > 0) {
            telemetryClient.trackMetric({
                name: "Fluid Operations Received", value: receiveOps, properties: {
                    clientId: container.clientId ?? "",
                    runId: runConfig.runId,
                    podId: runConfig.podId,
                    url,
                    userName: getUserName(container),
                },
            });
        }
        if (submitIncrementOps > 0) {
            telemetryClient.trackMetric({
                name: "Doc Changes Sent", value: submitIncrementOps, properties: {
                    clientId: container.clientId ?? "",
                    runId: runConfig.runId,
                    podId: runConfig.podId,
                    url,
                    userName: getUserName(container),
                },
            });
        }
        if (receiveIncrementOps > 0) {
            telemetryClient.trackMetric({
                name: "Doc Changes Received", value: receiveIncrementOps, properties: {
                    clientId: container.clientId ?? "",
                    runId: runConfig.runId,
                    podId: runConfig.podId,
                    url,
                    userName: getUserName(container),
                },
            });
        }

        submitOps = 0;
        receiveOps = 0;
        submitIncrementOps = 0;
        receiveIncrementOps = 0;

        cnt++;
        if (cnt === 5) {
            void telemetryClient.flush();
            cnt = 0;
        }

        t = setTimeout(sendTelemetry, runConfig.testConfig.progressIntervalMs);
    };

    sendTelemetry();

    return (): void => {
        sendTelemetry();
        if (t) {
            clearTimeout(t);
        }
    };
}

const _global: any = global;
_global.getTestLogger = () => new AppInsightsLogger();
