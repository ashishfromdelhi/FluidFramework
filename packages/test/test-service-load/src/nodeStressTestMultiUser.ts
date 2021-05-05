/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

import child_process from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import commander from "commander";
import { TestDriverTypes } from "@fluidframework/test-driver-definitions";
import { ILoadTestConfig } from "./testConfigFile";
import { createTestDriver, getProfile, initialize, safeExit } from "./utils";
import { AppInsightsLogger } from "./appinsightslogger";

interface ITestUserConfig {
    [userName: string]: string
}

async function getTestUsers() {
    let config: ITestUserConfig;
    try {
        config = JSON.parse(await new Promise<string>((resolve, reject) =>
            fs.readFile("./testUserConfig.json", "utf8", (err, data) => {
                if (!err) {
                    resolve(data);
                } else {
                    reject(err);
                }
            })));
        return config;
    } catch (e) {
        console.error("Failed to read testUserConfig.json");
        console.error(e);
        process.exit(-1);
    }
}

const createLoginEnv = (userName: string, password: string) => `{"${userName}": "${password}"}`;

async function main() {
    commander
        .version("0.0.1")
        .requiredOption("-d, --driver <driver>", "Which test driver info to use", "odsp")
        .requiredOption("-p, --profile <profile>", "Which test profile to use from testConfig.json", "ci")
        .option("-id, --testId <testId>", "Load an existing data store rather than creating new")
        .option("-pod, --podId <podId>", "PodId or PodName on which this test runs")
        .option("-s, --seed <number>", "Seed for this run")
        .option("-dbg, --debug", "Debug child processes via --inspect-brk")
        .option("-l, --log <filter>", "Filter debug logging. If not provided, uses DEBUG env variable.")
        .option("-v, --verbose", "Enables verbose logging")
        .parse(process.argv);

    const driver: TestDriverTypes = commander.driver;
    const profileArg: string = commander.profile;
    const testId: string | undefined = commander.testId;
    const podId: string | undefined = commander.podId;
    const debug: true | undefined = commander.debug;
    const log: string | undefined = commander.log;
    const verbose: true | undefined = commander.verbose;
    const seed: number | undefined = commander.seed;

    const profile = getProfile(profileArg);

    if (log !== undefined) {
        process.env.DEBUG = log;
    }

    const testUsers = await getTestUsers();

    await orchestratorProcess(
        driver,
        { ...profile, name: profileArg, testUsers },
        { testId, podId, debug, verbose, seed });
}
/**
 * Implementation of the orchestrator process. Returns the return code to exit the process with.
 */
async function orchestratorProcess(
    driver: TestDriverTypes,
    profile: ILoadTestConfig & { name: string, testUsers: ITestUserConfig },
    args: { testId?: string, podId?: string, debug?: true, verbose?: true, seed?: number },
) {
    const telemetryClient = new AppInsightsLogger();

    const seed = args.seed ?? Date.now();

    const userNames = Object.keys(profile.testUsers);

    {
        const userIndex = Math.floor(Math.random() * userNames.length);
        const userName = userNames[userIndex];
        const password = profile.testUsers[userName];
        process.env.login__odsp__test__accounts = createLoginEnv(userName, password);
    }

    const testDriver = await createTestDriver(
        driver,
        seed,
        undefined);

    // Create a new file if a testId wasn't provided
    const url = args.testId !== undefined
        ? await testDriver.createContainerUrl(args.testId)
        : await initialize(testDriver, seed);

    const estRunningTimeMin = Math.floor(2 * profile.totalSendCount / (profile.opRatePerMin * profile.numClients));
    console.log(`Connecting to ${args.testId ? "existing" : "new"} with seed 0x${seed.toString(16)}`);
    console.log(`Container targeting with url:\n${url}`);
    console.log(`Selected test profile: ${profile.name}`);
    console.log(`Estimated run time: ${estRunningTimeMin} minutes\n`);

    const runnerArgs: string[][] = [];
    for (let i = 0; i < profile.numClients; i++) {
        const childArgs: string[] = [
            "./dist/runner.js",
            "--driver", driver,
            "--profile", profile.name,
            "--runId", i.toString(),
            "--podId", (args.podId ? args.podId : "none"),
            "--url", url,
            "--seed", `0x${seed.toString(16)}`,
        ];
        if (args.debug) {
            const debugPort = 9230 + i; // 9229 is the default and will be used for the root orchestrator process
            childArgs.unshift(`--inspect=${debugPort}`);
        }
        if (args.verbose) {
            childArgs.push("--verbose");
        }

        console.log(childArgs.join(" "));
        runnerArgs.push(childArgs);
    }
    try {
        await new Promise<void>((resolve) => setTimeout(resolve, 5000 + Math.random() * 10000));

        const startIndex = Math.floor(Math.random() * userNames.length);
        await Promise.all(runnerArgs.map(async (childArgs, index) => {
            const userName = userNames[(index + startIndex) % userNames.length];
            const password: string = profile.testUsers[userName];

            const homeDir = path.join(os.homedir(), "fluidStressTest", userName);

            await new Promise<void>((resolve, reject) => {
                fs.mkdir(homeDir, {
                    recursive: true,
                }, (err) => {
                    if (!err) {
                        resolve();
                    } else {
                        reject(err);
                    }
                });
            });

            const childProcess = child_process.spawn(
                "node",
                childArgs,
                {
                    stdio: "inherit",
                    env: {
                        ...process.env,
                        HOME: homeDir,
                        USERPROFILE: homeDir,
                        login__odsp__test__accounts: createLoginEnv(userName, password),
                    },
                });
            return new Promise((resolve) => childProcess.once("close", resolve));
        }));
    } catch (e) {
        telemetryClient.sendErrorEvent({
            eventName: "Orchestrator Error",
            category: "error",
            error: e,
        });
    } finally {
        await telemetryClient.flush();
        await safeExit(0, url);
    }
}

main().catch(
    (error) => {
        console.error(error);
        process.exit(-1);
    },
);
