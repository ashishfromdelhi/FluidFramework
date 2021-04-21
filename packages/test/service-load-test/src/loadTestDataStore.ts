/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */

import {
    ContainerRuntimeFactoryWithDefaultDataStore,
    DataObject,
    DataObjectFactory,
} from "@fluidframework/aqueduct";
import { ISequencedClient } from "@fluidframework/protocol-definitions";
import * as applicationInsights from "applicationinsights";
import { ILoadTestConfig } from "./testConfigFile";

export interface IRunConfig {
    runId: number,
    testConfig: ILoadTestConfig
}

export interface ILoadTest {
    run(config: IRunConfig): Promise<void>;
}

const wait = async (timeMs: number) => new Promise((resolve) => setTimeout(resolve, timeMs));

const IDLE_TIMEOUT_MS = 10 * 60 * 1000;

enum State {
    NO_STARTED = 0,
    PAUSED = 1,
    RUNNING = 2,
    STOPPED = 3,
}

class LoadTestDataStore extends DataObject implements ILoadTest {
    public static DataStoreName = "StressTestDataStore";

    private opCount = 0;
    private prevOpCount = 0;
    private sentCount = 0;
    private prevSentCount = 0;
    private state: State = State.NO_STARTED;
    private lastSentMs = 0;
    private readonly telemetryClient = applicationInsights.defaultClient;

    protected async hasInitialized() {
        this.root.on("op", () => {
            this.opCount++;
        });
    }

    public async pause(timeMs: number) {
        const startTimeMs = Date.now();
        this.state = State.PAUSED;
        await wait(timeMs);
        this.state = State.RUNNING;
        return Date.now() - startTimeMs;
    }

    private printStatus(config: IRunConfig, startTimeMs: number, runningStartTimeMs: number) {
        const now = Date.now();
        const totalMin = (now - startTimeMs) / 60000;
        const runningMin = (now - runningStartTimeMs) / 60000;
        const opRate = Math.floor(this.opCount / totalMin);
        const sendRate = Math.floor(this.sentCount / runningMin);
        console.log(
            `${config.runId.toString().padStart(3)}>` +
            ` seen: ${this.opCount.toString().padStart(8)} (${opRate.toString().padStart(4)}/min),` +
            ` sent: ${this.sentCount.toString().padStart(8)} (${sendRate.toString().padStart(2)}/min),` +
            ` run time: ${runningMin.toFixed(2).toString().padStart(5)} min`,
            ` total time: ${totalMin.toFixed(2).toString().padStart(5)} min`,
        );

        this.telemetryClient.trackMetric({
            name: "Fluid Operations Received",
            value: (this.opCount - this.prevOpCount),
        });
        this.telemetryClient.trackMetric({
            name: "Fluid Operations Sent",
            value: (this.sentCount - this.prevSentCount),
        });

        if (this.prevSentCount === this.sentCount) {
            if ((Date.now() - this.lastSentMs) > IDLE_TIMEOUT_MS) {
                const msg = `Timeout error: no ops sent in ${Date.now() - this.lastSentMs} ms`;
                this.telemetryClient.trackTrace({ message: msg });
                throw new Error(msg);
            }
        } else {
            this.lastSentMs = Date.now();
        }

        this.prevOpCount = this.opCount;
        this.prevSentCount = this.sentCount;
    }

    public async run(config: IRunConfig) {
        // Wait for all runners to join
        console.log(`${config.runId.toString().padStart(3)}> waiting`);
        await new Promise<void>((resolve) => {
            let memberCount = this.context.getQuorum().getMembers().size;
            if (memberCount >= config.testConfig.numClients) { resolve(); }
            this.context.getQuorum().on("addMember", (clientId: string, details: ISequencedClient) => {
                memberCount++;
                this.telemetryClient.trackTrace({
                    message: `Quorum member added.`,
                    properties: {
                        quorumClientId: clientId,
                        quorumSequence: details.sequenceNumber,
                        quorumUserId: details.client.user.id,
                    },
                });
                if (memberCount >= config.testConfig.numClients) {
                    resolve();
                }
            });
        });
        console.log(`${config.runId.toString().padStart(3)}> begin`);

        // At every moment, we want half the client to be concurrent writers, and start and stop
        // in a rotation fashion for every cycle.
        // To set that up we start each client in a staggered way, each will independently go thru write
        // and listen cycles

        const cycleMs = config.testConfig.readWriteCycleMs;

        // the time gap to start each client over two cycles  (or one full read/write cycle)
        // to get half the client active at a time
        const clientStartGapMs = cycleMs * 2 / config.testConfig.numClients;

        const startTimeMs = Date.now();
        let runningStartTimeMs = startTimeMs + await this.pause(config.runId * clientStartGapMs);

        console.log(`${config.runId.toString().padStart(3)}> started`);

        let t: NodeJS.Timeout;
        const printProgress = () => {
            this.printStatus(config, startTimeMs, runningStartTimeMs);
            if (this.state !== State.STOPPED) {
                t = setTimeout(printProgress, config.testConfig.progressIntervalMs);
            }
        };
        t = setTimeout(printProgress, config.testConfig.progressIntervalMs);

        const clientSendCount = config.testConfig.totalSendCount / config.testConfig.numClients;
        const opsPerCycle = config.testConfig.opRatePerMin * cycleMs / 60000;
        const opsGapMs = cycleMs / opsPerCycle;
        this.lastSentMs = Date.now();
        while (this.sentCount < clientSendCount) {
            await this.runStep();
            // Send cycle worth of Ops
            if (this.sentCount % opsPerCycle === 0) {
                // Pause writing for cycle before resuming
                runningStartTimeMs += await this.pause(cycleMs);
            } else {
                // Random jitter of +- 50% of opWaitMs
                await wait(opsGapMs + opsGapMs * (Math.random() - 0.5));
            }
        }

        this.state = State.STOPPED;
        clearTimeout(t);

        this.printStatus(config, startTimeMs, runningStartTimeMs);
        console.log(`${config.runId.toString().padStart(3)}> finished`);
    }

    public async runStep() {
        this.root.set(Math.floor(Math.random() * 32).toString(), Math.random());
        this.sentCount++;
    }
}

const LoadTestDataStoreInstantiationFactory = new DataObjectFactory(
    LoadTestDataStore.DataStoreName,
    LoadTestDataStore,
    [],
    {},
);

export const fluidExport = new ContainerRuntimeFactoryWithDefaultDataStore(
    LoadTestDataStoreInstantiationFactory,
    new Map([[LoadTestDataStore.DataStoreName, Promise.resolve(LoadTestDataStoreInstantiationFactory)]]),
);
